# Archive Table Retention Policy

No `*_archive` tables were created during this cleanup. All dropped tables had
their data migrated into canonical tables before removal:

| Dropped Table            | Canonical Replacement           | Migration Method         |
|--------------------------|---------------------------------|--------------------------|
| `projects`               | `project_info`                  | Excel import pipeline    |
| `expenses`               | `normalized_cost_lines`         | Excel import pipeline    |
| `revenues`               | `normalized_revenue_lines`      | Excel import pipeline    |
| `tasks`                  | `work_items`                    | Backfill script          |
| `budgets`                | FYE tracking tables             | Manual data entry        |
| `operational_tasks`      | `work_items`                    | `work-items-backfill.ts` |
| `engineering_tasks`      | `work_items` (workstream=ENG)   | `work-items-backfill.ts` |
| `expenditure_overrides`  | `program_expense` (inline)      | `backfill-collapse-overrides.ts` |
| `revenue_tracking_overrides` | `program_inflows` (inline)  | `backfill-collapse-overrides.ts` |
| `cashflow_planning_overrides` | `cashflow_points` (inline) | `backfill-collapse-overrides.ts` |
| `cos_status_overrides`   | `program_expense` (inline)      | `backfill-collapse-overrides.ts` |

## Migration artifact tables (pending DROP)

These tables tracked migration state and should be dropped once confirmed empty:

| Table                         | Purpose                              | Planned Drop |
|-------------------------------|--------------------------------------|-------------|
| `task_migration_map`          | Maps old task IDs to work_item IDs   | 2026-06-21  |
| `override_migration_orphans`  | Override rows with no matching base  | 2026-06-21  |
| `override_migration_ambiguous`| Override rows with multiple matches  | 2026-06-21  |

Schema definitions have already been removed. Confirm `SELECT COUNT(*) FROM <table>` returns 0
before executing `DROP TABLE`.
