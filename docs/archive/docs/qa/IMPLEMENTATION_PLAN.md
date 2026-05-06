# IMPLEMENTATION PLAN — Trust-Hardening Fixes

**Date:** 2026-03-19
**Source:** Second-Pass Gap-Close Audit (DEFECT_REGISTER.md)
**Scope:** 12 defects across 3 phases

---

## IMPORTANT DISCOVERIES DURING PLANNING

1. **`operational_tasks` already has a `deletedAt` column** (schema.ts:1166) — the DELETE endpoint in routes.ts:11983 just isn't using it (hard-deletes instead of soft-deletes)
2. **Admin recovery routes already exist** at `server/admin-recovery-routes.ts` — includes `GET /api/admin/recovery/deleted` and `POST /api/admin/recovery/restore` for all 4 task types
3. **The Smart Import commit is already wrapped in a transaction** (smart-import-routes.ts:1630) — the concern about non-atomic commits is mitigated; the real gap is that program_inflows/program_expense writes happen INSIDE the transaction but rollback doesn't delete them

These discoveries reduce the effort for GC-002, GC-007, and GC-011 significantly.

---

## PHASE 1: MUST FIX — Data Integrity (3 items)

### GC-007: Smart Import Commit Transaction Atomicity

**Revised Assessment:** The commit IS wrapped in `db.transaction()` at line 1630. The actual risk is narrower than initially reported — if the transaction fails, all normalized_* inserts roll back. The gap is that `program_inflows` and `program_expense` inserts (legacy tables) at lines 1991 and 2214 are INSIDE the transaction, so they DO roll back on failure.

**Actual Remaining Risk:** If an error occurs OUTSIDE the transaction (e.g., updating the smart_import_runs record at line 2373), the data is committed but the run status may not update.

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/smart-import-routes.ts` |
| **Change** | Move the `smart_import_runs` status update (line ~2373) INSIDE the transaction block, before the transaction closes |
| **Migration** | None |
| **Complexity** | **S** — Move ~5 lines of code inside the transaction |
| **Dependencies** | None |
| **Risk** | LOW — Moving code inside existing transaction |

**Code Change:**
```
File: server/smart-import-routes.ts
Move the run status update from AFTER the transaction to INSIDE it:
- Find: status update to COMMITTED after the transaction closes (~line 2373)
- Move it inside the `await db.transaction(async (tx: any) => { ... })` block
- Use `tx` instead of `db` for the update
```

---

### GC-001: Smart Import Rollback — Extend to Legacy Tables

**Current rollback (lines 2548-2593)** deletes from: `normalizedRevenueLines`, `normalizedCostLines`, `normalizedExecutionPhases`, `workItems` (+ cascading dependencies/assignments). It does NOT delete from `programInflows` or `programExpense`.

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/smart-import-routes.ts` |
| **Change** | Add two DELETE statements inside the rollback transaction (after line 2551) to remove `program_inflows` and `program_expense` rows that match the import run |
| **Migration** | None — `program_expense` already has `importRunId` column (schema.ts:162). `program_inflows` also has `importRunId` (schema.ts:191) |
| **Complexity** | **S** — Add 2 SQL delete statements |
| **Dependencies** | None |
| **Risk** | LOW — Straightforward delete within existing transaction |

**Code Change:**
```
File: server/smart-import-routes.ts, inside rollback transaction (~line 2551):

Add:
  await tx.delete(programInflows).where(eq(programInflows.importRunId, runId));
  await tx.delete(programExpense).where(eq(programExpense.importRunId, runId));
```

---

### GC-002: Convert Operational Task DELETE to Soft Delete

