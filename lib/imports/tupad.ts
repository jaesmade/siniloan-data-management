import { Readable } from "node:stream";
import type { Cell, CellValue, Worksheet } from "exceljs";

export type TupadSourceRow = {
  sourceRowNumber: number;
  sourceSheet: string;
  values: Record<string, unknown>;
  fields: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

const headerKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<string, string[]> = {
  remarks: ["remarks", "findings"], source_number: ["no", "number", "serialnumber"],
  first_name: ["firstname"], middle_name: ["middlename"], last_name: ["lastname", "surname"],
  extension_name: ["extensionname", "extension", "suffix"],
  birth_date: ["birthdate1yyyymmdd", "birthdateyyyymmdd", "birthdate1", "birthdate", "dateofbirth"],
  barangay: ["barangay"], city_municipality: ["citymunicipality", "municipality", "city"],
  province: ["province"], district: ["district"], id_type: ["typeofid", "idtype"],
  id_number: ["idnumber", "idno"], contact_number: ["contactno", "contactnumber"],
  bank_account_number: ["epaymentbankaccountno", "bankaccountnumber", "bankaccountno"],
  beneficiary_type: ["typeofbeneficiary", "beneficiarytype"], occupation: ["occupation"],
  sex: ["sex", "gender"], civil_status: ["civilstatus"], age: ["age"],
  average_monthly_income: ["averagemonthyincome", "averagemonthlyincome"], dependent: ["dependent", "dependents"],
  interested_in_skills_training: ["interestedforskillstrainingyyesnno", "interestedforskillstraining", "interestedinskillstraining"],
  skills_training_needed: ["ifyesindicateskillstrainingneeded", "skillstrainingneeded"],
};
const fieldByHeader = new Map(Object.entries(aliases).flatMap(([field, names]) => names.map(name => [name, field])));

function valueOf(value: CellValue): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("result" in value) return valueOf(value.result as CellValue);
  if ("richText" in value) return value.richText.map(part => part.text).join("");
  if ("text" in value) return value.text;
  if ("error" in value) return value.error;
  return null;
}

function isFilled(value: unknown) { return value !== null && value !== undefined && String(value).trim() !== ""; }
function text(value: unknown) { return value == null ? null : String(value).trim() || null; }

