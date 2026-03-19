# Engineering Module — Comprehensive Fix Plan

**Date:** 2026-03-19
**Based on:** Audit Reports 01–06
**Scope:** All findings across data model, frontend, stages, SharePoint, API, and test coverage

---

## What Was Already Fixed (Prompt 07)

Audit 01 flagged 25 endpoints bypassing the work_items adapter. We migrated **13 endpoints** from `operational_tasks` to the adapter, reducing direct references from 16 to 3. Changes:

- Added 10 columns to `work_items` (holdReason, blockedType, completedAt, link fields, etc.)
- Extended `updateEngineeringWorkItem()` to persist holdReason/blockedType (was being lost)
- Added `getEngineeringWorkItemById()` for single-item lookup
- Migrated: GET/:id, send-for-approval, send-deliverable, link, subtasks, bulk-update, standup, warnings/scan, 5 dashboard endpoints

**Remaining operational_tasks references (3):**
1. `POST /api/eng/backfill-assignees` (admin utility — low priority)
2. Two project-level queries (lines 3181, 3442)

---

## Phase 1: Critical Runtime Bugs (P0)

### 1.1 — Fix `handleStatusChange` out-of-scope variables
- **Source:** Audit 02, Bug #1
- **File:** `client/src/pages/EngineeringTasksPage.tsx:1177-1178`
- **Problem:** `TaskDetailDrawer` references `tasks` (plural) and `taskId` which are NOT in scope — will crash at runtime
- **Fix:** Use the `task` prop directly instead of searching through `tasks`

### 1.2 — Fix `filterStatuses` not passed as prop to MyTasksView
- **Source:** Audit 02, Bug #2
- **File:** `client/src/pages/EngineeringTasksPage.tsx:3109`
- **Problem:** `filterStatuses` used in `MyTasksView` but never passed as prop — "Cannot read property 'map' of undefined"
- **Fix:** Pass `filterStatuses` as a prop from the parent component

### 1.3 — Fix `evaluateAuthorityForRequest` not imported
- **Source:** Audit 02, Bug #3 / Audit 05, Issue #3
- **File:** `server/engineering-routes.ts:1720-1721`
- **Problem:** Function called but never imported — PATCH /api/deliverables/:id will crash
- **Fix:** Add import from `./permission-middleware`

### 1.4 — Migrate remaining 3 `operational_tasks` references
- **Source:** Audit 01
- **File:** `server/engineering-routes.ts` lines 325, 3181, 3442
- **Fix:** Convert backfill-assignees and project-level queries to use work_items

---

## Phase 2: Data Integrity & Consistency (P0-P1)

### 2.1 — FK migration: task_comments, task_activity_log, etc.
- **Source:** Audit 01, FK Dependencies table
- **Problem:** 7 tables have hard FKs to `operational_tasks.id` (comments, checklists, attachments, deliverables, activity_log, watchers, ms_objects)
- **Risk:** Tasks created via adapter (work_items) cannot have comments/activity because FK references operationalTasks
- **Fix:** Add parallel FK columns pointing to `work_items.id` with fallback resolution. Or create a migration that adds `work_item_id` columns to these tables and populates them via legacyId mapping.
- **Priority:** P0 — blocks comment/activity functionality for new tasks

### 2.2 — GET /api/eng/tasks/:id enrichment parity
- **Source:** Audit 05, Issue #2
- **Problem:** List endpoint returns enriched data (resolvedAssignees, deliverables, MS items); detail endpoint returns raw adapter output
- **Fix:** Already partially addressed (now returns adapter-mapped data). Add enrichment for deliverables, MS objects, and resolved assignee names to `getEngineeringWorkItemById()`
- **Priority:** P1

### 2.3 — Bulk update transaction safety
- **Source:** Audit 05, Issue #4
- **Problem:** Bulk update of 100 tasks — if #50 fails, first 49 are committed with no rollback
- **Fix:** Wrap in `db.transaction()` block
- **Priority:** P1

---

## Phase 3: Frontend Fixes (P1)

### 3.1 — Consolidate duplicate `engFetch`
- **Source:** Audit 02, Duplicate #1
- **Files:** `client/src/components/tabs/EngineeringStagesTab.tsx:36-41` (local) vs `client/src/lib/eng-fetch.ts` (shared)
- **Problem:** Local version has different error behavior than shared version
- **Fix:** Replace local `engFetch` in EngineeringStagesTab with import from `client/src/lib/eng-fetch.ts`

### 3.2 — Remove dead `useEngineeringTaskFilters` hook
- **Source:** Audit 02, Duplicate #2
- **File:** `hooks/useEngineeringTaskFilters.ts` (43 lines, simple version)
- **Problem:** Dead code — comprehensive version in `client/src/hooks/` is used instead
- **Fix:** Delete the dead simple version

### 3.3 — Fix ProjectKanbanView silent 403
- **Source:** Audit 02, Gap #1
- **Problem:** Non-admin users accessing Projects view get silent 403 with no UI feedback
- **Fix:** Either hide the Projects tab for non-admin roles OR add a permission-based fetch with user-friendly error messaging

### 3.4 — Extract shared hold dialog component
- **Source:** Audit 02, Duplicate #7
- **Problem:** Two independent hold dialog implementations (page-level + drawer) maintained separately
- **Fix:** Extract into a shared `<HoldReasonDialog>` component used by both

