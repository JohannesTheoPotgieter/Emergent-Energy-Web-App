# Legacy Inventory — Complete Search Results

**Date:** 2026-03-20
**Branch:** `claude/architecture-audit-qOdnl`
**Method:** Search only — no deletions

---

## Category 1: Legacy Table Definitions in Schema

**File:** `shared/schema/legacy.ts`

| Line | Table Name | Replacement |
|------|-----------|-------------|
| 20 | `projects` | `project_info` + `project_execution_state` + `project_settings` |
| 40 | `expenses` | `program_expense` (normalized cost lines) |
| 60 | `revenues` | `program_inflows` (normalized revenue lines) |
| 77 | `tasks` | `work_items` + extension tables (`work_item_pm`, `work_item_engineering`, `work_item_scheduling`) |
| 96 | `budgets` | `program_expense` with `row_type='budget'` |

**Re-exported via:**
- `shared/schema.ts:21` — `export * from "./schema/legacy"`
- `shared/schema/index.ts:12` — `export * from "./legacy"`

**Legacy task tables (still defined in non-legacy schema files):**

| File | Line | Table Name | Replacement |
|------|------|-----------|-------------|
| `shared/schema/tasks.ts` | 37 | `operational_tasks` | `work_items` with `work_item_pm` extension |
| `shared/schema/engineering.ts` | 110 | `engineering_tasks` | `work_items` with `work_item_engineering` extension |

**Count: 7 legacy tables**

---

## Category 2: Legacy Override Table Definitions

**File:** `shared/schema/finance.ts`

| Line | Table Name | Replacement |
|------|-----------|-------------|
| 231 | `cashflow_planning_overrides` | Baked into base rows (Prompt 4 — override collapse) |
| 246 | `project_plan_overrides` | Baked into base rows (`source='imported_edited'`) |
| 261 | `revenue_tracking_overrides` | Baked into base rows |
| 276 | `expenditure_overrides` | Baked into base rows |
| 291 | `cos_status_overrides` | Baked into base rows |
| 308 | `finance_revenue_overrides` | Baked into base rows |
| 323 | `finance_cos_overrides` | Baked into base rows |

**Count: 7 override tables**

---

## Category 3: Legacy API Endpoints

### 3a. Legacy CRUD endpoints (server/routes.ts)

| Line | Endpoint | Replacement |
|------|----------|-------------|
| 5192 | `GET /api/projects` | `/api/v2/projects` |
| 5201 | `GET /api/projects/:id` | `/api/v2/projects/:id` |
| 5219 | `GET /api/expenses` | `/api/v2/projects/:id/finance` |
| 5235 | `GET /api/revenues` | `/api/v2/projects/:id/finance` |
| 5251 | `GET /api/tasks` | `/api/tasks` (task-management-routes.ts — V2 work_items) |
| 5285 | `GET /api/budgets` | Program expense budget rows |
| 5294 | `POST /api/budgets` | Program expense budget rows |
| 5308 | `DELETE /api/budgets/:id` | Program expense budget rows |
| 8148 | `POST /api/expenses/add-line` | Normalized cost line insert |
| 8195 | `POST /api/expenses/add-category` | Normalized cost line insert |
| 8236 | `POST /api/expenses/insert-task-as-line` | Normalized cost line insert |

### 3b. Duplicate endpoints in departments/finance-routes.ts

| Line | Endpoint | Notes |
|------|----------|-------|
| 2377 | `GET /api/budgets` | Duplicate of routes.ts:5285 |
| 2386 | `POST /api/budgets` | Duplicate of routes.ts:5294 |
| 2399 | `DELETE /api/budgets/:id` | Duplicate of routes.ts:5308 |
| 3852 | `POST /api/expenses/add-line` | Duplicate of routes.ts:8148 |
| 3881 | `POST /api/expenses/add-category` | Duplicate of routes.ts:8195 |
| 3904 | `POST /api/expenses/insert-task-as-line` | Duplicate of routes.ts:8236 |

### 3c. Override-reading endpoints still active