// Text dates in the supplied DOLE template are day-first; never use locale guessing.
export function tupadBirthDate(value: unknown): string | null {
  if (!isFilled(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }
  const input = String(value).trim();
  let year: number, month: number, day: number;
  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/.exec(input);
  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(input);
  if (yearFirst) [, year, month, day] = yearFirst.map(Number);
  else if (dayFirst) [, day, month, year] = dayFirst.map(Number);
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

function cellDetails(cell: Cell) {
  const result: Record<string, unknown> = {};
  if (cell.type === 6) {
    result.formula = cell.formula;
    result.cached_value = valueOf(cell.value);
  }
  if (cell.numFmt && cell.numFmt !== "General") result.number_format = cell.numFmt;
  if (typeof cell.value === "object" && cell.value && "hyperlink" in cell.value) result.hyperlink = cell.value.hyperlink;
  return result;
}

function parseSheet(sheet: Worksheet): TupadSourceRow[] | null {
  let headerRow = 0;
  for (let index = 1; index <= Math.min(sheet.rowCount, 100); index++) {
    const fields = new Set<string>();
    sheet.getRow(index).eachCell(cell => {
      const field = fieldByHeader.get(headerKey(valueOf(cell.value)));
      if (field) fields.add(field);
    });
    if (fields.has("first_name") && fields.has("last_name")) { headerRow = index; break; }
  }
  if (!headerRow) return null;
  const columns: Array<{ column: number; label: string; field?: string }> = [];
  const labels = new Set<string>();
  for (let column = 1; column <= sheet.columnCount; column++) {
    const cell = sheet.getRow(headerRow).getCell(column);
    const original = String(valueOf(cell.value) ?? "").trim().replace(/\s+/g, " ");
    let label = original || `Column ${cell.address.replace(/\d/g, "")}`;
    const baseLabel = label;
    let suffix = 1;
    while (labels.has(label)) {
      label = `${baseLabel} [${cell.address.replace(/\d/g, "")}${suffix > 1 ? ` ${suffix}` : ""}]`;
      suffix++;
    }
    labels.add(label);
    columns.push({ column, label, field: fieldByHeader.get(headerKey(original)) });
  }
  const rows: TupadSourceRow[] = [];
  const dataRowNumbers = new Set<number>();
  for (let index = headerRow + 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const firstNameColumn = columns.find(column => column.field === "first_name");
    const lastNameColumn = columns.find(column => column.field === "last_name");
    const firstNameCell = row.getCell(firstNameColumn!.column);
    const lastNameCell = row.getCell(lastNameColumn!.column);
    if (firstNameCell.isMerged && lastNameCell.isMerged && firstNameCell.master.address === lastNameCell.master.address) continue;
    const values: Record<string, unknown> = Object.create(null);
    const fields: Record<string, unknown> = {};
    const sourceCells: Record<string, unknown> = {};
    for (const { column, label, field } of columns) {
      const cell = row.getCell(column);
      const value = valueOf(cell.value);
      values[label] = value;
      if (field) fields[field] = value;
      const details = cellDetails(cell);
      if (Object.keys(details).length) sourceCells[cell.address] = details;
    }
    // Numbered empty template rows and signature/footer rows are not people.
    const hasIdentity = columns.filter(column => ["first_name", "last_name", "birth_date", "id_number", "contact_number", "bank_account_number"].includes(column.field ?? "")).some(({ column }) => {
      const cell = row.getCell(column);
      return (!cell.isMerged || cell.master.address === cell.address) && isFilled(valueOf(cell.value));
    });
    if (!hasIdentity) continue;
    dataRowNumbers.add(index);
    rows.push({ sourceRowNumber: index, sourceSheet: sheet.name, values, fields, metadata: { source_cells: sourceCells } });
  }
  const context: Record<string, unknown> = {};
  sheet.eachRow((row, index) => {
    if (dataRowNumbers.has(index)) return;
    row.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const value = valueOf(cell.value);
      if (isFilled(value)) context[cell.address] = value;
    });
  });
  const sourceColumns = columns.map(({ column, label, field }) => ({ column, label, field: field ?? null, hidden: Boolean(sheet.getColumn(column).hidden) }));
  for (const row of rows) Object.assign(row.metadata, { sheet_context: context, source_columns: sourceColumns });
  return rows;
}

export async function readTupadRows(buffer: Buffer, extension: string): Promise<TupadSourceRow[]> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (extension === "xlsx") await workbook.xlsx.read(Readable.from(buffer));
  else if (extension === "csv") await workbook.csv.read(Readable.from(buffer.toString("utf8").replace(/^\uFEFF/, "")), { map: value => value });
  else throw new Error("Use an XLSX or CSV file.");
  const rows: TupadSourceRow[] = [];
  let matched = false;
  for (const sheet of workbook.worksheets) {
    const sheetRows = parseSheet(sheet);
    if (sheetRows !== null) { matched = true; rows.push(...sheetRows); }
    else if (sheet.actualRowCount) throw new Error(`Worksheet “${sheet.name}” has no recognized First Name and Last Name headers. No data was imported.`);
  }
  if (!matched) throw new Error("No beneficiary headers were found. Include First Name and Last Name columns.");
  return rows;
}

export function mapTupadRow(row: TupadSourceRow, jobId: string, userId: string, departmentId: string): Record<string, unknown> {
  const fields = row.fields;
  if (!text(fields.first_name) || !text(fields.last_name)) throw new Error("First name and last name are required.");
  const birthDate = tupadBirthDate(fields.birth_date);
  if (isFilled(fields.birth_date) && !birthDate) throw new Error("Birthdate must be a valid YYYY/MM/DD or DD/MM/YYYY date.");
  const age = isFilled(fields.age) ? Number(fields.age) : null;
  if (age !== null && (!Number.isInteger(age) || age < 0)) throw new Error("Age must be a nonnegative whole number.");
  const record: Record<string, unknown> = {};
  for (const field of Object.keys(aliases)) record[field] = text(fields[field]);
  return {
    ...record, birth_date: birthDate, age,
    department_id: departmentId, import_job_id: jobId, source_row_number: row.sourceRowNumber,
    source_sheet: row.sourceSheet, raw_source: row.values, metadata: row.metadata,
    created_by: userId, updated_by: userId,
  };
}
