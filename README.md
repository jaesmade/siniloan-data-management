# Siniloan Enterprise Data Management

An internal municipal data-governance application for Siniloan. It provides controlled access to three operational datasets—jobseeker records, research and data requests, and biometric device events—using a Next.js web application and Supabase/PostgreSQL.

> This system is designed for sensitive government data. Use only approved data, accounts, infrastructure, and retention procedures. Do not commit credentials or real personal data to this repository.

## What the system does

- Lets municipal personnel request an account, then keeps it pending until Data Privacy Officer (DPO) review.
- Applies role- and dataset-level access controls for DPOs, Data Stewards, and Staff.
- Manages the Jobseeker Registry, Research & Data Requests, and Biometrics Data modules.
- Supports searchable, paginated record views, controlled manual entry, dashboards, and audit activity.
- Lets users with read/write access edit individual records in all three datasets; edits are version checked and audited.
- Imports CSV and XLSX files into all datasets; legacy XLS is supported for biometrics only.
- Previews imports, rejects invalid/duplicate rows, records import jobs and row errors, and allows error CSV downloads.
- Enforces database-level protections with Supabase Auth, PostgreSQL Row Level Security (RLS), audited operations, and rate limiting.

## Technology

- Next.js 16, React 19, and TypeScript
- Supabase Auth, PostgreSQL, Storage, and Supabase CLI
- ExcelJS and `@e965/xlsx` for workbook imports
- Recharts and Phosphor Icons for the interface

## Data modules

| Module | Purpose | Main schema |
| --- | --- | --- |
| Jobseeker Registry | Employment profiles, qualifications, training, and work preferences | `jobseekers` |
| Research & Data Requests | Controlled intake and tracking of research/data requests | `research` |
| Biometrics Data | Attendance-device event metadata and personnel identifiers | `biometrics` |

Shared accounts, access grants, imports, audit events, and governance records are in the `core` schema. The complete implementation and data-governance rationale are documented in [docs/database-implementation.md](docs/database-implementation.md) and [docs/enterprise-data-management-plan.md](docs/enterprise-data-management-plan.md).

## Access model

| Role | Capabilities |
| --- | --- |
| DPO | Approves/rejects accounts, manages departments and access grants, and sees the administrative overview and system activity. |
| Data Steward | Sees the administrative overview and system-wide activity; access to source records still requires dataset grants. |
| Staff | Can use only the datasets and access modes explicitly granted by the DPO. |

Dataset grants are independent of roles and may be `read_only` or `read_write`. No grant means no access. Database policies are the authority; hiding a screen in the UI is not considered access control.

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

This HTTP and local Supabase CLI setup is suitable for test data on a trusted LAN. Before using real municipal or biometric records, add trusted HTTPS, replace local development credentials, secure backups, and review the database and host security controls.

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

`scripts/verify-record-pagination.mjs` is an additional authenticated integration check. It requires a running app, a user with sufficient test data/access, and `TEST_USERNAME` plus `TEST_PASSWORD` in the environment.

## Import rules

- Maximum upload: 25 MB and 25,000 data rows.
- Supported formats: CSV and XLSX for all modules; XLS only for Biometrics.
- Imports are previewed before commit and blocked when the exact file was already completed.
- Files are limited to 10 import attempts per actor/fingerprint per hour.
- Jobseeker rows require surname and first name; research rows require requester name and title/purpose; biometric rows require name, personnel number, and valid date/time.

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
