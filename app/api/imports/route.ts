import { Readable } from "node:stream";
import { createHash } from "node:crypto";

import type { CellValue } from "exceljs";
import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { checkRateLimit, isSameOrigin, rateLimitHeaders, requestFingerprint } from "@/lib/security/request-security";
import { mapTupadRow, readTupadRows, type TupadSourceRow } from "@/lib/imports/tupad";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_IMPORT_ROWS = 25_000;
const DATASETS = {
  research: { slug: "research_requests", department: "MPDO", schema: "research", table: "requests" },
  tupad: { slug: "tupad_beneficiaries", department: "PESO", schema: "tupad", table: "beneficiaries" },
} as const;

type ModuleKey = keyof typeof DATASETS;
type SourceRow = { sourceRowNumber: number; values: Record<string, unknown> };
type ImportError = {
  source_row_number: number;
  field_name?: string;
  error_code: string;
  message: string;
};

function cleanHeader(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function cellValue(value: CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value) return cellValue(value.result as CellValue);
  if ("text" in value) return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  return String(value);
}

function meaningful(value: unknown) {
  const text = String(value ?? "").trim();
  return text && !["NA", "N/A", "NONE", "NULL", "-"].includes(text.toUpperCase()) ? text : null;
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = meaningful(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function isoDateTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  const text = meaningful(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

async function readRows(file: File, buffer: Buffer): Promise<SourceRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  if (extension === "csv") {
    await workbook.csv.read(Readable.from(buffer.toString("utf8")));
  } else if (extension === "xlsx") {
    await workbook.xlsx.read(Readable.from(buffer));
  } else {
    throw new Error("Use an XLSX or CSV file.");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The file does not contain a worksheet.");

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = cleanHeader(cellValue(cell.value));
  });

  const rows: SourceRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, column) => {
      if (!header) return;
      const value = cellValue(row.getCell(column).value);
      if (value !== null && value !== "") hasValue = true;
      values[header] = value;
    });
    if (hasValue) rows.push({ sourceRowNumber: rowNumber, values });
  });
  return rows;
}

