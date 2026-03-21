# QA-09 — Cross-Module Integration Check

**Date:** 2026-03-21
**Status:** 🟡 PARTIAL — 6 broken links identified across 5 pipelines

---

## Pipeline 1: Smart Import → Finance → Dashboard

### Traced Flow

```
Excel Upload
  → POST /api/smart-import/upload (smart-import-routes.ts:299)
  → Creates smart_import_run (PREVIEW status)
  → POST /api/smart-import/:runId/commit (smart-import-routes.ts:1310)
  → [Transaction begins]
      Soft-close existing normalized_revenue_lines (effectiveTo = NOW)
      Soft-close existing normalized_cost_lines (effectiveTo = NOW)
      Insert new normalized_revenue_lines (effectiveFrom=NOW, effectiveTo=null, snapshotRunId)
      Insert new normalized_cost_lines (effectiveFrom=NOW, effectiveTo=null, snapshotRunId)
      Soft-close existing program_inflows
      Insert new program_inflows (source='imported', effectiveFrom, snapshotRunId)
      Soft-close existing program_expense
      Insert new program_expense (source='imported', effectiveFrom, snapshotRunId)
      Update smart_import_runs status → COMMITTED
  → [Transaction ends]
  → refreshProjectMetricsAsync(projectId) (smart-import-routes.ts:2509)
      → SELECT from normalized_revenue_lines WHERE effectiveTo IS NULL
      → SELECT from normalized_cost_lines WHERE effectiveTo IS NULL
      → Aggregate financials + tasks + QC
      → UPSERT dashboard_project_metrics
  → refreshProgramMetrics(organizationId)
      → Aggregate from dashboard_project_metrics by org
      → UPSERT dashboard_program_metrics
```

### Verification

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Import commits data | `program_expense` / `program_inflows` rows created | ✅ Confirmed — `smart-import-routes.ts:2191-2226` (expense), `:1947-1997` (inflows) | ✅ |
| `source = 'imported'` | Default on insert | ✅ `finance.ts:64,101` — `rowSourceEnum("source").notNull().default("imported")` | ✅ |
| `effective_from = now()` | Set by temporal helper | ✅ `temporal-helpers.ts:85-100` — `addTemporalColumns()` sets `effectiveFrom: now` | ✅ |
| `import_snapshot = NULL` | Nullable on insert | ✅ `finance.ts:65,102` — `jsonb("import_snapshot")` nullable | ✅ |
| Dashboard refresh triggered | After commit | ✅ `smart-import-routes.ts:2509` — `refreshProjectMetricsAsync(projectId)` | ✅ |
| `dashboard_project_metrics` updated | Upsert with aggregated data | ✅ `dashboard-metrics.ts:211-254` — INSERT ON CONFLICT UPDATE | ✅ |
| Dashboard reads materialized table | V2 endpoint returns rows | ✅ `GET /api/v2/dashboard/metrics` → `dashboardMetricsService()` | ✅ |

### Verdict: ✅ FULLY WIRED — No broken links

---

## Pipeline 2: Task → Project → Dashboard

### Traced Flow

```
Work Item Created/Updated
  → POST /api/v2/projects/:id/work-items (v2-routes.ts)
  → v2-controller.createWorkItem() → v2-service → v2-repository
  → db.insert(workItems) (project-v2-repository.ts:64-82)

Extension Table Population
  → work_item_pm (tasks.ts:220-245) — PM tracking fields
  → work_item_engineering (tasks.ts:251-264) — WBS/import provenance
  → work_item_scheduling (tasks.ts:270-294) — Calendar/baseline
  → Migration: 20260331_work_item_extensions.sql

Dashboard Metrics Update
  → refreshProjectMetrics() queries work_items (dashboard-metrics.ts:91-123)
  → Counts: taskCount, tasksCompleted, tasksInProgress, tasksOverdue, tasksActive
  → Upserts dashboard_project_metrics

Plan Tab Display
  → GET /api/projects/:name/working-plan (routes.ts:9356)
  → Queries work_items with CPM network calculation
  → PATCH /api/working-plan/tasks/:id (routes.ts:9455) syncs to work_items.percentComplete
```

### Verification

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| `work_items` row created | On task creation | ✅ `project-v2-repository.ts:64-82` | ✅ |
| Extension tables populated | 1:1 with work_items | ⚠️ `createWorkItem()` inserts ONLY into `workItems` — extensions not auto-populated | 🔴 |
| Dashboard metrics updated | taskCount/tasksCompleted refreshed | ⚠️ V2 API `patchWorkItem()` does NOT call `refreshProjectMetricsAsync()` | 🔴 |
| Plan tab shows task | Via working-plan endpoint | ✅ `routes.ts:9356` queries work_items for plan display | ✅ |

### Broken Links

