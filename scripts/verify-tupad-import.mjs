import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";

import { mapTupadRow, readTupadRows, tupadBirthDate } from "../lib/imports/tupad.ts";

// Runs entirely in memory. An optional workbook path enables source-file checks.
const sourcePath = process.argv[2];
const actor = "00000000-0000-4000-8000-000000000001";
const map = (row) => mapTupadRow(row, actor, actor, actor);
const fromWorkbook = async (workbook) => readTupadRows(Buffer.from(await workbook.xlsx.writeBuffer()), "xlsx");

assert.equal(tupadBirthDate("03/04/2000"), "2000-04-03", "Text dates must be day-first.");
assert.equal(tupadBirthDate("29/02/2000"), "2000-02-29");
assert.equal(tupadBirthDate("2000/02/29"), "2000-02-29");
assert.equal(tupadBirthDate(new Date("2000-02-29T00:00:00.000Z")), "2000-02-29");
assert.equal(tupadBirthDate(36585), "2000-02-29", "Excel date serials must remain dates.");
for (const invalid of ["29/02/1900", "31/04/2000", "2000/13/01", "2000/00/01", "not a date"]) {
  assert.equal(tupadBirthDate(invalid), null, "Invalid calendar dates must not roll over.");
}
assert.equal(tupadBirthDate(null), null);
assert.equal(tupadBirthDate(""), null);

const workbook = new ExcelJS.Workbook();
const main = workbook.addWorksheet("Beneficiaries");
main.addRow(["Profile of TUPAD Beneficiaries"]);
main.addRow(["Name of Project:", "TUPAD"]);
main.addRow(["First Name", "Last Name", "No.", "Birthdate", "Age", "ID Number", "Contact No.", "E-payment/Bank Account No.", "Average monthy income", "Interested for Skills Training", "If Yes, Indicate skills training needed", "Extra detail", "Extra detail", null]);
main.addRow(["Sample", "Person", 1, "03/04/2000", { formula: "24+1", result: 25 }, "000123", "09123456789", "00001234", "9OOO", "Y", "Welding", "Original first", "Original second", "Unlabelled data"]);
main.getColumn(10).hidden = true;
main.getColumn(11).hidden = true;
main.getCell("E4").numFmt = "0";
main.addRow([null, null, 2, null, null, null, null, null, null, "N", "N/A"]);
main.addRow(["Prepared and Certified True and Correct by:"]);
main.mergeCells("A6:N6");
main.addRow(["Notes: preserve original source definitions"]);
main.mergeCells("A7:N7");
const second = workbook.addWorksheet("Other batch");
second.addRow(["No.", "First Name", "Last Name", "Birthdate", "Average monthly income"]);
second.addRow([1, "Second", "Person", new Date("2000-02-29T00:00:00Z"), 0]);
second.getCell("D2").numFmt = "yyyy/mm/dd";
second.addRow(["Signature over Printed Name"]);
second.mergeCells("A3:B3");
const blank = workbook.addWorksheet("Blank template");
blank.addRow(["No.", "First Name", "Last Name", "Interested for Skills Training"]);
blank.addRow([1, null, null, "N"]);

