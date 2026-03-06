# Emergent Energy Dashboard - Defect Register

## Audit Date: 2026-03-06

---

## Severity Levels
- **CRITICAL**: System crash, data loss, or security vulnerability
- **HIGH**: Feature broken, blocking user workflow
- **MEDIUM**: Feature degraded, workaround exists
- **LOW**: Cosmetic or minor inconvenience

---

## Defect Log

### DEF-001: MS Sync Status endpoint returns 500
- **Module**: Microsoft Integration
- **Screen**: Any page that checks MS sync status
- **Severity**: HIGH
- **Root Cause**: `getSyncStatus()` in `server/ms-sync-service.ts` used array destructuring on `db.execute()` result, but `db.execute()` returns `{ rows: [...] }` not a direct array. The destructuring failed silently, causing the function to throw.
- **Fix Strategy**: Changed to access `.rows[0]` from the result object with fallback for both formats.
- **Files Changed**: `server/ms-sync-service.ts` (lines 215-230)
- **Status**: FIXED
- **Regression Test**: GET /api/ms-sync/status now returns 200 with `{"lastSync":null,"counts":{"events":0,"emails":0,"teams":0}}`

---

### DEF-002: QC item migration fails on startup
- **Module**: Data Migration / Quality
- **Screen**: N/A (startup backfill)
- **Severity**: HIGH
- **Root Cause**: Migration query in `server/work-items-backfill.ts` referenced `qi.notes` and `qi.status` columns on the `qc_item_instance` table, but these columns don't exist. The actual columns are no notes column (should be NULL) and `qm_status` instead of `status`.
- **Fix Strategy**: Changed `qi.notes` to `NULL` and `qi.status` to `qi.qm_status` in the migration SQL.
- **Files Changed**: `server/work-items-backfill.ts` (lines 305-311)
- **Status**: FIXED
- **Regression Test**: Startup now shows `[Backfill] Migrated 460 qc_item_instance -> work_items` instead of the error.

---

### DEF-003: Project edit endpoint returns 500 for unrecognized fields
- **Module**: Project Management
- **Screen**: Project Summary Edit
- **Severity**: MEDIUM
- **Root Cause**: The Zod schema used `.strict()` which rejects any fields not in the schema. When a client sends fields like `phase` (which is a valid project field but not in the edit schema), the endpoint throws a ZodError which is caught by a generic catch block that returns 500 instead of 400.
- **Fix Strategy**: Removed `.strict()` from the Zod schema (now silently strips unknown fields) and added ZodError-specific catch handling that returns 400 with a meaningful message.
- **Files Changed**: `server/routes.ts` (lines 2715-2746)
- **Status**: FIXED
- **Regression Test**: POST with unknown fields now returns 200 (strips unknown fields), and actual validation errors return 400 with descriptive messages.

---

### DEF-004: TaskDetailDrawer crashes with "trackingRole is not defined"
- **Module**: Task Management
- **Screen**: Task Detail Drawer (opened from Project Plan, Engineering, or any task list)
- **Severity**: CRITICAL
- **Root Cause**: The `TaskDetailDrawer` component destructures `trackingRole` from its props, but the inner `TaskDetailContent` child component (a separate function) references `trackingRole` without receiving it as a prop. This causes a JavaScript ReferenceError when the drawer renders.
- **Fix Strategy**: Added `trackingRole` to the props passed from `TaskDetailDrawer` to `TaskDetailContent`, and added the prop to the child's type signature.
- **Files Changed**: `client/src/components/TaskDetailDrawer.tsx` (lines 365-420)
- **Status**: FIXED
- **Regression Test**: Task detail drawer opens without error. Tracking/viewing badges display correctly.

---

### DEF-005: Task deletion on Project Plan view does not work for canonical work items
- **Module**: Task Management / Project Plan
- **Screen**: UnifiedPlanTab (Project Plan tab)
- **Severity**: HIGH
- **Root Cause**: Two issues combined:
  1. The canonical code path in the planning-tasks endpoint set `rowNumber: idx + 1` for all work items, causing the frontend delete mutation to route them through the override-based soft-delete path (`POST /api/project-plan/delete-tasks`).
  2. The canonical code path never applied overrides (`applyProjectPlanOverrides`), so the soft-delete override was created but had no effect — tasks reappeared on next load.
- **Fix Strategy**:
  1. Set `rowNumber: null` for canonical work items so they route to the `POST /api/work-items/delete` hard-delete path instead.
  2. Added `workItemId` field to the canonical task response (the actual `work_items.id` primary key) so the frontend can send the correct ID for deletion.
  3. Updated the frontend delete mutation to use `task.workItemId` when available.
- **Files Changed**: `server/routes.ts` (line 10834), `server/work-items-adapter.ts` (line 68), `client/src/components/tabs/UnifiedPlanTab.tsx` (line 619)
- **Status**: FIXED
- **Regression Test**: Delete button for canonical work items now correctly removes the task via work-items/delete endpoint.

---

## Summary

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| CRITICAL | 1 | 1 | 0 |
| HIGH | 3 | 3 | 0 |
| MEDIUM | 1 | 1 | 0 |
| LOW | 0 | 0 | 0 |
| **TOTAL** | **5** | **5** | **0** |

All identified defects have been resolved.