**🔴 BREAK 1 — Extension tables not populated on create**
- `createWorkItem()` at `project-v2-repository.ts:80` inserts into `workItems` only
- No subsequent insert into `work_item_pm`, `work_item_engineering`, or `work_item_scheduling`
- **Impact:** Extension data (duration, phase, WBS code) absent for API-created tasks

**🔴 BREAK 2 — Dashboard metrics not refreshed on work item CRUD**
- `patchWorkItem()` at `project-v2-service.ts:55-59` updates work_items but does not trigger refresh
- Dashboard refresh only fires on import commits, lifecycle events, and finance operations
- **Impact:** Task count/completion metrics remain stale until next import or phase change

---

## Pipeline 3: Phase Change → Execution State → Audit

### Traced Flow

```
PATCH /api/lifecycle-board/projects/:id/phase (lifecycle-routes.ts:1356)
  → Validate phase parameter
  → Evaluate Stage Gate (gate checks)
  → Update project_info.phase + phaseUpdatedAt + phaseUpdatedByUserId
  → syncProjectSplitTables() → UPSERT project_execution_state (project-info-sync.ts:107-136)
  → Auto-generate engineering stages if applicable
  → logAuditFromReq() → merge_audit_log record
  → createProjectEvent() → project_events row (eventType="project.stage_changed")
  → refreshProjectMetricsAsync(projectId) (lifecycle-routes.ts:1432)
```

### Verification

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| `project_execution_state` updated | Phase stored here (NOT just project_info) | ✅ Dual-write via `syncProjectSplitTables()` — `project-info-sync.ts:107-136` | ✅ |
| `project_phase_history` record created | Row for each transition | ⚠️ Main PATCH endpoint does NOT insert into `project_phase_history` | 🔴 |
| `domain_events` emitted | Event record created | ✅ `createProjectEvent()` with `eventType="project.stage_changed"` — `lifecycle-routes.ts:1418` | ✅ |
| Dashboard phase/RAG updated | Metrics refreshed | ✅ `refreshProjectMetricsAsync()` at `lifecycle-routes.ts:1432` | ✅ |

### Broken Link

**🔴 BREAK 3 — `project_phase_history` not populated by main phase endpoint**
- Table exists at `projects.ts:147-155` with proper schema (`fromPhase`, `toPhase`, `changedByUserId`, `reason`)
- Migration adds index: `20260340_schema_consistency_fixes.sql:86-87`
- Initial creation record IS written by `template-routes.ts:769-775`
- V2 API DOES write history in `transitionProjectToConstruction()` at `project-v2-repository.ts:42`
- **But** the primary `PATCH /api/lifecycle-board/projects/:id/phase` at `lifecycle-routes.ts:1356-1437` skips this insert entirely
- **Impact:** `project_phase_history` table only has initial creation records; lifecycle transitions not logged to dedicated history table (only to `project_events` and `merge_audit_log`)

---

## Pipeline 4: QC → Quality → Project

### Traced Flow

```
QC Item Updated
  → POST /api/quality/project/:projectName/item/:itemInstanceId (quality-routes.ts:607)
  → db.update(qcItemInstance).set(updates) (quality-routes.ts:678)
  → recalculateWarnings(projectName) async (quality-routes.ts:695)
      → Loads qc_checklist, qc_item_instance, qc_template_item
      → Recalculates warnings → updates qc_warning table

Dashboard Metrics (on next refresh cycle)
  → refreshProjectMetrics() queries qc_item_instance (dashboard-metrics.ts:141-155)
  → Calculates qcProgressPct = approvedItems / totalItems
  → Upserts dashboard_project_metrics.qcProgressPct

Project Detail Quality Tab
  → GET /api/quality/project/:projectName (quality-routes.ts)
  → Returns checklists with item instances, warnings, risk answers
```

### Verification

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| `qc_item_instance` updated | On approval/status change | ✅ `quality-routes.ts:643-678` | ✅ |
| Quality summary in dashboard updated | `qcProgressPct` refreshed | ⚠️ QC routes do NOT call `refreshProjectMetricsAsync()` | 🔴 |
| Quality tab reflects change | Live from `qc_item_instance` | ✅ Quality tab queries source tables directly | ✅ |

### Broken Link

**🔴 BREAK 4 — Dashboard metrics not refreshed after QC updates**
- `recalculateWarnings()` at `quality-routes.ts:2028` recalculates warnings but does NOT trigger `refreshProjectMetricsAsync()`
- `qcProgressPct` in `dashboard_project_metrics` remains stale until next import commit
- **Impact:** Dashboard health score (which weighs QC at 30%) does not reflect real-time quality changes

---

## Pipeline 5: Override (Edit) Flow

### Traced Flow

