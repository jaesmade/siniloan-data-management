# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Municipal personnel use the system according to their role: System Administrator, Data Privacy Officer (DPO), Office Focalperson, or Staff. Guests can submit data or interview requests without an account.

## Product Purpose

Siniloan Enterprise Data Management is a municipal data governance application. It manages data and interview requests and TUPAD beneficiary records through controlled access, review workflows, imports, dashboards, and audit activity.

## Operating Context

Personnel request accounts and await approval before access. DPOs review requests and focalperson submissions, search records, and preview and commit spreadsheet imports. System Administrators manage accounts and departments and review aggregate totals and system activity. The repository documents a local Windows and Supabase setup for testing; operational use with real sensitive records requires additional security and governance controls.

## Capabilities and Constraints

- Database policies enforce role authority and dataset assignments. Active DPOs access live records; Office Focalperson assignments permit staged submissions for DPO review. System Administrators see aggregate totals without source-record access, and Staff manage their profiles.
- System Administrators and DPOs review accounts and manage focalperson assignments. Only System Administrators assign DPO authority and manage departments.
- Data Requests and Interview Requests have separate guest forms and DPO review pages backed by one request register. TUPAD Beneficiaries is a separate module. Jobseeker and Biometrics modules are retired; their migrations remain part of the upgrade history.
- Imports support CSV and XLSX, preview rows, report invalid rows and possible duplicates, and record jobs and errors. Re-imports are allowed with warnings. DPO imports commit directly; assigned Office Focalperson imports require DPO approval.
- Manual entry and version-checked edits are available for requests. TUPAD is import-only and preserves source fields and provenance. Record changes and controlled deletions are audited.
- The system must avoid exposing credentials or sensitive personal data in repository content and logs.

## Brand Commitments

The established product name is Siniloan Enterprise Data Management. No additional brand commitment has been confirmed for future work.

## Evidence on Hand

- [README.md](README.md) describes the current features, access model, stack, and deployment caveats.
- [docs/enterprise-data-management-plan.md](docs/enterprise-data-management-plan.md) preserves the September planning baseline and data governance rationale; it is historical rather than the current feature specification.
- [docs/database-implementation.md](docs/database-implementation.md) documents the implemented database controls.
- The supplied `sampla-data/` workbooks are sample inputs, not approved production data or proof of lawful operational use.

## Product Principles

- Make strict access control and auditability the top priority.
- Grant access deliberately at the role and dataset levels.
- Keep record changes and imports reviewable and auditable.
- Support the daily record tasks of authorized municipal personnel.
- Distinguish implemented behavior from historical plans and proposed policies.
