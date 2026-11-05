# Siniloan Enterprise Data Management

An internal municipal data-governance application for Siniloan. It provides controlled access to data and interview requests and TUPAD beneficiary records using a Next.js web application and Supabase/PostgreSQL.

> This system is designed for sensitive government data. Use only approved data, accounts, infrastructure, and retention procedures. Do not commit credentials or real personal data to this repository.

## What the system does

- Lets municipal personnel request an account, then keeps it pending until System Administrator or Data Privacy Officer (DPO) review.
- Applies role- and dataset-level access controls for System Administrators, DPOs, Office Focalpersons, and Staff.
- Provides separate Data Request and Interview Request forms and DPO review pages, backed by one request register with shared permissions.
- Maintains a separate TUPAD Beneficiaries database with complete workbook source fields.
- Supports searchable, paginated record views, controlled manual entry, dashboards, and audit activity.
- Lets DPOs edit individual records in the request register; edits are version checked and audited.
- Imports CSV and XLSX files into the request register and TUPAD Beneficiaries.
- Previews imports, reports invalid rows and possible duplicates, records import jobs and row errors, and allows error CSV downloads.
- Enforces database-level protections with Supabase Auth, PostgreSQL Row Level Security (RLS), audited operations, and rate limiting.

## Technology

- Next.js 16, React 19, and TypeScript
- Supabase Auth, PostgreSQL, Storage, and Supabase CLI
- ExcelJS for workbook imports
- Recharts and Phosphor Icons for the interface

## Data modules

| Module | Purpose | Main schema |
| --- | --- | --- |
| Data & Interview Requests | Separate guest intake and DPO review pages for each request type, with a shared register for records, imports, and reporting | `research` |
| TUPAD Beneficiaries | Workbook imports, beneficiary search, and complete source-field review | `tupad` |

Shared accounts, access grants, imports, audit events, and governance records are in the `core` schema. Current database controls are documented in [docs/database-implementation.md](docs/database-implementation.md); [docs/enterprise-data-management-plan.md](docs/enterprise-data-management-plan.md) preserves the historical planning baseline.

## Access model

| Role | Capabilities |
| --- | --- |
| System Administrator | Manages accounts, departments, and assignments; sees aggregate database totals and system activity. |
| DPO | Reads database records, imports files directly, reviews focalperson submissions, edits requests, records decisions and releases, and manages focalperson assignments. |
| Office Focalperson | Submits request records and CSV/XLSX imports for DPO review when assigned to the destination dataset. |
| Staff | Manages their profile; database records require DPO authority. |

Database policies enforce the access model. Data Requests and Interview Requests have separate guest forms and DPO navigation pages. Each review page loads only its request type (`data_request` or `interview_request`) and retains the Incoming, For release, and Released queues. Both types share dataset permissions, control numbering, attachments, and audit history; the database register still supports filters across both types.

TUPAD is an import-only workflow. DPO imports enter the database directly; assigned Office Focalperson imports remain staged until DPO approval. Manual add/edit forms remain available for the request register. TUPAD records support search, beneficiary-type and barangay filters, birth-date ranges, full details, and audited DPO deletion.

## Retiring other databases

`supabase/migrations/202611050001_requests_only.sql` permanently drops the Jobseeker and Biometrics schemas and deletes their staged submissions, import jobs, and import row errors. It preserves all request rows, attachments, control counters, accounts, departments, and audit events. Retired dataset registry entries remain inactive to preserve historical audit and grant references.

Apply this migration to the intended deployment with `npx supabase migration up --local` for a running local stack, or `npx supabase db push` for the linked project after logging in. Check the target and pending migrations first. Existing migration files remain in the repository so existing deployments can upgrade and new deployments replay the same history.

`supabase/migrations/202611050002_tupad_beneficiaries.sql` adds `tupad.beneficiaries`, registers the `tupad_beneficiaries` dataset, and extends import review, record queries, dashboards, access policies, and audit handling. Apply this migration with the same upgrade commands; existing request records are preserved.

## Requirements

- Node.js 20.9 or later (current LTS recommended)
- npm
- Docker Desktop (for local Supabase)
- Supabase CLI, available through this project’s dev dependency (`npx supabase` / npm scripts)

## Local setup

1. Install dependencies and start the local Supabase stack:

   ```bash
   npm ci
   npm run db:start
   ```

2. Run `npm run db:status` and copy the local API URL, publishable/anon key, and service-role key into `.env.local`. Start from `.env.example`:

   ```bash
   Copy-Item .env.example .env.local
   ```

   The URL must be the Supabase project/API base URL (for example, `http://127.0.0.1:54321`), not a REST endpoint such as `/rest/v1/`.

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-local-anon-or-publishable-key
   SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
   ```

3. Start the application:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

   To run the web app in Docker instead, start the local Supabase stack first, then run:

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

   Open [http://localhost:3000](http://localhost:3000). Stop the app container with `docker compose --env-file .env.local down`; its private request attachments remain in the `private-uploads` Docker volume.

Local database migrations are applied when the Supabase stack is initialized. To recreate the local database from migrations, use `npm run db:reset`; it removes local database data.

## Local network deployment on this Windows PC

This PC can serve the app to other devices on its current LAN at `http://192.168.1.101:3000`. The application uses a production build and routes browser Supabase requests through the app; devices do not need direct access to the Supabase ports.

