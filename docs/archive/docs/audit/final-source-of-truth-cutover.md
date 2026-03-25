# Final Source-of-Truth Cutover Report

## Routes switched
- Active dashboard and legacy-compatible project/expense/revenue/task API flows now resolve through `project_info`, `normalized_cost_lines`, `normalized_revenue_lines`, and `work_items` via storage adapters.
- Legacy-shaped payload contracts are preserved while source data now comes from core tables.

## Old tables removed from active runtime use
- Removed runtime reads of: `projects`, `expenses`, `revenues`, `tasks` in active storage methods.
- Active create/update/delete flows for project/task/finance adapters now target `project_info`, `work_items`, `normalized_cost_lines`, and `normalized_revenue_lines`.

## Frontend callers updated
- No frontend contract changes were required because API response shape compatibility was preserved in storage adapters.

## Duplicate routes removed or isolated
- No route path removals were required for this cutover.
- Legacy-specific pathways remain isolated to admin/migration/backfill contexts.

## Remaining legacy usage and justification
- `server/work-items-backfill.ts`: migration/backfill-only `legacy_table` bridge logic.
- `server/migration-finalize-routes.ts`: migration finalization and verification context.
- `server/departments/admin-routes.ts`, `server/admin-control-routes.ts`, `server/admin-recovery-routes.ts`: admin/ops only.
- `shared/schema.ts`: legacy table definitions retained for compatibility and archive support, not active truth.

## Guardrails added
- Added `qa/tests/unit/final-source-of-truth-cutover.test.ts` to fail CI if active runtime files contain direct SQL usage of blocked legacy tables outside the allowlist.
