# Archived migration scripts

These scripts are historical one-shot migrations whose work has already
been applied to the production database. They are kept here only as
historical reference and are **not part of the active codebase**:

- They depend on packages that have since been removed from `package.json`
  (`@neondatabase/serverless`).
- They reference schema tables that have since been retired
  (`operationalTasks`, etc.).
- They are excluded from `npm run check` (TypeScript compilation) via
  the `exclude` clause in `tsconfig.check.json`.

If you need to recover one of these scripts:
1. Copy it back into `scripts/`.
2. Re-add the missing dependency (or rewrite the import).
3. Update any retired schema references.
4. Re-run TypeScript check.

| Script | Originally paired with |
|---|---|
| `backfill-collapse-overrides.ts` | `migrations/20260330_collapse_override_tables.sql` |
| `backfill-project-split.ts` | `migrations/20260330_split_project_info.sql` |
| `migrate-clickup-engineering.ts` | `data/clickup_engineering_export.xlsx` (one-time import) |
| `pd-reset-import.ts` | manual PD ticket reset, March 2026 |
| `pd-restore.ts` | rollback companion to `pd-reset-import.ts` |
| `encrypt-existing-tokens.ts` | one-time MS-token encryption (was in `server/migrations/`) |
| `remove-last-password-plain.ts` | one-time `role_credentials.last_password_plain` drop; superseded by `migrations/archive/20260346_drop_last_password_plain.sql` |