1. Build once after code or environment changes: `npm.cmd run build`.
2. Start the local deployment now: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-server.ps1`.
3. Install automatic startup for this Windows user: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-local-startup.ps1`. The task starts Docker Desktop, Supabase, and the app **after this user signs in**. It does not run before Windows sign-in. Startup and app logs are `local-server-startup.log`, `local-server-app.log`, and `local-server-app-error.log`.
4. In an **Administrator PowerShell** window, change to this project directory first, then run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-lan-firewall.ps1`. The `-File` path is relative to the window's current directory. This permits port 3000 from `192.168.1.0/24` and blocks direct LAN access to the local Supabase ports. Windows Firewall currently treats the Ethernet connection as Public, so other devices cannot connect until this rule is installed.

Keep the PC awake, signed in, and connected to the LAN. Reserve `192.168.1.101` for this PC in the router's DHCP settings; if its address or subnet changes, update `supabase/config.toml`, `scripts/enable-lan-firewall.ps1`, and this URL, then restart Supabase and rebuild/restart the app. To remove automatic startup, run `Unregister-ScheduledTask -TaskName 'Siniloan Enterprise Data Management' -Confirm:$false`.

This HTTP and local Supabase CLI setup is suitable for test data on a trusted LAN. Before using real municipal records, add trusted HTTPS, replace local development credentials, secure backups, and review the database and host security controls.

For a fresh local database with no DPO account, `node .\scripts\bootstrap-local-dpo.mjs` creates the first `admin` account with a generated password, activates its DPO profile, and records the bootstrap in the account decisions and audit log. It refuses to run if an active DPO or the `admin` username already exists. Store the printed password securely; the synthetic local email cannot receive recovery messages.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve a production build. |
| `npm run lint` | Run ESLint. |
| `npm run db:start` | Start the local Supabase stack. |
| `npm run db:stop` | Stop the local Supabase stack. |
| `npm run db:status` | Show local Supabase URLs and keys. |
| `npm run db:reset` | Reset the local database and reapply migrations. |
| `npm run db:test` | Run pgTAP database tests. |
| `npm run db:types` | Regenerate Supabase TypeScript types from the local schemas. |

Before handing off a change, run:

```bash
npm run lint
npm run build
npm run db:test
```

`scripts/verify-record-pagination.mjs` is an additional authenticated integration check. It requires a running app, an active DPO account with at least 26 synthetic request records (including a received date), and `TEST_USERNAME`, `TEST_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the environment. Set `TEST_APP_URL` when the app is not running at `http://localhost:3000`.

With Node.js 22.18 or later, `node scripts/verify-tupad-import.mjs` checks the TUPAD parser using synthetic workbooks in memory. Add the supplied workbook's local path as an optional argument to verify all 177 beneficiary rows and their 24 source columns:

```powershell
node scripts/verify-tupad-import.mjs "C:\path\to\LAWA-SINILOAN-165-FINDINGS-2.xlsx"
```

The verifier does not write beneficiary data to the repository. Keep operational source workbooks outside version control.

## Import rules

- Maximum upload: 25 MB and 25,000 data rows.
- Supported formats: CSV and XLSX.
- Imports are previewed before commit. Repeated files and possible duplicate rows produce warnings; re-imports are allowed.
- Files are limited to 10 import attempts per actor/fingerprint per hour.
- Request rows require requester name and title/purpose; TUPAD rows require first and last names. Invalid birth dates or ages are reported for correction.

The TUPAD importer discovers beneficiary headers below template titles and reads every populated worksheet. It preserves all 24 supplied columns, including hidden training fields, plus additional, duplicate, and unlabelled columns in `raw_source`. Source sheet/row identifiers, template context, column visibility, formula text and cached values, and number formats are retained as provenance metadata. Dates and ages have typed fields; identifiers, phone numbers, account numbers, and income text retain their source meaning without automatic corrections. Blank template rows and signature/footer content are excluded from beneficiary counts; template context remains saved with imported records.

Treat the supplied `sampla-data/` workbooks as sample inputs. Validate headers, data quality, department assignment, lawful purpose, and retention requirements before importing operational data.

## Production deployment

1. Create and secure a Supabase project, then link and push the versioned migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

2. Configure Supabase Auth with the production site URL and approved redirect URLs.
3. Deploy the app (for example, to Vercel) with `npm ci` and `npm run build`.
4. Set these environment variables in the deployment platform:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Hosted Supabase project base URL, e.g. `https://YOUR_PROJECT_REF.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Hosted project publishable/anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Hosted project service-role key; server-only |

5. Provision the first DPO through the controlled operational process before onboarding staff. Do not promote the first public registrant or expose service credentials to the browser.

Never run `db:reset` against a production project. Review `supabase/seed.sql` before using any seed material outside local development.

## Repository layout

```text
app/                    Next.js pages and API route handlers
components/             Application UI and record-management components
lib/                    Supabase clients, authorization, security, and database helpers
supabase/migrations/    Versioned PostgreSQL schema, RLS, and stored procedures
supabase/tests/         pgTAP database tests
scripts/                Optional integration verification scripts
docs/                   System design and implementation documentation
sampla-data/            Sample source workbooks; not production data
```

## Security notes

- Keep `.env`, `.env.local`, tokens, keys, and production exports out of version control.
- Treat `SUPABASE_SERVICE_ROLE_KEY` as a server secret; it bypasses ordinary RLS policies.
- Use the migration history as the source of truth for schema and authorization changes.
- Do not place raw biometric templates, passwords, or unapproved sensitive fields in the application or sample data.
- Confirm DPO approval, legal authority, field classification, retention, and incident-response procedures before production use.