const rows = await fromWorkbook(workbook);
assert.equal(rows.length, 2, "Import every populated sheet while excluding numbered blank templates and footers.");
assert.equal(rows[0].sourceSheet, "Beneficiaries");
assert.equal(rows[0].sourceRowNumber, 4);
assert.equal(rows[1].sourceSheet, "Other batch");
assert.equal(rows[1].metadata.sheet_context.A3, "Signature over Printed Name");
assert.equal(Object.keys(rows[0].values).length, 14, "Retain duplicate and unlabelled source columns.");
assert.equal(rows[0].values["Extra detail"], "Original first");
assert.equal(rows[0].values["Extra detail [M]"], "Original second");
assert.equal(rows[0].values["Column N"], "Unlabelled data");
assert.equal(rows[0].metadata.source_cells.E4.cached_value, 25);
assert.equal(rows[0].metadata.source_cells.E4.formula, "24+1");
assert.equal(rows[0].metadata.source_cells.E4.number_format, "0");
assert.equal(rows[0].metadata.sheet_context.B2, "TUPAD");
assert.equal(rows[0].metadata.sheet_context.A7, "Notes: preserve original source definitions");
assert(rows[0].metadata.source_columns.filter((column) => column.hidden).length === 2);
const firstRecord = map(rows[0]);
assert.equal(firstRecord.birth_date, "2000-04-03");
assert.equal(firstRecord.age, 25, "Use cached source ages, without recalculating formulas.");
assert.equal(firstRecord.id_number, "000123");
assert.equal(firstRecord.contact_number, "09123456789");
assert.equal(firstRecord.bank_account_number, "00001234");
assert.equal(firstRecord.average_monthly_income, "9OOO", "Preserve source income text without correction.");
assert.equal(firstRecord.interested_in_skills_training, "Y");
assert.equal(firstRecord.skills_training_needed, "Welding");
assert.equal(map(rows[1]).average_monthly_income, "0", "Zero income must not become a blank.");
assert.deepEqual(firstRecord.raw_source, rows[0].values);
assert.deepEqual(firstRecord.metadata, rows[0].metadata);
for (const fields of [
  { ...rows[0].fields, first_name: null },
  { ...rows[0].fields, last_name: " " },
  { ...rows[0].fields, birth_date: "31/02/2000" },
  { ...rows[0].fields, age: -1 },
  { ...rows[0].fields, age: 1.5 },
]) {
  assert.throws(() => map({ ...rows[0], fields }), "Invalid beneficiary rows must be reported.");
}

const csv = Buffer.from("\ufeffFirst Name,Last Name,No.,Birthdate,ID Number,Contact No.,E-payment/Bank Account No.,Average monthly income,Extra\r\nCSV,Person,001,29/02/2000,000123,09123456789,0000001,none,retained\r\n");
const csvRows = await readTupadRows(csv, "csv");
assert.equal(csvRows.length, 1);
const csvRecord = map(csvRows[0]);
assert.equal(csvRecord.source_number, "001");
assert.equal(csvRecord.id_number, "000123");
assert.equal(csvRecord.contact_number, "09123456789");
assert.equal(csvRecord.bank_account_number, "0000001");
assert.equal(csvRecord.average_monthly_income, "none");
assert.equal(csvRecord.raw_source.Extra, "retained");
assert.equal(csvRecord.birth_date, "2000-02-29");

const incomplete = new ExcelJS.Workbook();
const incompleteSheet = incomplete.addWorksheet("Incomplete source");
incompleteSheet.addRow(["First Name", "Last Name", "No.", "ID Number", "Contact No.", "Interested for Skills Training", "If Yes, Indicate skills training needed"]);
incompleteSheet.addRow(["Named", "Person", "A-001", "0007"]);
incompleteSheet.addRow([null, "Partial", 2, "0008"]);
incompleteSheet.addRow([null, null, 3, "0009", "09123456789"]);
incompleteSheet.addRow([null, null, 4, null, null, "N", "N/A"]);
incompleteSheet.addRow(["Notes: these merged footer cells are source context"]);
incompleteSheet.mergeCells("A6:G6");
const incompleteRows = await fromWorkbook(incomplete);
assert.equal(incompleteRows.length, 3, "Retain substantive incomplete beneficiaries for validation; exclude only blank templates and footers.");
assert.equal(map(incompleteRows[0]).source_number, "A-001", "Source serial identifiers can be alphanumeric.");
assert.throws(() => map(incompleteRows[1]), /first name and last name/i);
assert.throws(() => map(incompleteRows[2]), /first name and last name/i, "A beneficiary with missing names must not disappear silently.");
assert.match(incompleteRows[0].metadata.sheet_context.A6, /merged footer/);

const collision = new ExcelJS.Workbook();
const collisionSheet = collision.addWorksheet("Header collisions");
collisionSheet.addRow(["First Name", "Last Name", "Extra [E]", "Extra", "Extra"]);
collisionSheet.addRow(["Collision", "Person", "Column C", "Column D", "Column E"]);
const collisionRows = await fromWorkbook(collision);
const collisionSource = map(collisionRows[0]).raw_source;
assert.equal(Object.keys(collisionSource).length, 5, "Generated header labels must not overwrite an existing literal header.");
assert.equal(collisionSource["Extra [E]"], "Column C");
assert.equal(collisionSource.Extra, "Column D");
assert(Object.values(collisionSource).includes("Column E"), "Retain every value when literal and generated duplicate labels collide.");

