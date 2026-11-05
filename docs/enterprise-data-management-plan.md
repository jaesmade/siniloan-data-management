# Government Enterprise Data Management website plan

Planning baseline: 20 September 2026. Scope at that time: an internal government web application built with Next.js, hosted Supabase for production, and a local Supabase stack for development and automated database tests. This document preserves the original proposal, before implementation and deployment.

The current application has since adopted System Administrator, DPO, Office Focalperson, and Staff roles; separate guest data/interview request forms; and TUPAD Beneficiaries. Jobseeker and Biometrics modules are retired. Use [../README.md](../README.md), [database-implementation.md](database-implementation.md), and the migration chain for current behavior; the proposed modules, permissions, and release gates below remain historical planning context.

## 1. Dataset findings and initial modules

The supplied folder is named `sampla-data`. Counts below are nonempty data rows excluding headers, not verified unique people or transactions. Inspection covered worksheet structure and headers; full data quality profiling remains an implementation step.

| Workbook | Rows | Columns | Proposed module |
| --- | ---: | ---: | --- |
| Jobseeker-NSRP Form 1 (Responses).xlsx | 1,592 | 144 | Jobseeker Registry |
| Research and Data Request Form.xlsx | 225 | 7 | Research and Data Requests |
| RHU.xlsx | 23 | 8 | Biometrics Data |

**Jobseeker Registry:** personal details, address, contact information, employment status, job preferences, languages, education, training, civil service eligibility, professional licenses, work experience, and skills. Repeated spreadsheet sections become child records. Preserve the original header-to-field mapping, including misspellings and encoded line breaks, without carrying those labels into the interface.

**Research and Data Requests:** submission timestamp, category, requester name, institution/office, research title or purpose, control number, and date received. Add proposed workflow fields separately: assigned officer, status, requested datasets, review decision, release details, and attachments. Those workflow fields are new features, not fields found in the sample.

**Biometrics Data:** uses the supplied RHU.xlsx workbook, whose source headers are Department, Name, No., Date/Time, Location ID, ID Number, VerifyCode, and CardNo. The module manages biometric device records and events. The sample does not establish the presence of raw fingerprint or face templates. Confirm what No., VerifyCode, and the identifiers represent before setting business constraints or deriving attendance totals. Do not infer clock-in/clock-out direction from the available headers.

## 2. Architecture

Use a modular monolith: one Next.js application and one PostgreSQL database, with clear ownership of each module's tables, services, validation, permissions, and pages.

In the website, “database” means an individually managed dataset inside a module, such as Jobseeker Registry, Research and Data Requests, or Biometrics Data. These logical databases share the hosted PostgreSQL database while retaining independent permissions, dashboards, and activity feeds. Future modules can contain more than one logical database.

- Next.js App Router with TypeScript; Server Components for initial reads, Client Components for interactive forms/tables, and server-side actions or route handlers for writes.
- Supabase Auth for credentials and sessions, PostgreSQL for structured data, and private Supabase Storage buckets for source files and attachments.
- A server-only data access layer checks identity, active account status, per-database access mode, department scope, and allowed fields for every operation.
- PostgreSQL row-level security (RLS) independently enforces record access. Page navigation guards alone are insufficient.
- Tailwind CSS and accessible reusable components; shared forms, tables, filters, pagination, dialogs, and status feedback.
- SQL migrations are the source of truth; generate TypeScript database types from the schema.
- A durable job table and worker process handle imports and large exports, with retries and progress. Keep lengthy work outside web request time limits.

Hosted production and local tests use the same migrations, schema, RLS policies, and relevant Auth configuration. Local Supabase runs PostgreSQL, Auth, and Storage through the CLI and Docker. Use isolated local test data, never a production database connection.

## 3. Accounts and DPO authority

Required registration fields:

| Field | Planned behavior |
| --- | --- |
| Name | Required full name; preserve the user's spelling |
| Username | Required, case-insensitive unique identifier; reserve system names |
| Email | Required valid format; email confirmation disabled at signup |
| Department | Required selection from active departments; subject to DPO review |
| Password | Required; handled exclusively by Supabase Auth; never stored in application tables or logs |

Proposed login supports username or email plus password. Supabase authenticates email/password; a rate-limited server-only username resolver performs the username mapping without disclosing email addresses or account existence.

Registration flow:

