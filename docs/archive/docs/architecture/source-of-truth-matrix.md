# Source-of-Truth Matrix

This matrix is the release-readiness source for data ownership and migration state.

> Status legend: `CANONICAL`, `MIGRATING`, `LEGACY`, `COMPATIBILITY_ONLY`.

| Domain | Canonical model/table | Legacy model/table | Canonical read APIs | Canonical write APIs | Compatibility layers | Migration status | Owner |
|---|---|---|---|---|---|---|---|
| Project master data | `project_info`, `project_phase_history` (`shared/schema.ts`) | `projects` and project-name-only joins in imported finance tables | `GET /api/projects-summary`, `GET /api/project/:name/info`, `GET /api/home/action-hub` | Smart import commit + project admin/update endpoints | Name→ID resolution and fallback by project name when canonical id is absent | `MIGRATING` | PM platform |
| Revenue lines and receipts | `normalized_revenue_lines`, `revenue_milestone_manual` | `program_inflows`, `project_revenue_summary`, `finance_revenue_monthly` | `GET /api/revenue-tracker/*`, `GET /api/program/cos`, project finance views | `POST /api/smart-import/:runId/commit` (revenue section), revenue override endpoints | Merge adapters and override application over imported line data | `MIGRATING` | Finance + Data platform |
| Cost / COS lines | `normalized_cost_lines` | `program_expense`, `finance_cos_monthly`, `expenditure_overrides`, `cos_status_overrides` | `GET /api/program/cos`, cashflow rollups, project cost drilldowns | `POST /api/smart-import/:runId/commit` (expenditure/cost section), cost override endpoints | Legacy rollup helpers (`mergeExpensesOnly` and related mappers) until all consumers are canonicalized | `MIGRATING` | Finance + Data platform |
| Execution tasks and workflow state | `work_items`, execution gate fields on `project_info` | `project_plan`, `operational_tasks`, `engineering_tasks`, `mytool_tasks`, `normalized_plan_tasks` | Lifecycle/execution board APIs, engineering task APIs, my-work task APIs | Task workflow endpoints, smart import plan promotion, execution gate mutations | Task adapters that keep legacy UX tables readable while canonical work-item model expands | `MIGRATING` | Engineering + PM platform |
| Import governance | `smart_import_runs`, `import_issues` | Legacy upload/import bookkeeping in older upload flows | `GET /api/smart-import/pending-runs`, `GET /api/smart-import/runs/:runId`, import issue APIs | `POST /api/smart-import/upload`, `POST /api/smart-import/:runId/commit`, issue resolution endpoints | Legacy `/api/upload` workflows retained for older operational paths | `MIGRATING` | Data platform |
| Portfolio/KPI derived evidence | `derived_project_kpis`, `derived_portfolio_kpis` | On-demand KPI calculations from mixed legacy financial/task tables | Portfolio APIs, KPI traceability APIs, dashboard KPI reads | KPI rebuild/recompute jobs and admin traceability actions | Rebuild path that can source from legacy + normalized data while migration is in-flight | `MIGRATING` | Analytics |
| Quality evidence and checklist control | `qc_*` checklist/evidence domain tables | Spreadsheet/manual trackers | `GET /api/quality/*` dashboard/checklist/warnings APIs | `POST /api/quality/*` checklist and evidence updates | Minimal (domain already near-canonical) | `CANONICAL` | Quality management |
| Access control and permissions | Role/entity permission records + auth permission map responses | Local-storage role hints and historical hard-coded role allowlists | `GET /api/auth/permissions`, role listing endpoints | `POST /api/admin/users/:userId/role`, role/permission update endpoints | Route-level guard fallback logic in app shell for transitional roles | `MIGRATING` | Platform security |

## Release usage rules

1. Every release-affecting domain change must update this matrix row first.
2. New writes must target one canonical table/model for the domain.
3. Temporary dual-write behavior must document explicit compatibility layer + sunset criteria here.
4. Release gate evidence is incomplete if changed APIs/routes are not represented in this matrix.