**Discovery:** `operational_tasks` already has a `deletedAt` column (schema.ts:1166). The DELETE endpoint at routes.ts:11983 calls `storage.deleteOperationalTask(id)` which hard-deletes. The fix is simply to change this to a soft delete (set `deletedAt = now()`).

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/routes.ts` (DELETE endpoint, line ~11983), `server/storage.ts` or wherever `deleteOperationalTask` is implemented |
| **Change** | Change `deleteOperationalTask()` from hard DELETE to soft delete: `UPDATE operational_tasks SET deleted_at = NOW() WHERE id = ?` |
| **Also Fix** | Ensure all SELECT queries for operational_tasks filter `WHERE deleted_at IS NULL` (most likely already do since the column exists) |
| **Migration** | None — column already exists |
| **API Change** | None — same endpoint, same response. Just changes behavior from permanent to recoverable |
| **Frontend Change** | None needed immediately — recovery already available via `/api/admin/recovery/restore` |
| **Complexity** | **S** — Change one function from DELETE to UPDATE |
| **Dependencies** | None |
| **Risk** | LOW — But verify all operational_tasks queries already filter by deletedAt |

**Code Change:**
```
File: server/routes.ts, line ~11997:
Change: await storage.deleteOperationalTask(id)
To:     await storage.softDeleteOperationalTask(id)  // sets deletedAt = new Date()

File: server/storage.ts (or equivalent):
Change the deleteOperationalTask implementation from:
  await db.delete(operationalTasks).where(eq(operationalTasks.id, id))
To:
  await db.update(operationalTasks).set({ deletedAt: new Date() }).where(eq(operationalTasks.id, id))
```

---

## PHASE 2: SHOULD FIX — Operational Trust (5 items)

### GC-003: Server-Side KPI Health Summary Endpoint

**Current state:** 8 of 12 KPIs are computed client-side in project-detail.tsx:1060-1139 from multiple independent API queries.

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/routes.ts` (new endpoint), `client/src/pages/project-detail.tsx`, `client/src/components/ProjectCommandHeader.tsx` |
| **New Endpoint** | `GET /api/projects/:projectId/health-summary` |
| **Response Shape** | `{ revenueRealisedPct, cosRealisedPct, marginDelta, scheduleRag, costRag, qualityRag, overallRag, contractValue, completionPct, nextMilestone, overdueTaskCount, engineeringProgressPct }` |
| **Server Logic** | Move the computation from project-detail.tsx:1060-1139 to a server function that queries the same tables and returns computed values |
| **Frontend Change** | Replace 6+ separate useQuery calls with a single `useQuery(["project-health", projectId])`. Keep existing queries for tab-specific data |
| **Migration** | None |
| **Complexity** | **L** — New endpoint + server logic + frontend refactor |
| **Dependencies** | None |
| **Risk** | MEDIUM — Must ensure server computation matches current client computation exactly during transition |

