# Active Table + Route Map Audit

Method: static code audit using regex extraction over `shared/schema.ts`, `server/**/*.ts`, and `client/src/**/*`.
Evidence file: `docs/audit/_audit_raw.json`.

- Tables in schema: **207**
- Route registrations found: **1028**
- Frontend API call sites found: **532**

## Status Definitions
- **ACTIVE**: backend references + frontend dependencies found.
- **PARTIAL**: backend references found but no direct frontend dependency signal.
- **LEGACY**: table has legacy/backward-compatibility hint in schema comments and still referenced.
- **UNUSED**: no backend usage detected.

## Top 10 Highest-Risk Findings
1. Task truth conflict: `tasks`, `operationalTasks`, `projectEngTasks`, and `workItems` coexist in route files. Mixed writes can diverge statuses and assignees.
2. Project truth conflict: `projects` (legacy) and `projectInfo` both referenced, risking mismatched project metadata.
3. Finance duplicate lineage: old `programExpense`/`programInflows` and normalized `normalizedCostLines`/`normalizedRevenueLines` coexist in backend files.
4. Planning conflict: `projectPlan` and `normalizedPlanTasks` both appear in active route modules.
5. Large stale route surface: many registered endpoints have no direct frontend caller signals (candidate dead/batch/integration routes).
6. Route files with broad table coupling (many tables touched in one module) increase unintended cross-domain side effects.
7. Legacy-labeled tables still in live route files indicate incomplete migration and backward-compat mode.
8. Potential payload drift where frontend calls normalized endpoints but tabs/components still named around legacy entities.
9. MyTool/operational task endpoints appear alongside project execution endpoints without strict boundary guarantees.
10. Permissions/role routes and screen visibility can drift because multiple role/permission sources exist.

## Recommended Source-of-Truth Tables by Domain
- Projects: `project_info`
- Work execution/tasks: `work_items` (+ assignments/history tables)
- Plan: `normalized_plan_tasks`
- Cost: `normalized_cost_lines`
- Revenue: `normalized_revenue_lines`
- Engineering execution: `project_eng_tasks`/`project_eng_deliverables` (domain-specific), linked to `work_items` if unified board needed
- Procurement: `procurement_items`
- Quality/Commissioning: `commissioning_items` and QC template family

## Phased Cleanup Plan
1. **Phase 1 – visibility only**: instrument route/table usage runtime logs and keep compatibility reads.
2. **Phase 2 – switch reads**: move UI and read APIs to normalized/core tables first.
3. **Phase 3 – switch writes**: route write paths to source-of-truth tables; dual-write only temporarily with audit diffing.
4. **Phase 4 – archive legacy**: freeze legacy tables as read-only snapshots/backups.
5. **Phase 5 – remove legacy after approval**: remove routes/tables after test gates + signoff.