---

## Phase 4: Engineering Stages Integration (P1)

### 4.1 — Link stage tasks to work_items
- **Source:** Audit 03, Section 4 (Critical Finding)
- **Problem:** `project_eng_tasks` are COMPLETELY SEPARATE from `work_items` and `operational_tasks` — completing a stage task does NOT update the task board
- **Fix options:**
  - **Option A (Recommended):** Add `workItemId` FK to `project_eng_tasks`. When a stage task completes, also update the corresponding work_item status.
  - **Option B:** Create a sync trigger that listens for stage task status changes and propagates to work_items
- **Priority:** P1 — users currently must maintain two systems manually

### 4.2 — Connect default work items to stage tasks
- **Source:** Audit 03, Section 4
- **Problem:** `generateDefaultEngineeringWorkItemsForProject()` creates 16 generic work_items NOT tied to stage tasks
- **Fix:** When generating stages, also create corresponding work_items and link them via `project_eng_tasks.workItemId`

---

## Phase 5: API Hardening (P1-P2)

### 5.1 — Add structured error responses
- **Source:** Audit 05, Issue #1
- **Problem:** All 72+ endpoints use generic `{ error: "Internal server error" }` catch
- **Fix:** Create error middleware that returns structured responses:
  ```json
  { "error": "message", "code": "VALIDATION_ERROR", "field": "status" }
  ```
  Apply to validation errors (400), not internal errors (500).
- **Priority:** P2

### 5.2 — Add auth to constants endpoint
- **Source:** Audit 05, Issue #5
- **Problem:** `GET /api/eng/constants` has no `requireAuth`
- **Fix:** Add `requireAuth` middleware
- **Priority:** P2

### 5.3 — Add task-level authorization
- **Source:** Audit 05, Auth Gap
- **Problem:** Any authenticated user can modify any task if they know the ID
- **Fix:** Add ownership or project-membership check on write operations (PATCH, DELETE, comments)
- **Priority:** P2

---

## Phase 6: SharePoint UI (P2)

### 6.1 — COO Control Panel
- **Source:** Audit 04, Section 2.1
- **Problem:** No UI for COO to trigger pull/push, configure SP, or view sync history
- **Fix:** Create `/pages/sharepoint-intake.tsx` with intake list, manual pull trigger, config display
- **Priority:** P2 — backend is ready, just needs UI

### 6.2 — Conflict Resolution UI
- **Source:** Audit 04, Section 2.2
- **Problem:** Conflict detection works, resolution endpoint exists, but no UI
- **Fix:** Side-by-side comparison modal with Keep SP / Keep App / Merge options
- **Priority:** P2

### 6.3 — Push-to-SharePoint field selection
- **Source:** Audit 04, Section 2.3
- **Problem:** Push only updates metadata columns, no UI to trigger with field selection
- **Fix:** UI for selecting which fields to push back to SharePoint
- **Priority:** P3

---

## Phase 7: Test Coverage (P1-P2)

### 7.1 — P0 runtime bug regression tests
- Tests for handleStatusChange in drawer (1.1)
- Tests for filterStatuses prop (1.2)
- Tests for evaluateAuthorityForRequest (1.3)

### 7.2 — Data integrity tests
- work_items ↔ operational_tasks consistency after migration
- Task creation → comment creation → verify FK integrity
- Bulk update partial failure handling

### 7.3 — Workflow guard edge cases
- Approval + deliverable sequencing
- All status transition matrix
- HOLD/ON HOLD normalization variants

### 7.4 — Engineering Stages tests
- Stage generation creates correct tasks
- Stage completion gate validation (all 4 rules)
- COO override bypasses gates
- Deliverable upload requirement per stage

### 7.5 — Deliverable flow tests
- Send deliverable → acknowledge full flow
- File upload validation (type, size limits)
- Override reason capture audit trail

---

## Implementation Order

| Step | Phase | Items | Priority | Est. Effort |
|------|-------|-------|----------|-------------|
| 1 | Phase 1 | Runtime bugs (1.1, 1.2, 1.3, 1.4) | P0 | Small |
| 2 | Phase 2 | FK migration + enrichment (2.1, 2.2) | P0-P1 | Medium |
| 3 | Phase 3 | Frontend fixes (3.1-3.4) | P1 | Small |
| 4 | Phase 2 | Transaction safety (2.3) | P1 | Small |
| 5 | Phase 7 | P0 regression tests (7.1) | P1 | Small |
| 6 | Phase 4 | Stages → work_items link (4.1, 4.2) | P1 | Medium |
| 7 | Phase 5 | API hardening (5.1-5.3) | P1-P2 | Medium |
| 8 | Phase 7 | Remaining tests (7.2-7.5) | P2 | Medium |
| 9 | Phase 6 | SharePoint UI (6.1-6.3) | P2-P3 | Large |

---

## Success Criteria

1. **Zero runtime crashes** — all P0 bugs fixed and regression-tested
2. **Single source of truth** — all engineering endpoints read/write work_items only (0 operational_tasks references in engineering routes)
3. **FK integrity** — comments, activity, watchers work for tasks created via adapter
4. **Stage sync** — completing a stage task updates the task board
5. **17+ existing tests still pass** — no regressions
6. **New tests cover** all P0 bugs and critical workflows