| File | Line | Description |
|------|------|-------------|
| `server/routes.ts` | 4144-4145 | Reads `revenueTrackingOverrides` + `cosStatusOverrides` |
| `server/routes.ts` | 4906 | Reads `revenueTrackingOverrides` |
| `server/routes.ts` | 8349-8359 | Reads `cosStatusOverrides` + `expenditureOverrides` |
| `server/routes.ts` | 8485-8486 | Reads/updates `cosStatusOverrides` |
| `server/lifecycle-routes.ts` | 347 | Reads `projectPlanOverrides` (DEPRECATED comment at line 345) |
| `server/smart-import-routes.ts` | 1727-1728 | Reads `projectPlanOverrides` |
| `server/smart-import-routes.ts` | 2268-2280 | Reads/updates/deletes `cosStatusOverrides` |
| `server/departments/finance-routes.ts` | 3948-3972 | Reads `cosStatusOverrides` + `expenditureOverrides` |

### 3d. DEPRECATED markers in server code

| File | Line | Marker |
|------|------|--------|
| `server/routes.ts` | 320 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/lifecycle-routes.ts` | 345 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/lifecycle-routes.ts` | 763 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/lifecycle-routes.ts` | 765 | `Keep empty structures for backward-compatible code paths` |
| `server/departments/project-routes.ts` | 26 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/smart-import-routes.ts` | 1724 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/smart-import-routes.ts` | 2266-2267 | `DEPRECATED: COS overrides are now baked into base rows` |
| `server/departments/finance-routes.ts` | 93 | `DEPRECATED: Override data is now baked into base table rows` |
| `server/departments/finance-routes.ts` | 95 | `kept as no-ops for backward compatibility during transition` |
| `server/departments/finance-routes.ts` | 163, 168, 236, 241, 246 | Multiple `DEPRECATED` markers |
| `server/storage.ts` | 1436-1439 | `OVERRIDE TABLES (DEPRECATED) ... backward compatibility` |

**Count: 17 legacy/duplicate endpoints, 11 DEPRECATED markers**

---

## Category 4: Legacy Frontend Consumers

### 4a. Endpoints referencing legacy APIs

| File | Line | Endpoint | Notes |
|------|------|----------|-------|
| `client/src/components/tabs/ExpenditureEditableTab.tsx` | 539 | `/api/expenses/add-line` | Still active — needs V2 replacement |
| `client/src/components/tabs/ExpenditureEditableTab.tsx` | 558 | `/api/expenses/add-category` | Still active — needs V2 replacement |
| `client/src/components/tabs/ExpenditureEditableTab.tsx` | 576 | `/api/expenses/insert-task-as-line` | Still active — needs V2 replacement |
| `client/src/pages/task-management.tsx` | 186, 191, 259, 347, 439, 560, 666 | `/api/tasks/*` | Active V2 task system (work_items) — NOT legacy |
| `client/src/pages/my-work-tasks.tsx` | 1722, 1734 | `/api/tasks/reassign` | Active V2 task system — NOT legacy |
| `client/src/components/UserAssignmentPicker.tsx` | 135 | `/api/tasks/reassign` | Active V2 task system — NOT legacy |

### 4b. References to legacy task table names

| File | Line | Reference | Notes |
|------|------|-----------|-------|
| `client/src/pages/project-detail.tsx` | 1466 | `engineering_tasks` string literal | In data-lineage tooltip |
| `client/src/pages/admin-roles.tsx` | 139 | `operational_tasks` string literal | Permission entity label |
| `client/src/pages/admin-roles.tsx` | 193 | `operational_tasks` string literal | Permission entity list |
| `client/src/pages/pm-dashboard.tsx` | 907-909 | `engineering_tasks` string literal | In data-lineage tooltips |
| `client/src/components/dashboard/MetricTooltip.tsx` | 145, 189 | `operational_tasks` string literal | Metric source labels |

### 4c. Legacy /my-tool/ routes (redirect-only, pages deleted)

| File | Line | Path | Redirects To |
|------|------|------|-------------|
| `client/src/config/page-registry.ts` | 36 | `/my-tool/week` | `/my-work/calendar` |
| `client/src/config/page-registry.ts` | 37 | `/my-tool/backlog` | `/my-work/tasks` |
| `client/src/config/page-registry.ts` | 38 | `/my-tool/settings` | `/my-work` |
| `client/src/config/page-registry.ts` | 40 | `/my-tool/help` | `/my-work` |
| `client/src/config/page-registry.ts` | 54 | `/my-tool/meetings` | `/my-work/meetings` |

### 4d. Orphaned component: my-tool-nav

| File | Line | Notes |
|------|------|-------|
| `client/src/components/my-tool-nav.tsx` | 1-34 | No imports found anywhere — **orphaned** |

**Count: 3 active legacy API consumers, 5 string-literal references, 5 redirect entries, 1 orphaned component**

---

## Category 5: Legacy Adapters & Utilities

### 5a. `server/legacy-table-guard.ts` — safeLegacyQuery / safeLegacyWrite

| Consumer File | Line | Usage |
|---------------|------|-------|
| `server/routes.ts` | 15 | `import { safeLegacyQuery }` |
| `server/routes.ts` | 13819-13847 | 3x `safeLegacyQuery()` calls (mytoolTasks, operationalTasks) |
| `server/storage.ts` | 3 | `import { safeLegacyQuery, safeLegacyWrite }` |
| `server/storage.ts` | 1512, 1523 | 2x `safeLegacyQuery()` calls |
| `server/repositories/work-management-repository.ts` | 2 | `import { safeLegacyQuery, safeLegacyWrite }` |
| `server/repositories/work-management-repository.ts` | 54, 57, 60 | 3x `safeLegacyQuery()` calls |

**Replacement:** Direct queries against `work_items` tables (no fallback needed once legacy tables dropped)

### 5b. `server/canonical-boundaries.ts` — mirrorWorkItem / syncOperationalTask

| Consumer File | Line | Usage |
|---------------|------|-------|
| `server/routes.ts` | 92, 95-96 | Imports `mirrorWorkItemToOperationalTask`, `syncOperationalTaskFromWorkItemUpdate` |
| `server/routes.ts` | 13113 | `syncOperationalTaskFromWorkItemUpdate()` call |
| `server/routes.ts` | 13201 | `mirrorWorkItemToOperationalTask()` call |

**Note:** Functions are already **no-ops** per canonical-boundaries.ts:62,77 (stubbed out during architecture audit)

**Replacement:** Remove calls and file entirely

### 5c. `server/work-items-adapter.ts` — Bridge layer

| Consumer File | Line | Usage |
|---------------|------|-------|
| `server/routes.ts` | 71 | Imports 6 functions |
| `server/routes.ts` | 11724 | Dynamic import of `getEngineeringWorkItemById` |
| `server/lifecycle-routes.ts` | 8 | `import { getAllPMWorkItemsAsProjectPlan }` |
| `server/portfolio-routes.ts` | 12 | `import { getAllPMWorkItemsAsProjectPlan }` |
| `server/quality-routes.ts` | 18 | `import { getAllPMWorkItemsAsProjectPlan }` |
| `server/eng-stage-routes.ts` | 22 | `import { createEngineeringWorkItem, updateEngineeringWorkItem }` |
| `server/engineering-routes.ts` | 28 | Imports 6 functions |
| `server/departments/finance-routes.ts` | 35 | `import { isWorkItemsEnabled, getWorkItemsAsOperationalTasks }` |

**Replacement:** Direct queries via work-item-queries.ts / V2 service layer

### 5d. `server/migration-finalize-routes.ts` — Legacy table drop/archive utilities

| Consumer File | Line | Usage |
|---------------|------|-------|
| `server/routes/register-admin-routes.ts` | 6 | Dynamic import |

**Note:** This file manages the actual DROP/ARCHIVE of legacy tables. Should be **retained** until legacy cleanup is complete, then removed as the final step.

### 5e. `server/repositories/work-management-repository.ts` — Legacy OT queries

References `operationalTasks` table directly with `safeLegacyQuery` wrapper.

**Replacement:** Direct `work_items` queries

**Count: 4 adapter/utility files, ~20 consumer sites**

---

## Category 6: Duplicated Columns (Marked MOVED)

**File:** `shared/schema/projects.ts` — `project_info` table

| Line | Column | Moved To |
|------|--------|----------|
| 46 | `excel_tracker_link` | `project_settings` |
| 50 | `phase` | `project_execution_state` |
| 51 | `phase_updated_at` | `project_execution_state` |
| 52 | `phase_updated_by_user_id` | `project_execution_state` |
| 53 | `phase_notes` | `project_execution_state` |
| 54 | `pd_handover_date` | `project_execution_state` |
| 55 | `construction_start_date` | `project_execution_state` |
| 56 | `commissioning_date` | `project_execution_state` |
| 57 | `om_handover_date` | `project_execution_state` |
| 58 | `client_handover_date` | `project_execution_state` |
| 59 | `escalation_level` | `project_execution_state` |
| 60 | `construction_start_actual` | `project_execution_state` |
| 61 | `pd_handover_actual` | `project_execution_state` |
| 62 | `commissioning_actual` | `project_execution_state` |
| 63 | `client_handover_actual` | `project_execution_state` |
| 64 | `rag_status` | `project_execution_state` |
| 65 | `rag_comment` | `project_execution_state` |
| 66 | `rag_updated_at` | `project_execution_state` |
| 67 | `rag_updated_by_user_id` | `project_execution_state` |
| 68 | `is_active` | `project_execution_state` |
| 69 | `execution_enabled` | `project_execution_state` |
| 70 | `execution_gate_status` | `project_execution_state` |
| 71 | `execution_gate_reason` | `project_execution_state` |
| 72 | `signed_status` | `project_execution_state` |
| 73 | `signed_date` | `project_execution_state` |
| 74 | `signed_document_link` | `project_execution_state` |
| 75 | `execution_phase` | `project_execution_state` |
| 76 | `archived_status` | `project_execution_state` |
| 77 | `cp_signed` | `project_execution_state` |
| 78 | `cp_signed_date` | `project_execution_state` |
| 79 | `cp_signed_by_user_id` | `project_execution_state` |
| 80 | `cp_evidence_type` | `project_execution_state` |
| 81 | `cp_evidence_ref` | `project_execution_state` |
| 82 | `pm_task_pack_created` | `project_execution_state` |
| 83 | `eng_post_cp_task_pack_created` | `project_execution_state` |

**Count: 35 duplicated columns** (1 → project_settings, 34 → project_execution_state)

---

## Category 7: Legacy Types

**File:** `shared/schema/legacy.ts`

| Line | Type | Replacement |
|------|------|-------------|
| 36 | `InsertProject` | `InsertProjectInfo` (from `shared/schema/projects.ts`) |
| 56 | `InsertExpense` | `InsertProgramExpense` (from `shared/schema/finance.ts`) |
| 73 | `InsertRevenue` | `InsertProgramInflows` (from `shared/schema/finance.ts`) |
| 92 | `InsertTask` | `InsertWorkItem` (from `shared/schema/tasks.ts`) |

**Consumer:** `server/storage.ts:24-27` — imports and uses `InsertProject`, `InsertExpense`, `InsertRevenue`, `InsertTask` in IStorage interface and DatabaseStorage class (lines 107-129, 615-794)

**Count: 4 legacy types, 1 major consumer (storage.ts)**

---

## Summary Counts

| Category | Count | Priority |
|----------|-------|----------|
| Legacy tables (schema/legacy.ts) | 5 tables | High |
| Legacy task tables (operational_tasks, engineering_tasks) | 2 tables | High |
| Legacy override tables | 7 tables | Medium (already no-op'd) |
| Duplicated MOVED columns on project_info | 35 columns | Medium |
| Legacy API endpoints (routes.ts + duplicates) | 17 endpoints | High |
| DEPRECATED markers | 11 markers | Low (informational) |
| Active frontend legacy API consumers | 3 calls | Medium |
| String-literal legacy table references (frontend) | 5 references | Low |
| /my-tool/ redirect entries | 5 entries | Low (already redirecting) |
| Orphaned components | 1 file | Low |
| Adapter/utility files | 4 files | High |
| Adapter consumer sites | ~20 sites | High |
| Legacy types | 4 types | Medium |
| Legacy type consumers | 1 file (storage.ts) | Medium |

**Total items requiring cleanup: ~114 discrete items across 7 categories**
