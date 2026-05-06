# Setup and Runbook

## Local setup
1. Install dependencies.
2. Configure environment variables (database, auth, Microsoft integration credentials).
3. Run SQL migrations in `migrations/`.
4. Start server and client in development mode.

## Core operating workflows

### Smart Import
Smart Import is the controlled ingestion flow for Excel tracker data.

High-level pipeline:
1. Upload tracker file.
2. Parse plan/revenue/cost rows.
3. Normalize into canonical tables.
4. Upsert project metadata.
5. Preserve compatibility mappings for legacy consumers.

### Derived KPI refresh
If KPI materializations are enabled, refresh precomputed portfolio/project KPI surfaces after significant data imports.

### Release hygiene
Before release:
- run tests and QA checks,
- verify permission enforcement for guarded routes,
- verify monthly/reporting data consistency,
- confirm audit logging remains intact for key mutations.

## Troubleshooting quick checks
- If imports are inconsistent: validate source file shape and row-level normalization.
- If role access is incorrect: verify role-permission matrix and backend guards.
- If reporting totals are off: validate effective rows and month filters on normalized financial tables.
