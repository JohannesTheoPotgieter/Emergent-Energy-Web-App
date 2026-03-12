# Canonical Source Map (Refactor Notes)

## Classification

- `work_items`: **CANONICAL** task/work spine for unified execution tasks and imported plan tasks.
- `normalized_plan_tasks`: **COMPATIBILITY_ONLY** normalized import-stage representation; commits promote to canonical `work_items`.
- `normalized_revenue_lines`: **CANONICAL** commercial revenue reporting source (project-linked rows preferred).
- `normalized_cost_lines`: **CANONICAL** commercial expenditure reporting source (project-linked rows preferred).
- `derived_project_kpis`: **CANONICAL** derived project KPI cache fed by canonical finance/task structures.
- `derived_portfolio_kpis`: **CANONICAL** derived portfolio KPI cache fed by canonical project KPI structures.
- `plan_edit_notifications`: **CANONICAL** persistent conflict-governance trail for front-end plan edits and re-import reconciliation.
- `operational_tasks`: **COMPATIBILITY_ONLY** legacy mirror for UX continuity; not reporting master.
- `engineering_tasks`: **DOMAIN_ENRICHMENT** engineering-domain detail, linked/mapped into `work_items` for unified views.
- `mytool_tasks`: **DOMAIN_ENRICHMENT** personal planner object; project-relevant work is linkable/mappable to `work_items`.
- Dashboard/service logic touched in this refactor (`lifecycle-routes` finance rollups): **CANONICAL_WITH_FALLBACK** where `projectId` is primary and normalized project-name fallback is compatibility-only.

## Import mapping summary

- **Plan import**: `smart_import_runs.summary_json.normalization.planTasks` → commit transaction → canonical `work_items` (`workstream='PM'`, `source='SMART_IMPORT'`, `import_run_id`, `source_row`, `source_sheet`, stable `external_ref`).
- **Revenue import**: normalized rows inserted into `normalized_revenue_lines` with project linkage and `import_run_id`; dashboard/commercial rollups consume these canonical normalized rows.
- **Expenditure import**: normalized rows inserted into `normalized_cost_lines` with project linkage and `import_run_id`; dashboard/commercial rollups consume these canonical normalized rows.

## Conflict governance summary

- Front-end plan task edits/additions/deletions create persistent `plan_edit_notifications` rows.
- Smart-import commit now blocks plan promotion for a project if unresolved (`status='pending'`) plan edit notifications exist.
- Reconciliation is explicit via resolution values on `plan_edit_notifications` (e.g., keep front-end update, use import value, merge/manual decision policy per team workflow).

## Historical normalization & noise filtering summary

- Historical data is preserved in import run history, issue logs, and notification/audit records.
- Live reporting paths prioritize canonical project-linked rows (`projectId`) and avoid name-only matching when stronger keys exist.
- Compatibility fallbacks remain for continuity but are bypassed as reporting masters when canonical links are present.
- Import commit replaces prior project-linked normalized rows atomically, reducing stale/superseded duplication in live totals while preserving audit traces (`smart_import_runs`, audit events, change sets).
