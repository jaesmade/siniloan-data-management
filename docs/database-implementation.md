# Database implementation

The database uses the same versioned PostgreSQL migrations for hosted Supabase and local tests. The initial migration creates four schemas:

- `core`: accounts, departments, module registration, dataset grants, DPO decisions, audit events, and import jobs.
- `jobseekers`: people and registrations.
- `research`: research and data requests plus their workflow status.
- `biometrics`: subjects, locations, and device attendance events.

The current migration chain retires `jobseekers` and `biometrics` in `202611050001_requests_only.sql`, then adds `tupad` in `202611050002_tupad_beneficiaries.sql`. Active business data now lives in `research.requests` and `tupad.beneficiaries`; shared governance remains in `core`.

## TUPAD Beneficiaries

The `tupad` module registers the `tupad_beneficiaries` dataset with highly restricted classification. Its beneficiary table contains the supplied template's 24 fields: remarks, source number, names, birth date, address, identification and contact details, bank account, beneficiary type, occupation, sex, civil status, age, income, dependent, and training interest/needs. Birth dates use `date` and ages use `integer`; other source fields use text to preserve identifiers and original values.

Every imported record also retains `raw_source` JSON with every source column, including hidden training columns, additional columns, duplicate headers, unlabelled columns, and blank values. `source_sheet`, `source_row_number`, and `import_job_id` trace the record to its upload. `metadata` retains template context, column labels/visibility, formula text with cached values, and number formats. The importer discovers multirow template headers and processes all populated worksheets. Incomplete beneficiary rows are validated and reported; empty templates and signature/footer rows do not become beneficiaries.

DPO imports commit directly. Office Focalpersons need a dataset assignment and submit imports to the existing DPO review workflow; they cannot browse live beneficiary records. Approval commits the full staged payload, including source JSON and metadata. Manual add/edit remains a request-register workflow. TUPAD supports paginated search, beneficiary-type and barangay filters, birth-date ranges, full record details, and audited DPO deletion. No operational workbook data is seeded or committed to the repository.

`node scripts/verify-tupad-import.mjs` runs synthetic parser checks in memory with Node.js 22.18 or later. An optional local path to the supplied LAWA workbook additionally reconciles its 177 beneficiary rows and all 24 columns without persisting personal data.

## Local setup

1. Install and start Docker Desktop or Podman.
2. Copy `.env.example` to `.env.local`.
3. Run `npm run db:start`.
4. Copy the local API URL, publishable/anon key, and service-role key printed by Supabase into `.env.local` using the variable names in `.env.example`.
5. Apply pending migrations with `npx supabase migration up --local` to preserve existing records. Use `npm run db:reset` only for a disposable database that can be recreated from seed data.
6. Run `npm run db:types` after applying migrations to generate database types.
7. Start Next.js with `npm run dev`.

The database health endpoint is `GET /api/health/database`. It requires a valid bearer token for an active System Administrator and a same-origin request. It returns HTTP 200 with the active dataset count and measured response times, HTTP 401 for missing or invalid authentication, HTTP 403 for insufficient authority or a cross-origin request, and HTTP 503 when the database is unavailable or environment variables are missing.

The API's exposed schemas must include `tupad` alongside `core` and `research`. This is configured in `supabase/config.toml` for local stacks; existing deployments must reload their API schema configuration after adding it. Hosted Supabase deployments need the same exposed-schema setting.

## Security model

New Supabase Auth users receive a `core.profiles` row with `pending` status. Pending, rejected, and suspended profiles cannot open module data. A System Administrator or DPO activates an account through `core.approve_account`, which updates the approved department and role, replaces dataset grants, records the decision, and appends an audit event in one transaction. Only System Administrators can assign DPO authority and manage departments.

Every module table has row-level security. Active DPO accounts can access registered datasets. Office Focalperson assignments authorize staged submissions rather than live record access, with optional department scopes. System Administrators receive aggregate dashboard totals and account/department administration without record-level access. Staff cannot access live module records.

Passwords remain in Supabase Auth. Service-role credentials stay server-only and must never use a `NEXT_PUBLIC_` name.

## Adding a module

Add its schema and tables in a new timestamped migration, register its module and datasets in `core.modules` and `core.datasets`, add RLS policies using `core.can_access_dataset`, then regenerate the TypeScript types. This keeps future modules independent while preserving one authorization and audit model.