```
User Edits Financial Value
  → POST /api/cos-tracker/toggle-realised/:id (or similar finance route)
  → inlineEdit(tableName, rowId, fields, userId) (inline-edit-helper.ts:34-87)
      → Snapshots original values to import_snapshot JSONB (first edit only)
      → Sets source = 'imported_edited'
      → Sets last_edited_by = userId, last_edited_at = NOW()
  → ❌ refreshProjectMetricsAsync() NOT called

On Next Import
  → POST /api/smart-import/:runId/commit (smart-import-routes.ts:1374-1509)
  → Check for manual edits:
      → Row-level: cosRealised, invoiceDateConfirmed, paidDateConfirmed flags
      → ChangeSet table: source = 'MANUAL_EDIT'
      → manualEditFlags: field-level edit tracking
  → If conflicts found → Return 409 with conflict list
      → Shows: field, currentValue, importValue, editedByName, editedAt
      → User resolves: 'keep' (preserve manual) or 'import' (overwrite)
  → POST /api/smart-import/:runId/commit with conflictResolutions
      → Applies decisions, records in conflict_resolution_log
  → refreshProjectMetricsAsync(projectId) (smart-import-routes.ts:2509)
```

### Verification

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Base table updated directly | `program_expense` modified | ✅ `inlineEdit()` at `inline-edit-helper.ts:34-87` | ✅ |
| `import_snapshot` preserves original | JSONB snapshot on first edit | ✅ Lines 75-81 — COALESCE logic preserves original imported values | ✅ |
| `source = 'imported_edited'` | Set on manual edit | ✅ Line 65 — `source = 'imported_edited'` | ✅ |
| Dashboard refresh triggered | After edit | ⚠️ Finance edit routes do NOT call `refreshProjectMetricsAsync()` | 🔴 |
| Next import detects manual edit | Conflict detection + prompt | ✅ `smart-import-routes.ts:1374-1509` — checks flags, changeSets, manualEditFlags | ✅ |
| Conflict resolution logged | Decisions recorded | ✅ `conflict_resolution_log` table at `imports.ts:542-555` | ✅ |

### Broken Link

**🔴 BREAK 5 — Dashboard metrics not refreshed after financial edits**
- `finance-routes.ts:34` imports `refreshProjectMetricsAsync` but it is NOT called in any edit route handler
- 4 edit endpoints affected: toggle-realised, revenue-tracking overrides, expenditure overrides, date-override
- **Impact:** Financial metrics (totalRevenue, totalCost, marginPct) stale until next import

---

## Summary of All Broken Links

| # | Pipeline | Broken Link | Severity | Fix Location |
|---|----------|------------|----------|--------------|
| 1 | Task → Dashboard | Extension tables (`work_item_pm`, etc.) not populated on `createWorkItem()` | Medium | `project-v2-repository.ts:80` — add extension inserts |
| 2 | Task → Dashboard | `patchWorkItem()` does not trigger dashboard metrics refresh | Medium | `project-v2-service.ts:55-59` — add `refreshProjectMetricsAsync(projectId)` |
| 3 | Phase → Audit | Main phase PATCH endpoint skips `project_phase_history` insert | High | `lifecycle-routes.ts:1401` — add insert after phase update |
| 4 | QC → Dashboard | QC item updates do not trigger dashboard metrics refresh | Medium | `quality-routes.ts:695` — add `refreshProjectMetricsAsync()` after `recalculateWarnings()` |
| 5 | Override → Dashboard | Finance edit routes do not trigger dashboard metrics refresh | Medium | `finance-routes.ts` — add `refreshProjectMetricsAsync()` in edit handlers |
| 6 | Override → Dashboard | `refreshProjectMetricsAsync` imported but unused in finance-routes | Low | Already imported at line 34, just needs to be called |

---

## Recommendations

### Immediate Fixes (High Priority)

1. **Add `project_phase_history` insert to lifecycle PATCH endpoint**
   - File: `server/lifecycle-routes.ts` near line 1401
   - Insert: `{ projectId, fromPhase, toPhase, changedByUserId, reason }`

2. **Wire `refreshProjectMetricsAsync()` into all data mutation paths**
   - `quality-routes.ts:695` — after `recalculateWarnings()`
   - `project-v2-service.ts:55-59` — after `patchWorkItem()`
   - `finance-routes.ts` — in all override/edit handlers (import already present)

### Near-Term Fixes (Medium Priority)

3. **Populate extension tables on work item creation**
   - `project-v2-repository.ts:80` — add conditional inserts to `work_item_pm`, `work_item_engineering`, `work_item_scheduling` based on payload

4. **Consider event-driven metrics refresh**
   - Currently metrics refresh is coupled to specific route handlers
   - A centralized approach (e.g., call refresh on any write to finance/task/QC tables) would prevent future gaps