1. Validate fields and create an Auth identity plus a profile with `pending` status and no database grants. Use a database trigger for profile initialization; force pending status regardless of client metadata. Profile creation failure must fail signup rather than leave an authorized partial account.
2. Show an Awaiting DPO Approval page. A session created during signup may read only its own safe profile/status and log out; it cannot read datasets, reports, files, or user directories.
3. The DPO reviews the applicant's identity and department, assigns a role, selects each database the account may access, chooses Read only or Read/write separately for each, and approves or rejects with a recorded decision. Verify affiliation through an established departmental process; an unverified email is not proof of identity.
4. An atomic database operation activates the account, assigns grants, and records the approval audit event. Repeated or concurrent approval attempts must not create conflicting decisions.
5. Suspended or rejected accounts are denied data access immediately, including with previously issued sessions. Authorization reads authoritative database status rather than relying only on stale token claims.

Statuses: `pending`, `active`, `rejected`, `suspended`. Department changes and privilege changes require DPO authorization. Users cannot edit their status, roles, approved department, or grants through profile updates or Auth metadata.

| Role | Authority |
| --- | --- |
| DPO | Highest application authority; approves accounts, exclusively assigns/revokes database access and access modes, manages departments, sees the admin dashboard and all system activity, and controls data-release policies |
| Data Steward | Sees the admin dashboard with overview metrics for every dataset and system-wide recent activity; reads or changes underlying records only as permitted by the DPO's database grants; cannot approve accounts or change access |
| Staff | Uses each assigned database according to its DPO-selected Read only or Read/write mode; does not see the admin dashboard or system-wide activity |

Roles govern administrative capabilities; database grants independently govern record access. Default is No access. DPO permissions cover every database; highly sensitive field access and exports remain recorded. There is no application Super Admin above the DPO. Infrastructure credentials are operational secrets, never user accounts.

The DPO's Users & Access screen presents one row per database for the selected account:

| Access mode | Allowed behavior |
| --- | --- |
| No access | Database is absent from staff navigation; its dashboard, records, activity feed, and direct endpoints are denied |
| Read only | View permitted records, the database dashboard, reports, and its recent activity; cannot add, edit, import, archive, or delete data |
| Read/write | All Read only capabilities plus create, update, validated import, and reversible archive within the granted scope |

Exports, sensitive-field access, permanent deletion, and external release remain separately controlled actions, not implicit consequences of Read/write. Only the DPO changes grants, including Data Steward grants. Department membership never automatically grants database access. Revocation or downgrade must apply to subsequent requests and queued jobs even when the user has an existing session. A Data Steward's system-wide overview is an explicit administrative exception to the No access summary restriction; it does not permit opening unassigned records or their field-level change details.

Bootstrap the first DPO through a controlled deployment command that promotes a specifically identified account once and records the action. Never assign DPO to the first public registrant. Require MFA for DPO accounts. Prevent removal/suspension of the last active DPO; document controlled recovery and handover.

Email confirmation is optional at signup as requested. Recovery still needs a trusted channel: before enabling email-only password recovery for an approved account, confirm its recovery address separately or use a documented DPO-assisted recovery process. Changing an email must not silently change recovery ownership.

## 4. Scalable database design

Keep shared control tables in a `core` schema and module data in `jobseekers`, `research`, and `biometrics` schemas. Expose only necessary schemas/endpoints with explicit grants and RLS; security-sensitive helper tables/functions remain private. A schema boundary organizes ownership but does not itself enforce authorization.

| Area | Main tables |
| --- | --- |
| Accounts | `profiles`, `departments`, `roles`, `permissions`, `role_permissions` |
| Authorization | `modules`, `user_dataset_grants`, `account_decisions` |
| Governance | `datasets`, `dataset_fields`, `audit_events`, `retention_policies` |
| Shared operations | `import_jobs`, `import_row_errors`, `export_jobs`, `attachments` |
| Jobseekers | `people`, `registrations`, `education`, `training`, `eligibilities`, `licenses`, `work_experience`, `languages`, `skills`, `person_skills`, `job_preferences` |
| Research | `requests`, `request_datasets`, `request_reviews`, `request_releases` |
| Biometrics | `subjects`, `device_events`, `locations`, `source_systems` |

Key relationships and conventions:

- `profiles.id` references `auth.users.id`; passwords remain solely in Auth. Store approved department separately from the department requested at signup.
- `user_dataset_grants` relates an account to a dataset, a `read_only` or `read_write` access mode, and an explicit department scope, with grantor and timestamps. Absence of a grant means No access. Enforce one authoritative grant per account/dataset and use related department-scope rows where needed. Only a DPO-authorized operation may mutate grants. Map the access mode to record operations on the server and in RLS; keep extra actions such as `exports.run` and `sensitive.read` explicit.
- `datasets` catalogs datasets inside modules, their owners, classification, field definitions, and retention policy. One module can contain multiple related datasets.
- Use UUID primary keys, foreign keys, typed columns, check constraints, and timestamps. Operational parent records include `department_id`, `created_by`, `updated_by`, and a version number for concurrent edit detection.
- Child access follows the owning parent; enforce that children cannot be linked across unauthorized departments.
- Keep jobseeker identities and biometrics subjects separate. Any future cross-module identity matching needs a reviewed purpose and explicit mapping; never auto-link on name alone.
- Store phone numbers, tax/household/card identifiers, and external IDs as text to preserve leading zeros. Store birth dates as `date`; event times as `timestamptz`, displayed in Asia/Manila. Confirm timezone interpretation of imported date/time values.
- Retain original file, sheet, row reference, mapping version, and import job ID for provenance. Raw source data has restricted access and a retention deadline.
- Normalize repeating data into child tables. Use JSONB only for bounded optional metadata or temporary staging, not as the primary store for every module's records.
- Add indexes for foreign keys and real filter paths, commonly department plus date/status. Use server-side pagination and bounded queries; introduce keyset pagination for large sequential lists.
- Use database connection pooling. Measure query plans and latency before introducing partitioning, reporting replicas, or materialized summaries. Candidate time-partitioned tables are audit and biometric device events if measured volume justifies it.

New module procedure: register module and datasets; add versioned tables/indexes/RLS; declare permissions; implement forms, validation, import mapper, reports, an individual dashboard and activity feed for every database, and navigation; add isolation tests; have the DPO assign account-level access. Include the new datasets in the admin overview. Registering a module does not execute arbitrary SQL or automatically create unreviewed schemas.

## 5. Data protection and audit behavior

- Private access by default, with authorization for records, attachments, search results, summaries, and exports. Ordinary reports follow dataset/department grants. The admin dashboard explicitly permits the DPO and Data Steward to see overview metrics across all datasets and system-wide activity summaries; access to underlying records still follows record permissions.
- Apply field restrictions through database column privileges, restricted tables, or controlled views/functions as well as server response shaping. RLS controls rows; it does not by itself hide sensitive columns.
- Keep service credentials server-only, reserved for narrowly scoped administrative/background tasks. Normal requests use the requesting user's authorization context.
- Record DPO decisions, permission changes, record creation/edits/archive/deletion, sensitive record views, imports, exports, successful logins, failed logins, logouts, and denied operations. Route sensitive reads through an audited server/RPC path and deny direct base-table reads that could bypass the audit requirement.
- Audit records contain actor, action, target, timestamp, outcome, and necessary change metadata. Avoid passwords, tokens, full sensitive payloads, and unnecessary copies of personal data.
- Application accounts, including DPO, cannot alter audit history. Infrastructure access remains a separate trust boundary; consider an external immutable audit destination before production.
- Store attachments privately; issue short-lived downloads only after access checks. Constrain upload type and size, quarantine uploads, and scan before making them available.
- Proposed data-request flow: Received → Under Review → Approved/Denied → Released → Closed. Dataset owner assesses scope; DPO approves sensitive releases. Log recipient, purpose, released fields, authorizer, and time. Approval to use the website is separate from approval to release a dataset.
- Retention periods, permitted sharing, and treatment of restricted fields must be configured with the DPO before live data import. Archive is not permanent retention: support authorized purge/anonymization and legal-hold exceptions.
- Plan automated backups, restoration drills, monitoring, and an incident response owner. Agree recovery time and acceptable data loss before selecting production backup settings.

### Activity collection and presentation

Use one append-only event model for database feeds and the system-wide feed. Include event ID, source event ID, source, occurrence time, ingestion time, actor ID when known, module/dataset ID when applicable, target reference, action, outcome, and a safe summary. Authentication events have no required dataset or actor: failed attempts can involve unknown accounts. Never label an unverified attempted identity as an authenticated actor.