const unrecognized = workbook.addWorksheet("Unrecognized data");
unrecognized.addRow(["Unrecognized header", "Content"]);
await assert.rejects(() => fromWorkbook(workbook), /no recognized First Name and Last Name headers/i, "A populated unrecognized sheet must never be silently dropped.");
await assert.rejects(() => readTupadRows(Buffer.from("Unknown,Columns\nA,B\n"), "csv"), /no recognized|no beneficiary headers/i);
await assert.rejects(() => readTupadRows(Buffer.from(""), "txt"), /XLSX or CSV/i);

let sourceRecords = null;
if (sourcePath) {
  const sourceBytes = await fs.readFile(sourcePath);
  const sourceRows = await readTupadRows(sourceBytes, "xlsx");
  assert.equal(sourceRows.length, 177, "The supplied LAWA workbook contains 177 actual beneficiaries.");
  assert(sourceRows.every((row) => row.sourceSheet === "Sheet1"));
  assert.deepEqual(sourceRows.map((row) => row.sourceRowNumber), Array.from({ length: 177 }, (_, index) => index + 13));
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(sourceBytes);
  const sheet = sourceWorkbook.getWorksheet("Sheet1");
  assert(sheet);
  const columnFields = ["remarks", "source_number", "first_name", "middle_name", "last_name", "extension_name", "birth_date", "barangay", "city_municipality", "province", "district", "id_type", "id_number", "contact_number", "bank_account_number", "beneficiary_type", "occupation", "sex", "civil_status", "age", "average_monthly_income", "dependent", "interested_in_skills_training", "skills_training_needed"];
  const readValue = (value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "object") return value;
    if ("result" in value) return readValue(value.result);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return value.text;
    return value;
  };
  for (const row of sourceRows) {
    assert.equal(Object.keys(row.values).length, 24, "Retain every source column, including blank and hidden columns.");
    assert.equal(row.metadata.source_columns.length, 24);
    assert.deepEqual(row.metadata.source_columns.filter((column) => column.hidden).map((column) => column.column), [23, 24]);
    for (let column = 1; column <= 24; column++) {
      const field = columnFields[column - 1];
      assert.deepEqual(row.fields[field], readValue(sheet.getRow(row.sourceRowNumber).getCell(column).value), `Source field ${field} changed at worksheet row ${row.sourceRowNumber}.`);
    }
    const record = map(row);
    assert.equal(record.age, Number(row.fields.age));
    assert.equal(record.contact_number, String(row.fields.contact_number));
    assert.equal(record.id_number, String(row.fields.id_number));
    assert.equal(record.average_monthly_income, String(row.fields.average_monthly_income));
    assert.equal(record.bank_account_number, null);
    assert.equal(record.birth_date.length, 10);
    assert.equal(row.metadata.source_cells[`T${row.sourceRowNumber}`].cached_value, record.age);
    assert.equal(row.metadata.sheet_context.E4.trim(), "TUPAD");
    assert.equal(row.metadata.sheet_context.E7, "CALAMBA");
    assert.match(row.metadata.sheet_context.B201, /Notes:/);
  }
  assert.equal(sourceRows.filter((row) => row.fields.remarks).length, 48);
  assert.equal(sourceRows.filter((row) => row.fields.extension_name).length, 7);
  assert.equal(sourceRows.filter((row) => row.fields.average_monthly_income === "none").length, 1);
  assert.equal(sourceRows.filter((row) => row.fields.average_monthly_income === "9OOO").length, 1);
  sourceRecords = sourceRows.length;
}

console.log(JSON.stringify({ passed: true, syntheticRecords: rows.length + csvRows.length + incompleteRows.length + collisionRows.length, sourceRecords, checks: "dates, all columns, hidden data, metadata, formula caches, identifiers, incomplete rows, CSV, multiple worksheets, header collisions" }));
