# Phase H Migration Manifest

> **Phase:** H — Strategic Priorities + Import + Compatibility Views  
> **Status:** Schema DDL + backfill + read-only views complete. Runtime write/read cutover outstanding (see docs/schema-migration-status.md).  
> **Total migrations:** 8 (3 DDL + 2 backfill + 1 views + 3 rollback - replaces spine_view_swap.sql)

---

## Execution Order

| # | File | Purpose |
|---|---|---|
| 1 | `20260403_h01_create_strategic_priorities.sql` | Create `core.strategic_priorities` + `core.strategic_priority_links` |
| 2 | `20260403_h02_backfill_strategic_priorities.sql` | Backfill from mytool_company_priorities + priority_projects |
| 3 | `20260403_h03_create_import_batches.sql` | Create `core.import_batches` |
| 4 | `20260403_h04_backfill_import_batches.sql` | Backfill from import_runs + smart_import_runs |
| 5 | `20260403_h05_compatibility_views.sql` | Read-only views over clean tables (replaces spine_view_swap.sql) |

## Rollback

| # | File | Drops |
|---|---|---|
| 1 | `20260403_h06_rollback_views.sql` | All compatibility views |
| 2 | `20260403_h07_rollback_import_batches.sql` | `import_batches` |
| 3 | `20260403_h08_rollback_strategic_priorities.sql` | `strategic_priority_links` → `strategic_priorities` |

## New Tables

| Table | Rows (est.) |
|---|---|
| `core.strategic_priorities` | ~200 |
| `core.strategic_priority_links` | ~500 |
| `core.import_batches` | ~5,000 |

## Compatibility Views

| View | Joins |
|---|---|
| `core.v_projects` | project_instances + projects + types + phase_definitions |
| `core.v_work_items` | work_items_clean + work_packages + parties |
| `finance.v_finance_records` | finance_records + projects + parties + fiscal_periods |
| `core.v_deliverables` | deliverable_instances + definitions + parties |
| `core.v_approvals` | approval_instances + parties |
| `core.v_governed_processes` | governed_processes + phase_definitions + parties |
