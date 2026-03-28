# Section 4: Data Flow Validation & Spine Issues

## 4.1 Bottom-Up Data Flow Validation

### Correct Patterns (✅)

| Relationship | Direction | Assessment |
|-------------|-----------|------------|
| `users` → `project_info.pmUserId` | Foundation feeds core | ✅ Correct |
| `clients` → `project_info.clientId` | Foundation feeds core | ✅ Correct |
| `project_info` → `program_expense.projectId` | Core feeds domain data | ✅ Correct |
| `project_info` → `work_items.project_id` | Core feeds task data | ✅ Correct |
| `project_info` → `qc_checklist.projectId` | Core feeds quality | ✅ Correct |
| `project_info` → `deliverables.projectId` | Core feeds deliverables | ✅ Correct |
| `qc_template` → `qc_template_phase` → `qc_template_group` → `qc_template_item` | Template tree | ✅ Correct hierarchy |
| `eng_stage_templates` → `eng_task_templates` → `eng_deliverable_templates` | Template tree | ✅ Correct hierarchy |
| `project_eng_stages` → `project_eng_tasks` → `project_eng_deliverables` | Instance tree | ✅ Correct hierarchy |
| `work_items` → `work_item_assignments`, `work_item_dependencies` | Core feeds junction | ✅ Correct |
| `smart_import_runs` → `import_issues` | Import feeds issues | ✅ Correct |
| `import_runs` → `change_ledger` → `snapshots` | Import pipeline | ✅ Correct |
| Server computes COS aggregation → Frontend displays | Backend authoritative | ✅ Correct |
| Server computes cashflow → Frontend renders | Backend authoritative | ✅ Correct |

### Inverted Patterns (⛔)

| Relationship | Issue | Severity |
|-------------|-------|----------|
| **Override tables link by `projectName` (text) not `projectId` (FK)** | `expenditure_overrides`, `revenue_tracking_overrides`, `project_plan_overrides`, `cashflow_planning_overrides` all use `projectName` + `rowNumber`. The child (override) references the parent by a mutable text field instead of a stable FK. If `project_info.projectName` changes, all overrides become orphaned. | ⛔ Critical |
| **`program_expense` has BOTH `projectId` (FK) AND `projectName` (text)** | Dual reference means queries can use either, creating inconsistency if they diverge. Same for `program_inflows`, `cashflow_points`. | ⛔ Critical |
| **Frontend permission check runs before server validation** | Client evaluates full permission matrix to show/hide UI. But server ALSO evaluates independently. If they disagree, user sees UI they can't use or doesn't see UI they could use. | ⛔ Structural |
| **Legacy `projects` table has no FK relationship to `project_info`** | Two root entities for the same concept. `projects.name` loosely correlates to `project_info.projectName` but no formal link. | ⛔ Critical |

### Circular Dependencies (⛔)

| Cycle | Entities | Issue |
|-------|----------|-------|
| **Task ↔ Work Item adapter** | `operational_tasks` ↔ `work_items` via `work-items-adapter.ts` + `canonical-boundaries.ts` | Both tables can exist for the same logical task. Adapter syncs between them. `mirrorWorkItemToOperationalTask()` and `syncOperationalTaskFromWorkItemUpdate()` create bidirectional sync. If either side is edited independently, conflict resolution is needed. |
| **MyTool ↔ Operational tasks** | `mytool_tasks` can be created from `operational_tasks` and vice versa via the work engine | Similar bidirectional sync via `mytool-work-engine.ts`. |
| **Import → Override → Re-import conflict** | Smart import writes `program_expense`. User creates `expenditure_overrides`. Next import may overwrite base data, making override reference stale. `manual_edit_flags` attempts to track this but doesn't prevent it. | Logical cycle — import and manual edits compete for same rows. |

## 4.2 Spine Issues — Backend

### Orphaned/Unused Models

| Table | Evidence | Recommendation |
|-------|----------|---------------|
| `projects` (legacy) | Comment says "kept for backward compatibility." Still has active endpoints and FK dependents (`expenses`, `revenues`, `tasks`, `budgets`). | Migrate remaining consumers to `project_info`, then drop. |
| `expenses` (legacy) | Only used by export endpoints and some dashboard fallbacks. | Route export to `program_expense` / `normalized_cost_lines`. |
| `revenues` (legacy) | Only used by export endpoints. | Route export to `program_inflows` / `normalized_revenue_lines`. |
| `tasks` (legacy) | Only used by export endpoints. | Route export to `operational_tasks` / `work_items`. |
| `budgets` (legacy) | Still has active POST/GET/DELETE endpoints. | Migrate to `fye_budgets` or `tracker_monthly_manual`. |
| `mock_sp_items` | Testing table. | Remove from production schema. |
| `template_profiles` | No route references found. | Verify usage; likely orphaned. |
| `forecast_pipeline` | Defined in schema, no clear route consumers. | Verify usage; likely orphaned. |

### Duplicated Data

| Duplication | Tables | Issue |
|-------------|--------|-------|
| **Project name stored everywhere** | `project_info.projectName`, `program_expense.projectName`, `program_inflows.projectName`, `operational_tasks.projectName`, `work_items` (via project_id), `qc_warning.projectName`, etc. | Denormalized for query convenience but creates update anomalies. Should be derived via FK join. |
| **Financial summaries stored AND computed** | `project_revenue_summary` stores aggregates that are also computed on-the-fly by `cosAggregator`, `cashflow` module | Stale summary data if not refreshed after every edit. |
| **Task data in 4 tables** | `operational_tasks`, `work_items`, `mytool_tasks`, `engineering_tasks` | Overlapping purpose. `work_items` was intended as canonical but coexists with others. |
| **User names duplicated in data** | `engineering_tasks.assigneeName` alongside `assigneeUserId` FK | Name can go stale if user changes their display name. |