function sourceValue(row: SourceRow, ...headers: string[]) {
  for (const header of headers) {
    const value = row.values[cleanHeader(header)];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function mapRow(
  row: SourceRow,
  jobId: string,
  userId: string,
  departmentId: string,
) {
  const requesterName = meaningful(sourceValue(row, "RESEARCHER/ REQUESTER NAME (First Name M.I Surname)", "REQUESTER NAME"));
  const purpose = meaningful(sourceValue(row, "RESEARCH TITLE/ PURPOSE", "RESEARCH TITLE", "PURPOSE"));
  const category = meaningful(sourceValue(row, "CATEGORY"));
  const sourceType = meaningful(sourceValue(row, "REQUEST TYPE"))?.toLowerCase().replaceAll(" ", "_");
  if (sourceType && !["data_request", "interview_request"].includes(sourceType)) throw new Error("Choose Data Request or Interview Request as the request type.");
  const requestType = sourceType ?? (category?.trim().toLowerCase() === "interview request" ? "interview_request" : "data_request");
  if (!requesterName || !purpose) throw new Error("Requester name and research title or purpose are required.");
  return {
    department_id: departmentId,
    submitted_at: isoDateTime(sourceValue(row, "TIMESTAMP")),
    category,
    request_type: requestType,
    requester_name: requesterName,
    institution_office: meaningful(sourceValue(row, "SCHOOL/ INSTITUTION/ OFFICE", "INSTITUTION/OFFICE")),
    research_title_purpose: purpose,
    control_number: meaningful(sourceValue(row, "CONTROL NO.", "CONTROL NUMBER")),
    date_received: isoDate(sourceValue(row, "DATE RECEIVED")),
    import_job_id: jobId,
    source_row_number: row.sourceRowNumber,
    created_by: userId,
    updated_by: userId,
  };
}

function duplicateKey(record: Record<string, unknown>, destination: ModuleKey) {
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (destination === "tupad") return [record.first_name, record.middle_name, record.last_name, record.extension_name, record.birth_date, record.barangay].map(normalize).join("|");
  return normalize(record.control_number) || [record.requester_name, record.research_title_purpose].map(normalize).join("|");
}

function previewRecord(record: Record<string, unknown>, destination: ModuleKey) {
  if (destination === "tupad") return {
    beneficiary: [record.first_name, record.middle_name, record.last_name, record.extension_name].filter(Boolean).join(" "),
    barangay: record.barangay ?? "—", birth_date: record.birth_date ?? "—", beneficiary_type: record.beneficiary_type ?? "—",
    source_sheet: record.source_sheet, source_row: record.source_row_number,
    source_fields: record.raw_source,
  };
  return { requester: record.requester_name ?? "—", request_type: record.request_type ?? "—", control_number: record.control_number ?? "—", purpose: record.research_title_purpose ?? "—" };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: "Choose a valid import job." }, { status: 400 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Sign in before downloading errors." }, { status: 401 });
  const { url, publishableKey } = getPublicSupabaseEnv();
  const supabase = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Your session is no longer valid. Sign in again." }, { status: 401 });
  const { data, error } = await supabase.schema("core").from("import_row_errors").select("source_row_number, field_name, error_code, message").eq("import_job_id", jobId).order("source_row_number");
  if (error) return Response.json({ error: error.message }, { status: 403 });
  const csv = [["Source row", "Field", "Error code", "Message"], ...(data ?? []).map((item) => [item.source_row_number, item.field_name, item.error_code, item.message])].map((row) => row.map(csvCell).join(",")).join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="import-errors-${jobId}.csv"`, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return Response.json({ error: "Content-Type must be multipart/form-data." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_SIZE + 1_048_576) return Response.json({ error: "The upload request is too large." }, { status: 413 });

  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Sign in before importing data." }, { status: 401 });

  const form = await request.formData();
  const mode = String(form.get("mode") ?? "commit");
  if (mode !== "preview" && mode !== "commit") return Response.json({ error: "Choose a valid import operation." }, { status: 400 });
  const destination = String(form.get("module") ?? "") as ModuleKey;
  const file = form.get("file");
  if (!Object.hasOwn(DATASETS, destination)) return Response.json({ error: "Choose a valid destination database." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to import." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return Response.json({ error: "The file exceeds the 25 MB limit." }, { status: 413 });

  const { url, publishableKey } = getPublicSupabaseEnv();
  const supabase = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Your session is no longer valid. Sign in again." }, { status: 401 });

  const { data: actor } = await supabase.schema("core").from("profiles").select("role,status").eq("id",authData.user.id).maybeSingle();
  if (!actor || actor.status !== "active" || !["dpo","office_focal"].includes(actor.role)) return Response.json({error:"An active DPO or assigned Office Focalperson is required."},{status:403});

  const rateLimit = await checkRateLimit("data.import", requestFingerprint(request, authData.user.id), 10, 60 * 60);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Import limit reached. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit, 10) },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  let rows: Array<SourceRow | TupadSourceRow>;
  try {
    rows = destination === "tupad" ? await readTupadRows(buffer, file.name.split(".").pop()?.toLowerCase() ?? "") : await readRows(file, buffer);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The file could not be read." }, { status: 400 });
  }
  if (rows.length === 0) return Response.json({ error: "The file does not contain any data rows." }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) return Response.json({ error: `Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file.` }, { status: 413 });

  const config = DATASETS[destination];
  const { data: departments, error: departmentError } = await supabase
    .schema("core")
    .from("departments")
    .select("id, code, name")
    .eq("is_active", true);
  if (departmentError) return Response.json({ error: "Departments could not be loaded." }, { status: 500 });
  const defaultDepartment = departments?.find((item) => item.code === config.department);
  if (!defaultDepartment) return Response.json({ error: "The destination department is not configured." }, { status: 500 });

  const { data: dataset, error: datasetError } = await supabase.schema("core").from("datasets").select("id").eq("slug", config.slug).eq("is_active", true).maybeSingle();
  if (datasetError || !dataset) return Response.json({ error: "The destination database is unavailable or access has not been assigned." }, { status: 403 });
  let importDepartmentId = defaultDepartment.id;
  if (actor.role === "office_focal") {
    const { data: grant, error: grantError } = await supabase.schema("core").from("user_dataset_grants")
      .select("department_scope_id").eq("user_id", authData.user.id).eq("dataset_id", dataset.id).eq("access_mode", "read_write").is("revoked_at", null).maybeSingle();
    if (grantError || !grant) return Response.json({ error: "This database has not been assigned to your account." }, { status: 403 });
    importDepartmentId = grant.department_scope_id ?? defaultDepartment.id;
    if (!departments?.some(department => department.id === importDepartmentId)) return Response.json({ error: "Your assigned department is inactive. Ask the DPO to update the assignment." }, { status: 403 });
    const { data: allowed, error: scopeError } = await supabase.schema("core").rpc("can_submit_dataset", { dataset_slug: config.slug, row_department: importDepartmentId });
    if (scopeError || !allowed) return Response.json({ error: "You do not have submission access to this database and department." }, { status: 403 });
  }
  const { data: priorJobs } = await supabase.schema("core").from("import_jobs").select("id, status, source_filename, created_at").eq("dataset_id", dataset.id).eq("file_sha256", checksum).order("created_at", { ascending: false }).limit(1);
  const duplicateImport = priorJobs?.[0] ?? null;

  const errors: ImportError[] = [];
  const mappedRows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    try {
      const record = destination === "tupad"
        ? mapTupadRow(row as TupadSourceRow, "00000000-0000-0000-0000-000000000000", authData.user.id, importDepartmentId)
        : mapRow(row, "00000000-0000-0000-0000-000000000000", authData.user.id, importDepartmentId);
      const key = duplicateKey(record, destination);
      if (key && seen.has(key)) duplicateRows += 1;
      if (key) seen.add(key);
      mappedRows.push(record);
    } catch (error) {
      errors.push({ source_row_number: row.sourceRowNumber, error_code: "validation_failed", message: error instanceof Error ? error.message : "The row is invalid." });
    }
  }

  if (mode === "preview") return Response.json({
    filename: file.name, checksum, total: rows.length, valid: mappedRows.length, rejected: errors.length,
    duplicateRows, duplicateImport: duplicateImport ? { ...duplicateImport, repeated: true } : null,
    preview: mappedRows.slice(0, 12).map((record) => previewRecord(record, destination)), errors,
  }, { headers: { "Cache-Control": "no-store" } });
  if (mappedRows.length === 0) return Response.json({ error: "There are no valid records to import. Review the validation errors first." }, { status: 400 });
  // Re-imports are allowed; matching source data is retained and reported as a warning.

  if (actor.role === "office_focal") {
    const { data: submissionId, error: submissionError } = await supabase.schema("core").rpc("submit_data_submission", {
      p_dataset_slug: config.slug, p_type: "import", p_payload: mappedRows, p_filename: file.name,
    });
    if (submissionError || !submissionId) return Response.json({error: submissionError?.message ?? "The import could not be submitted for review."},{status:403});
    return Response.json({submissionId,filename:file.name,total:rows.length,accepted:0,rejected:errors.length,duplicateRows,pendingReview:true,errors:errors.slice(0,1000)},{headers:{"Cache-Control":"no-store"}});
  }
  const { data: jobId, error: beginError } = await supabase.schema("core").rpc("begin_import", {
    dataset_slug: config.slug,
    source_filename: file.name,
    total_rows: rows.length,
  });
  if (beginError || !jobId) {
    return Response.json({ error: beginError?.message ?? "The import job could not be created." }, { status: 403 });
  }
  await supabase.schema("core").rpc("set_import_fingerprint", { p_import_job_id: jobId, p_file_sha256: checksum, p_validation_summary: { valid_rows: mappedRows.length, rejected_rows: errors.length, duplicate_rows: duplicateRows } });
  const committedRows: Record<string, unknown>[] = mappedRows.map((record) => ({ ...record, import_job_id: jobId }));

  let accepted = 0;
  for (let offset = 0; offset < committedRows.length; offset += 100) {
    const batch = committedRows.slice(offset, offset + 100);
    const { error: batchError } = await supabase.schema(config.schema).from(config.table).insert(batch);
    if (!batchError) {
      accepted += batch.length;
      await supabase.schema("core").rpc("update_import_progress", { p_import_job_id: jobId, p_processed_rows: Math.min(rows.length, offset + batch.length + errors.length) });
      continue;
    }

    // Retry a failed batch row by row so one duplicate or malformed row does
    // not prevent the remaining valid records from being imported.
    for (const record of batch) {
      const { error } = await supabase.schema(config.schema).from(config.table).insert(record);
      if (error) {
        errors.push({
          source_row_number: Number(record.source_row_number),
          error_code: error.code || "insert_failed",
          message: error.message,
        });
      } else {
        accepted += 1;
      }
    }
    await supabase.schema("core").rpc("update_import_progress", { p_import_job_id: jobId, p_processed_rows: Math.min(rows.length, offset + batch.length + errors.length) });
  }

  const { error: completeError } = await supabase.schema("core").rpc("complete_import", {
    p_import_job_id: jobId,
    p_accepted_rows: accepted,
    p_rejected_rows: errors.length,
    p_row_errors: errors,
  });
  if (completeError) {
    await supabase.schema("core").rpc("fail_import", { p_import_job_id: jobId, p_failure_message: completeError.message });
    return Response.json({ error: completeError.message }, { status: 500 });
  }

  return Response.json(
    { jobId, filename: file.name, total: rows.length, accepted, rejected: errors.length, duplicateRows, errors: errors.slice(0, 1000) },
    { headers: { "Cache-Control": "no-store", "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(rateLimit.remaining) } },
  );
}
