# Source-of-Truth Matrix

This matrix defines the current **authoritative write/read paths** by domain so teams can verify that changes do not reintroduce dual-write drift.

> Status legend: `CANONICAL`, `MIGRATING`, `LEGACY`, `COMPATIBILITY_ONLY`.

| Domain | Canonical table/model | Legacy tables/models | Canonical write APIs | Canonical read APIs | Compatibility layer | Owner | Migration status |
|---|---|---|---|---|---|---|---|
| Work execution tasks | `work_items` | `project_plan`, `operational_tasks`, `engineering_tasks`, `mytool_tasks`, `normalized_plan_tasks` | `POST /api/smart-import/:runId/commit` (plan promotion), work-item sync/adapters in server task engine | Lifecycle/Execution board endpoints and work-item-backed task services | Mapping + promotion from `normalized_plan_tasks` into `work_items`; legacy mirror for UX continuity | Engineering + PM platform | `MIGRATING` |
| Revenue tracking | `normalized_revenue_lines` | `program_inflows`, `finance_revenue_monthly`, `project_revenue_summary`, `revenue_tracking_overrides` | `POST /api/smart-import/:runId/commit` (revenue lines) | `GET /api/program/cos` (merged finance views), project finance endpoints | Name/project resolver merges legacy + normalized rows where needed | Finance + Data platform | `MIGRATING` |
| Cost / COS tracking | `normalized_cost_lines` | `program_expense`, `finance_cos_monthly`, `expenditure_overrides`, `cos_status_overrides` | `POST /api/smart-import/:runId/commit` (cost lines) | `GET /api/program/cos`, cashflow rollups, subcontractor summaries | `mergeExpensesOnly` and override application on legacy reads | Finance + Data platform | `MIGRATING` |
| Import governance | `smart_import_runs`, `import_issues` | legacy `/api/upload` ingestion records | `POST /api/smart-import/upload`, `POST /api/smart-import/:runId/commit`, run-level issue resolution actions | `GET /api/smart-import/pending-runs`, run detail APIs | Legacy Excel upload remains available for older workflows | Data platform | `MIGRATING` |
| Project master data | `project_info` (+ canonical project id linkage) | project-name-only joins across `program_*` and plan/cashflow tables | Smart import commit upserts linked project metadata; admin/project management APIs | `/api/projects-summary`, `/api/project/:name/*`, dashboard/home summary APIs | Name resolver + fallback matching when projectId absent | PM platform | `MIGRATING` |
| Portfolio KPI cache | `derived_project_kpis`, `derived_portfolio_kpis` | on-the-fly KPI aggregation from raw legacy tables | KPI refresh/recompute jobs and KPI traceability tooling | Portfolio dashboard + KPI endpoints | Rebuild from legacy and normalized foundations while transition completes | Analytics | `MIGRATING` |
| Quality evidence | `qc_*` checklist/evidence tables | ad-hoc QA docs and spreadsheet trackers | Quality management APIs (`/api/quality/*`) | Quality dashboard and warning/checklist endpoints | Limited; mostly direct domain ownership | Quality management | `CANONICAL` |
| Permission and role control | Role/entity permission maps in auth + policy tables | local-storage role hints and historical role mappings | `/api/roles`, `/api/admin/users/:userId/role`, auth/permission update paths | `/api/auth/permissions` and guarded route checks | Route-level guard fallback by role allowlists in app shell | Platform security | `MIGRATING` |

## Operating rules

1. New feature work must declare which row in this matrix it extends.
2. Any new write path must point to one canonical table/model per domain.
3. If a temporary dual-write is unavoidable, add an explicit compatibility rule and sunset date in this file.
4. Release gate cannot pass if a changed endpoint has no mapped canonical source.