Capture committed record mutations and their audit entries in the same transaction, using database triggers or audited database operations so direct API writes cannot bypass logging. Collect authentication outcomes on the trusted server and integrate the supported Supabase authentication audit source during implementation to cover provider-side attempts as well. Validate successful and failed login coverage in both local and hosted environments before release; browser-generated events alone are insufficient. Deduplicate provider/server copies by source IDs or correlation IDs, retry collection failures, and show ingestion health/last refresh instead of claiming complete live coverage during an outage.

Both feeds support date range, action, actor, and outcome filters; the admin feed also filters by database. Use indexed, paginated queries with automatic refresh and a visible last-updated time. A database feed includes only events related to that database and permitted record scope. Global login events belong in the admin feed. The admin feed shows safe summaries of all system activity to both DPO and Data Steward, while sensitive values, full authentication identifiers, and detailed before/after payloads require their own authorization. Ordinary users cannot read the global audit source directly.

## 6. Website experience

Use an accessible, restrained government administration interface: navy/blue navigation, neutral backgrounds, readable sans-serif text, clear labels, and limited animation. Prioritize search and tables, with status text accompanying every status color.

Primary navigation: My Databases; Imports; Reports; Data Requests; and Admin Dashboard for the DPO and Data Steward. Each database opens its own Dashboard, Records, Recent Activity, and Reports views. Account Approvals, Users & Access, Departments, and access-policy Settings remain DPO-only. The admin dashboard links to the dataset overview and system-wide activity feed for both administrative roles.

Key screens:

- Sign in, register, awaiting approval/rejected/suspended status, and account recovery.
- Shared admin dashboard visible only to the DPO and Data Steward: overview cards for every dataset with record counts, last update, import status, and data quality indicators; cross-dataset summaries; and system-wide recent activity including data changes and successful/failed logins. DPO-only approval and access-management controls appear according to role. Data Steward visibility of the overview does not grant record write access.
- Staff dashboard with assigned modules, relevant counts, recent work, and data quality issues within their permitted scope.
- Individual database dashboards, visible to accounts with Read only or Read/write access: relevant metrics, date filters, last update/import status, and a recent activity feed for that database. Jobseeker Registry shows registration totals and employment/qualification summaries; Research and Data Requests shows request counts by status and review workload; Biometrics Data shows device-event counts, subjects represented, and events by date/location. Derive only metrics supported by confirmed source semantics.
- Module records with server-side search, filters, sorting, column selection, pagination, and permitted actions.
- Record details with grouped sections, attachments, and authorized history. Jobseeker forms use sections for identity, preferences, education, qualifications, and work experience, with add/remove controls for repeating entries.
- Import wizard: select module → upload → map columns → validate → review problems → commit → view result.
- Approval screen showing applicant fields, requested/approved department, one No access / Read only / Read/write choice per database, role, separately controlled actions, decision reason, and history. Approval and rejection require explicit button actions. The DPO can later edit the same access matrix for an active account.

Accessibility targets: keyboard operation, visible focus, labeled controls, inline validation plus a linked error summary, password-manager support, readable contrast, reduced-motion support, and accessible chart summaries. On narrow screens, keep table scrolling within its container and offer focused record views.

## 7. Import and migration approach

1. Profile every source column for type, missingness, duplicates, and inconsistent categories without exposing personal records in logs.
2. Define a versioned mapper per workbook format; preserve source column positions because repeated labels may be ambiguous.
3. Validate into staging and provide row-level errors. Do not silently drop incomplete values or infer identities from similar names.
4. Normalize repeated jobseeker sections while preserving their original order and education level. Confirm ambiguous repeated education labels before final mapping.
5. Treat duplicate control numbers, biometric device events, and jobseeker submissions as review cases until their uniqueness rules are confirmed.
6. Deduplicate import jobs by file hash, module, and mapping version; use stable per-row import keys and transactional batches so retries cannot duplicate records.
7. Commit only after an authorized operator reviews the validation result. Store successful, rejected, and skipped row counts and reconcile them with the source.
8. Protect CSV/XLSX exports from formula injection; apply the same record and field scope as on-screen access. Recheck authorization when export jobs execute and when files are downloaded.

## 8. Local testing and release gates