**Implementation Steps:**
1. Create `server/lib/project-health.ts` — function `computeProjectHealth(projectId: number)` that queries plan tasks, expenses, revenue, quality summary
2. Add route `GET /api/projects/:id/health-summary` in routes.ts
3. In project-detail.tsx, add `useQuery(["project-health", projectInfoId])`
4. Replace inline KPI computations with values from health summary response
5. Keep individual data queries for tab rendering (they're still needed for the actual tab content)

---

### GC-004: Microsoft Integration Honest Classification

**This is a documentation/UI change, not a code fix for MS integration itself.**

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `client/src/components/ProjectCommandHeader.tsx` (or wherever MS status is shown), any MS-related UI components |
| **Change** | When no MS account is linked, show explicit "Microsoft Not Connected" badge instead of silently showing empty state. Add a connect/setup link |
| **Also Change** | Update any dashboard or feature list that claims MS integration as "active" — replace with "Available (requires account linking)" |
| **Complexity** | **S** — UI indicator changes |
| **Dependencies** | None |
| **Risk** | LOW |

**Code Change:**
```
In any component that renders MS data (e.g., ProjectChatTab, CalendarView if MS-linked):
- Check if MS account is linked for current user
- If not linked: show "Connect Microsoft Account" card/banner
- If linked but sync failed: show "Microsoft Sync Error" with retry button
```

---

### GC-006: Simplify Import Conflict Resolution

**Current state:** 7+ conflict types during re-import require per-field decisions.

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `client/src/pages/smart-import.tsx` (commit step, lines ~2271-3203), `server/smart-import-routes.ts` (conflict detection, lines ~1374-1508) |
| **Change** | Add a "Keep All Manual Edits" button prominently at the top of the conflict resolution UI. When clicked, it sets `preserveManualEdits=true` for all fields without requiring per-field decisions |
| **Also Add** | A diff preview showing "Imported Value" vs "Manual Edit Value" for each conflicting field |
| **Complexity** | **M** — Frontend UI changes + a new "keep all" resolution path |
| **Dependencies** | None |
| **Risk** | LOW — Additive feature, doesn't change existing conflict resolution |

**Implementation Steps:**
1. In smart-import.tsx commit step: Add "Keep All Manual Edits (Recommended)" button above per-field conflict cards
2. Button sets all conflict resolutions to "preserve" and proceeds to commit
3. Add diff table showing old vs new values for context
4. Keep existing per-field resolution as advanced option

---

### GC-008: Task Type Conversion

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/routes.ts` (new endpoint), `server/storage.ts` (new function), `client/src/components/TaskDetailDrawer.tsx` (UI action) |
| **New Endpoint** | `POST /api/tasks/convert` with body `{ sourceId, sourceType, targetType }` |
| **Server Logic** | 1. Read source task. 2. Create new task in target table with mapped fields. 3. Migrate comments/attachments where possible. 4. Soft-delete source task. 5. Return new task ID |
| **Supported Conversions** | operational ↔ work_item (bidirectional), operational → engineering_task |
| **Frontend** | Add "Convert to..." dropdown in TaskDetailDrawer actions menu |
| **Migration** | None |
| **Complexity** | **L** — Cross-table data migration logic, field mapping, UI |
| **Dependencies** | GC-002 (soft delete) should be done first so converted source tasks are recoverable |
| **Risk** | MEDIUM — Field mapping between tables may lose data (e.g., operational.assignees[] → work_item_assignments requires user lookup) |

**Implementation Steps:**
1. Define field mapping table: operational_tasks → work_items column map
2. Create `server/lib/task-converter.ts` with conversion logic per type pair
3. Add endpoint with auth/permission checks
4. Add UI action in TaskDetailDrawer

---

### GC-011: Surface Existing Restore UI

**Discovery:** Admin recovery routes ALREADY EXIST at `server/admin-recovery-routes.ts` with `GET /api/admin/recovery/deleted` and `POST /api/admin/recovery/restore`. The gap is only that this feature may not be surfaced in the admin UI prominently.

| Attribute | Detail |
|-----------|--------|
| **Files to Check** | `client/src/pages/admin-recovery.tsx` (or equivalent) — verify the UI exists and is accessible |
| **Change** | If admin recovery page already exists: add it to sidebar nav under SYSTEM group. If not: create simple page that calls existing API endpoints |
| **Also Add** | Toast notification when a task is deleted: "Task deleted. [Undo]" with 10-second window to call restore API |
| **Complexity** | **S-M** — Either surface existing UI or create simple list page |
| **Dependencies** | GC-002 (so operational tasks appear in the deleted items list) |
| **Risk** | LOW |

**Implementation Steps:**
1. Verify `/admin/recovery` page exists in page-registry.ts (check `adminRecovery` entry)
2. If page exists: ensure it's accessible from sidebar or admin menu
3. Add "Recently Deleted" count badge to admin nav item
4. Optionally: add "Undo" toast on task deletion that auto-restores within timeout

---

## PHASE 3: POLISH — Consistency (4 items)

### GC-005: Configurable RAG Thresholds

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `shared/schema.ts` (new table or config), `server/routes.ts` (config endpoint), `client/src/pages/project-detail.tsx` (read config), admin settings page |
| **Change** | Move hardcoded thresholds to a system config table: `system_config` with keys like `rag.schedule.amber_threshold`, `rag.schedule.red_threshold`, `rag.cost.amber_ratio`, `rag.cost.red_ratio` |
| **Migration** | New `system_config` table with default rows matching current hardcoded values |
| **Complexity** | **M** — New table, endpoint, admin UI, and wiring into KPI computation |
| **Dependencies** | GC-003 (if health summary endpoint is built, thresholds should be server-side) |
| **Risk** | LOW — Defaults match current behavior |

---

### GC-009: Unify Status Naming

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `client/src/components/ui/status-badge.tsx` (new shared component), all task rendering components |
| **Change** | Create a canonical status display mapping and shared `<StatusBadge>` component. Map all internal status values to display values: `{ "TO DO": "To Do", "NOT_STARTED": "To Do", "Not Started": "To Do", "inbox": "Inbox", "COMPLETE": "Complete", "Done": "Complete", ... }` |
| **Migration** | None (display-only change; internal values stay the same) |
| **Complexity** | **M** — New component + update all consumers |
| **Dependencies** | None |
| **Risk** | LOW — Display-only; no data changes |

**Implementation Steps:**
1. Create `client/src/components/ui/status-badge.tsx` with canonical mapping
2. Define shared color scheme per display status
3. Find and replace all inline status badge rendering across: project-detail.tsx (STATUS_BADGE object), BoardView, TaskDetailDrawer, EngTasksTab, QualityTab, MyWorkTasksPage
4. Each consumer passes raw status; StatusBadge handles display normalization

---

### GC-010: Normalize Engineering Status Casing

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `server/engineering-routes.ts` or equivalent API response |
| **Change** | Normalize all engineering stage status values to uppercase at the API level: `"complete"` → `"COMPLETE"`, `"in_progress"` → `"IN_PROGRESS"` |
| **Also Fix** | `client/src/pages/project-detail.tsx:1179-1185` — currently handles both cases. After normalization, simplify to single case |
| **Migration** | Optional: `UPDATE engineering_stages SET status = UPPER(status)` if stored in DB |
| **Complexity** | **S** — API response normalization |
| **Dependencies** | GC-009 (StatusBadge would handle display; this fix ensures data consistency) |
| **Risk** | LOW — But verify all consumers handle the casing change |

---

### GC-012: Contract Value Reconciliation

| Attribute | Detail |
|-----------|--------|
| **Files to Change** | `client/src/components/ProjectCommandHeader.tsx`, `server/smart-import-routes.ts` (commit logic) |
| **Change 1** | During Smart Import commit, if sum of revenue milestones differs from `project_info.contract_value` by >5%, add a WARNING issue |
| **Change 2** | In ProjectCommandHeader, if `contractValue` was computed (fallback) rather than from `project_info`, show a subtle indicator (e.g., "(est.)" suffix) |
| **Complexity** | **S** — Conditional logic additions |
| **Dependencies** | None |
| **Risk** | LOW |

---

## IMPLEMENTATION TIMELINE

```
Phase 1 — MUST FIX (Data Integrity)           Estimated: 1-2 days
  ├── GC-007: Move status update inside tx     [S] 0.5h
  ├── GC-001: Add legacy table deletes         [S] 0.5h
  └── GC-002: Soft delete operational tasks    [S] 1-2h

Phase 2 — SHOULD FIX (Operational Trust)       Estimated: 3-5 days
  ├── GC-011: Surface restore UI               [S-M] 0.5-1 day
  ├── GC-004: MS integration indicators        [S] 0.5 day
  ├── GC-006: Simplify conflict resolution     [M] 1 day
  ├── GC-003: Server-side health endpoint      [L] 1-2 days
  └── GC-008: Task type conversion             [L] 1-2 days

Phase 3 — POLISH (Consistency)                 Estimated: 2-3 days
  ├── GC-010: Normalize eng status casing      [S] 0.5h
  ├── GC-012: Contract value reconciliation    [S] 0.5 day
  ├── GC-009: Unified StatusBadge component    [M] 1 day
  └── GC-005: Configurable RAG thresholds      [M] 1 day

TOTAL ESTIMATED: 6-10 days
```

---

## DEPENDENCY GRAPH

```
GC-002 (soft delete) ──→ GC-008 (task conversion)
                     ──→ GC-011 (restore UI)

GC-003 (health endpoint) ──→ GC-005 (configurable thresholds — server-side)

GC-009 (StatusBadge) ──→ GC-010 (eng status normalization feeds into shared badge)

All others are independent.
```

---

## QUICK WINS (Can Be Done Today)

1. **GC-007** — Move 5 lines of code inside transaction block (~30 min)
2. **GC-001** — Add 2 delete statements to rollback (~30 min)
3. **GC-002** — Change hard delete to soft delete (~1-2 hours)
4. **GC-010** — Normalize engineering status casing (~30 min)

These 4 fixes address the most critical data integrity and consistency issues with minimal effort and risk.
