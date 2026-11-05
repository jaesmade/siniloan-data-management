import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.TEST_APP_URL ?? "http://localhost:3000";
const username = process.env.TEST_USERNAME;
const password = process.env.TEST_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

assert(username && password, "Set TEST_USERNAME and TEST_PASSWORD.");
assert(supabaseUrl && publishableKey, "Supabase public environment variables are required.");

const login = await fetch(`${appUrl}/api/auth/sign-in`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: appUrl },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, `Test sign-in failed with HTTP ${login.status}.`);
const session = await login.json();
const supabase = createClient(supabaseUrl, publishableKey, {
  global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function query(overrides = {}) {
  const parameters = {
    p_module: "research", p_search: "", p_status: "", p_secondary: "",
    p_from: null, p_to: null, p_sort: "created_at", p_desc: true, p_page: 1, p_size: 25,
    ...overrides,
  };
  const { data, error } = await supabase.schema("core").rpc("query_records", parameters);
  assert.ifError(error);
  return data;
}

const first = await query();
const second = await query({ p_page: 2 });
assert(first.total > 25, "Expected enough request records to test a second page.");
assert.equal(first.rows.length, 25);
assert.equal(second.rows.length, Math.min(25, first.total - 25));
assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, first.rows.length + second.rows.length, "Pages overlap.");

const last = await query({ p_page: Math.ceil(first.total / 25) + 1 });
assert.equal(last.page, Math.ceil(last.total / 25), "Out-of-range page was not clamped.");
assert(last.rows.length > 0 && last.rows.length <= 25);

const ascending = await query({ p_sort: "name", p_desc: false });
const descending = await query({ p_sort: "name", p_desc: true });
assert.notEqual(ascending.rows[0].id, descending.rows[0].id, "Sort direction did not change the result order.");
assert.deepEqual(
  ascending.rows.map((row) => row.id),
  (await query({ p_sort: "name", p_desc: false })).rows.map((row) => row.id),
  "Name sort is not deterministic.",
);

const status = first.statuses[0];
assert(status, "Expected a request status filter option.");
const filtered = await query({ p_status: status });
assert(filtered.total > 0 && filtered.total <= first.total);
assert(filtered.rows.every((row) => row.status === status));

const searchedName = String(first.rows[0].requester_name);
const searched = await query({ p_search: searchedName });
assert(searched.total > 0);
assert(searched.rows.every((row) => JSON.stringify(row).toLowerCase().includes(searchedName.toLowerCase())));

const research = await query({ p_module: "research", p_size: 50 });
assert.equal(research.rows.length, Math.min(50, research.total));
const receivedDate = research.rows.find((row) => row.date_received)?.date_received;
assert(receivedDate, "Expected a research request with a received date.");
const researchByDate = await query({ p_module: "research", p_from: receivedDate, p_to: receivedDate });
assert(researchByDate.total > 0);
assert(researchByDate.rows.every((row) => row.date_received === receivedDate));
for (const requestType of ["data_request", "interview_request"]) {
  const typed = await query({ p_request_type: requestType });
  assert(typed.rows.every((row) => row.request_type === requestType));
}
const { error: retiredError } = await supabase.schema("core").rpc("query_records", { p_module: "biometrics" });
assert.equal(retiredError?.code, "22023", "Retired database must reject record queries.");
console.log(JSON.stringify({ requests: first.total, requestPages: Math.ceil(first.total / 25), filteredStatus: status, filteredTotal: filtered.total, requestsOnDate: researchByDate.total }));