### Missing Foreign Keys / Broken References

| Issue | Tables | Detail |
|-------|--------|--------|
| Override tables have no FK to base data | `expenditure_overrides`, `revenue_tracking_overrides`, `project_plan_overrides` | Link by `projectName` + `rowNumber` — no FK constraint. Row numbers can shift on re-import. |
| `finance_revenue_monthly` / `finance_cos_monthly` no FK | Link by `projectName` only | No `project_id` FK column. |
| `task_comments.taskId` has no FK constraint | Points to operational_tasks OR mytool_tasks | Polymorphic reference without FK — no DB-level integrity. |
| `task_checklists.taskId` has no FK constraint | Same as above | Polymorphic — no integrity guarantee. |
| `task_attachments.taskId` has no FK constraint | Same | |
| `qc_warning.projectName` has no FK | Text reference | Should be FK to `project_info.id`. |
| `home_notes` linked by `reportDate` only | No project FK | Standalone, but also no user FK. |

### God Objects

| Entity | Field Count | Issue |
|--------|-------------|-------|
| `project_info` | 35+ columns | Central entity with phase tracking, execution gates, RAG status, signing status, CP gates, dates, user FKs, archived status, excel links. Mixes project metadata, execution state, and lifecycle governance. |
| `operational_tasks` | 45+ columns | Task data, scheduling, assignees (array), watchers (array), blocking, approval, linking, tracking RAG, external source, domain tag, etc. Combines task, scheduling, assignment, and governance concerns. |
| `mytool_tasks` | 35+ columns | Personal tasks with recurrence, scheduling, blocking, email source, pinning, sort order, completion notes, bucket classification. |
| `shared/schema.ts` | 5,936 lines | The schema file itself is a god object — every table, enum, type, constant, and permission matrix in one file. |

## 4.3 Spine Issues — Frontend

### Components Tightly Coupled to Data Shape

| Component | Issue |
|-----------|-------|
| `EditableDataGrid` | Generic but consumers pass raw DB row shapes directly as props. No adapter/interface layer. |
| Tab components (25) | Each tab directly destructures API response objects. If backend response shape changes, every tab breaks. |
| `TaskDetailDrawer` | Handles `operational_tasks`, `mytool_tasks`, and `work_items` with conditional logic based on type. Should use a unified task interface. |

### Duplicated State Across Components

| State | Location 1 | Location 2 | Issue |
|-------|-----------|-----------|-------|
| Project list | `ProgramProvider` (overview) | Individual page `useQuery` calls | Same data fetched twice through different paths |
| User info | `AuthProvider.user` | Various components re-fetch `/api/auth/me` | Should use context exclusively |
| Permission data | `use-permissions.ts` hook | `use-access-matrix.ts` hook | Two separate hooks computing permissions differently |

### Dead/Unreachable Pages

| Page | Evidence |
|------|----------|
| `/my-tool/*` routes | Legacy routes that redirect to `/my-work/*`. Dead code. |
| `/pm-dashboard` | Marked as redirect to `/execution-board` in comments. |
| `/admin/legacy-utilities` (`admin.tsx`) | Labeled "legacy" in navigation config. |
| Several `/my-tool/` component files in `components/mytool/` | MyTool was rebranded to MyWork. Components may be orphaned. |

### UI Logic Mixed with Data Logic

| Location | Issue |
|----------|-------|
| `useEngineeringTaskFilters.ts` | 200+ line hook that filters AND computes metrics. Filter logic = UI, metric computation = business logic. |
| `project-lifecycle-workspace.ts` | Client-side lifecycle phase calculations that mirror server service. |
| `access-control.ts` | Full permission matrix evaluation. This is authorization logic, not UI logic. |
| Tab components | Inline sorting, grouping, and aggregation of financial data. |

## 4.4 Spine Issues — Cross-Cutting

### Entities at Wrong Layer

| Entity/Logic | Current Layer | Should Be |
|-------------|--------------|-----------|
| Permission evaluation | Frontend (`access-control.ts`) + Backend (`permission-middleware.ts`) | Backend only; frontend receives pre-computed flags |
| Financial aggregation | Both (server computes, FE re-computes) | Server only; return aggregates in API response |
| Task status normalization | Both (`normalizeStatus` in server `canonical-task-engine.ts` AND frontend display logic) | Shared utility (already in `@shared/`) — ensure single source |
| Phase label mapping | `schema.ts` (shared) | ✅ Correctly shared |
| Override conflict detection | `manual_edit_flags` (backend) | ✅ Correct layer |

### Data Transformations in Wrong Place

| Transformation | Current Location | Correct Location |
|---------------|-----------------|-----------------|
| COS aggregation by project | Server (`cosAggregator.ts`) + Frontend (re-sums in COS tab) | Server only |
| Cashflow weekly bucketing | Server (`cashflow.ts`) | ✅ Correct |
| Task metric derivation | Frontend (`useEngineeringTaskFilters`) | Server endpoint |
| Project summary computation | Frontend (sums in execution board) | Server endpoint |
| Date formatting | Both (server `format()` and frontend component-level) | Frontend only (display concern) |
| Permission matrix resolution | Frontend (`access-control.ts`) | Server (return permissions per-user) |