Use a disposable local Supabase stack with synthetic seed data resembling the source structures. Preserve production policy/configuration parity where relevant. Automated scripts must reject nonlocal database/Auth/Storage targets before reset, seed, or integration tests; do not rely solely on environment variable names.

- Unit tests: form validation, username normalization, workbook mapping, date interpretation, and repeated-section parsing.
- Database tests: migrations from an empty database, constraints, RLS for every role/status, forbidden cross-department reads/writes, child-parent isolation, and sensitive column protection.
- Integration tests: registration, pending-session denial, DPO approval, rejection, suspension with an existing token, grant changes, and recovery behavior.
- Security cases: direct Supabase access, tampered metadata, unauthorized RPC calls, forged department IDs, storage downloads, and sensitive read audit enforcement.
- Access matrix tests: one account can have Read/write for one database, Read only for another, and No access for a third; verify all three through the UI, server endpoints, database API, files, reports, and jobs. Verify only the DPO can grant/revoke access and that a downgrade blocks writes immediately on subsequent requests.
- Dashboard tests: every database has its own metrics and activity; both DPO and Data Steward see every dataset's overview and system-wide activity; staff cannot access the admin dashboard; Data Stewards cannot open unassigned records or alter access grants.
- Activity tests: committed writes create exactly one canonical event; rolled-back writes are not presented as completed changes; successful and failed logins appear, including unknown-account failures; provider ingestion retries do not duplicate events; delayed ingestion is visible; pagination and filtering preserve scope; sensitive details are redacted for unauthorized readers.
- Import tests: duplicate file, interrupted job/retry, partial failure, missing columns, leading-zero identifiers, and reconciliation.
- Browser tests: complete registration-to-approval flow, permitted module workflows, import preview/commit, access-denied states, and keyboard form/table use.
- Performance tests: synthetic large datasets and concurrent users against agreed volume targets; set response-time budgets after workload discovery.

Release requires successful database rebuild from migrations, passing access-isolation tests, verified source reconciliation, a restore drill, and DPO review of permissions and release workflows. No test seeds contain the supplied personal records.

## 9. Implementation phases

| Phase | Deliverable and completion criterion |
| --- | --- |
| 1. Foundation | Next.js shell, local Supabase, migrations, department/module catalog, synthetic fixtures, and isolated test setup |
| 2. Identity and governance | Registration, pending status, first-DPO bootstrap, MFA, approvals, DPO-only per-database access matrix, shared DPO/Data Steward admin dashboard, global data/authentication activity collection, and passing access-denial tests |
| 3. Research requests | First complete module with seven-column importer, individual database dashboard/activity feed, and proposed review/release workflow; source rows reconcile |
| 4. Jobseeker registry | Normalized records, sectioned forms, restricted fields, repeated-section importer, individual database dashboard/activity feed, and data quality review |
| 5. Biometrics Data | Confirmed source semantics, event importer, filtering, deduplication, and individual database dashboard/activity feed with supported device-event summaries |
| 6. Operations and release | Durable jobs, controlled exports, aggregate reports, complete cross-dataset admin overview, verified hosted authentication-event coverage, accessibility checks, performance validation, monitoring, backup/restore, and production configuration |

Build account approval and access isolation before any live dataset import. Pilot one department before extending access.

## 10. Assumptions to resolve during implementation discovery

- Initial deployment serves one local government organization and internal staff. A public request portal is outside the initial scope.
- Department list, dataset owners, delegated roles, expected user/record volumes, hosting budget, and recovery targets need confirmation.
- The module is named Biometrics Data as requested; source identifier meanings and event direction remain unknown. Raw biometric-template storage is not established by the sample.
- DPO is the highest application authority and exclusively selects each account's database access and mode. DPO and Data Steward both see the admin overview and system-wide recent activity. Sensitive release approval and MFA remain proposed design choices.
- New modules initially require reviewed development and migrations; a no-code schema designer is a separate future feature.

## Technical references

- [Next.js authentication and authorization guidance](https://nextjs.org/docs/app/guides/authentication): server-side authorization and a centralized data access layer.
- [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started): local PostgreSQL, Auth, and Storage using the CLI and Docker.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): database-enforced record access.
- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords): email/password authentication and configurable signup email confirmation.
- [Supabase database migrations](https://supabase.com/docs/guides/local-development/database-migrations): versioned schema changes across environments.
