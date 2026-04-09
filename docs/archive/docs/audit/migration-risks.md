# Migration Risks and Cleanup Recommendations

## Duplicate truth / conflict analysis
### tasks vs projectTasks/operationalTasks/engineeringTasks/workItems
- Where used: `tasks`, `operationalTasks`, `projectEngTasks`, `workItems` appear across route files and storage modules
- Risk: Status/assignment divergence and inconsistent board views
- Recommended source of truth: `work_items` as cross-domain task core, with domain extension tables
- Migration priority: **P0**

### projects vs projectInfo vs companyProjects
- Where used: `projects` legacy + `projectInfo` live; portfolio/assignment tables add another project lens
- Risk: Project metadata mismatch between pages
- Recommended source of truth: `project_info` + assignment/link tables
- Migration priority: **P0**

### programExpense vs normalizedCostLines vs expenses
- Where used: Legacy and normalized expense lines coexist
- Risk: Cost reporting mismatch in finance dashboards
- Recommended source of truth: `normalized_cost_lines`
- Migration priority: **P0**

### programInflows vs normalizedRevenueLines vs revenues
- Where used: Legacy inflow and normalized revenue models coexist
- Risk: Revenue realization mismatch
- Recommended source of truth: `normalized_revenue_lines`
- Migration priority: **P0**

### projectPlan vs normalizedPlanTasks vs workItems
- Where used: Plan rows and execution work items may drift
- Risk: Timeline + execution KPI inconsistency
- Recommended source of truth: `normalized_plan_tasks` + controlled projection to `work_items`
- Migration priority: **P1**

### engineering deliverables/task overlap
- Where used: Engineering-specific tables and generic work items both present
- Risk: Duplicate effort tracking
- Recommended source of truth: Engineering tables as authoritative for eng domain, mirrored to work_items read model
- Migration priority: **P1**

### role/permissions overlap
- Where used: Role enum, permissions table, route guards, and client visibility checks are spread
- Risk: Unauthorized access or hidden-but-accessible routes
- Recommended source of truth: `role_permissions` with server-enforced policy
- Migration priority: **P1**

## Safe immediate cleanups
- Add runtime telemetry per route for table reads/writes before structural changes.
- Mark legacy routes in OpenAPI/docs and hide from new UI navigation.
- Add explicit response contracts for high-traffic endpoints to catch payload drift.

## Routes to switch to latest tables
- Any route modules still touching `projects`, `program_expense`, `program_inflows`, `project_plan`, `tasks` should be queued to normalized/core equivalents.

## Frontend screens to migrate
- Screens calling legacy finance/plan/task endpoints should move to normalized APIs; preserve adapter layer during transition.

## Keep temporarily for compatibility
- Legacy tables with active integration dependencies and import pipelines; gate as read-only where possible.

## Archive candidates after validation
- Tables with `UNUSED` status and no integration path references in server scripts.

## Required tests before any removals
1. Contract tests for every endpoint consumed by frontend pages.
2. Dual-read diff tests between legacy and normalized sources.
3. End-to-end regression for dashboards, project detail, finance tabs, and task boards.
4. Permission matrix tests (route + UI visibility).
