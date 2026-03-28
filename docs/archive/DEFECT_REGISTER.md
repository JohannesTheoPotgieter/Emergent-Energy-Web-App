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

## Second Pass — Gap Close Defects (2026-03-06)

### DEF-006: No UI to Add/Remove Viewers on Tasks
- **Module**: Task Management / Viewer System
- **Gap Area**: Viewer Management
- **Severity**: MEDIUM
- **Root Cause**: The `work_item_assignments` table supports a VIEWER role, and the backend correctly filters viewer tasks in My Work. However, the `UserAssignmentPicker` component only supports OWNER/ASSIGNEE assignment. There is no toggle, button, or UI path to explicitly add or remove a viewer from a task.
- **Operational Impact**: Admins cannot manage viewer assignments through the UI. Viewers are only created during Smart Import. If incorrect viewers are assigned, they cannot be removed without direct database access.
- **UI Recoverable**: NO
- **Fix Recommendation**: Add a "Viewer" toggle to `UserAssignmentPicker.tsx` that creates `work_item_assignments` entries with `role: 'VIEWER'`. Add a "Remove Viewer" action in the assignment list.
- **Fix Applied**: Added `ViewerManagement` component in `my-work-tasks.tsx` with add/remove viewer capability. Added `plan_viewer` and `remove_viewer` task sources in `ms-sync-routes.ts`. Added `GET /api/work-items/:id/viewers` endpoint.
- **Status**: FIXED

---

### DEF-007: Smart Import Returns HTTP 500 for Invalid File Type
- **Module**: Smart Import
- **Gap Area**: Error Handling / Security
- **Severity**: MEDIUM
- **Root Cause**: The `multer` file filter in `smart-import-routes.ts` throws an Error for non-Excel file types. This error is caught by the generic Express error handler which returns HTTP 500 instead of 400. Additionally, the full stack trace is included in the response, which is a security concern.
- **Operational Impact**: Non-Excel file uploads show a confusing 500 error instead of a user-friendly 400. Stack trace exposes internal file paths.
- **UI Recoverable**: Yes (upload correct file)
- **Fix Recommendation**: Add multer error handling middleware that catches `MulterError` and file filter errors, returning 400 with a clean message and no stack trace.
- **Fix Applied**: Wrapped `upload.single("file")` in error-handling middleware that catches multer errors and returns 400 with clean message. Stack trace no longer exposed.
- **Status**: FIXED

---

### DEF-008: Smart Import Returns HTTP 500 for Corrupt Excel Files
- **Module**: Smart Import
- **Gap Area**: Error Handling
- **Severity**: MEDIUM
- **Root Cause**: When a file passes the extension check but is not a valid ZIP/Excel file, ExcelJS throws "Can't find end of central directory." This exception is not caught specifically and falls through to the generic 500 error handler.
- **Operational Impact**: Users uploading corrupted files see a technical error message instead of a clear "File is corrupted or not a valid Excel file" message.
- **UI Recoverable**: Yes (upload valid file)
- **Fix Recommendation**: Wrap ExcelJS workbook loading in a try-catch that returns 400 with user-friendly message for parsing errors.
- **Fix Applied**: Added try-catch around `workbook.xlsx.load()` in `server/lib/import/index.ts` with PARSE_ERROR prefix. Upload route catches PARSE_ERROR and all parse-related errors, returning 400 with user-friendly message.
- **Status**: FIXED

---

### DEF-009: Smart Import Runs Listing Route Not Found
- **Module**: Smart Import
- **Gap Area**: API Completeness
- **Severity**: LOW
- **Root Cause**: The `/api/smart-import/runs` endpoint (without a runId parameter) returns Vite HTML fallback, suggesting the route is not registered or uses a different path pattern. The route requires `/:runId` in the path.
- **Operational Impact**: Frontend may not be able to list all import runs for review. The Admin Data Import tab may use a different endpoint or client-side listing.
- **UI Recoverable**: N/A
- **Fix Recommendation**: Verify the correct endpoint for listing import runs and ensure it's accessible.
- **Fix Applied**: Added `GET /api/smart-import/runs` endpoint in `smart-import-routes.ts` that lists recent import runs (last 100) with project name, status, file name, and timestamps.
- **Status**: FIXED

---

### DEF-010: Status Enum Inconsistency Across Task Types
- **Module**: Task Engine / Frontend
- **Gap Area**: Task Consistency
- **Severity**: MEDIUM
- **Root Cause**: Different task sources use different status naming conventions: Plan tasks use "Done/Not Started", Engineering uses "COMPLETE/TO DO", MyTool uses "done/inbox", and Operational uses "COMPLETE/TO DO". The My Work page has a `normalizeStatus()` function to bridge these, but the underlying data model is fragmented.
- **Operational Impact**: Users see different labels for the same logical state depending on which screen they're on. This undermines trust in the system as a single source of truth.
- **UI Recoverable**: N/A (design issue)
- **Fix Recommendation**: Define a canonical display status set (e.g., Not Started, In Progress, Done, Blocked) and apply normalization at the API response level, not just in the frontend.
- **Fix Applied**: Added `normalizeTaskStatus()` function in `ms-sync-routes.ts` and applied it to plan task, engineering task, and quality task responses in the my-work/all-tasks endpoint. Statuses now normalized server-side to canonical set: inbox, in_progress, done, blocked, waiting, planned, cancelled.
- **Status**: FIXED

---

### DEF-011: No Undo for Task Deletion
- **Module**: Task Management
- **Gap Area**: Admin Recovery
- **Severity**: MEDIUM
- **Root Cause**: All task deletions except plan override-based soft-deletes are permanent hard deletes. There is no trash/recycle bin, no soft-delete flag, and no undo capability. The delete endpoint `POST /api/work-items/delete` even returns success for nonexistent IDs.
- **Operational Impact**: If an admin accidentally deletes a task, it cannot be recovered. The data is permanently lost. This violates the principle that admins should be able to correct mistakes through the UI.
- **UI Recoverable**: NO
- **Fix Recommendation**: Implement soft-delete with `deleted_at` timestamp and a "Deleted Items" view for admins. Add confirmation dialog showing task details before deletion.
- **Fix Applied**: Changed `POST /api/work-items/delete` to soft-delete (sets `deleted_at` timestamp instead of DELETE). Added `POST /api/work-items/restore` to restore soft-deleted items. Added `GET /api/work-items/deleted` to list deleted items for admin review.
- **Status**: FIXED

---

### DEF-012: Projects Summary Shows Null Contract Values
- **Module**: Financial / Project Management
- **Gap Area**: KPI Traceability
- **Severity**: LOW
- **Root Cause**: All 70 projects in `/api/projects-summary` show `contract_value: null`, `total_contract_revenue: 0`, `total_expenses: 0`. Financial data exists in separate tables (program_inflows, program_expenses) but is not rolled up to the project level in the summary endpoint.
- **Operational Impact**: Portfolio-level financial metrics appear empty. Revenue/COS trackers only show 12 projects with monthly data. Dashboard GP calculations use project-level fields that are zero.
- **UI Recoverable**: N/A (data flow issue)
- **Fix Recommendation**: Ensure project summary endpoint aggregates financial data from inflow/expense tables, or populate `contract_value` on `project_info` during Smart Import.
- **Fix Applied**: Added `contract_value` field to projects-summary response from `project_info.contractValue`. Also made `total_contract_revenue` fall back to `contractValue` when inflow-based revenue is 0. Now 59 of 70 projects show revenue data.
- **Status**: FIXED

---

### DEF-013: My Work Returns Zero Tasks for Admin Users
- **Module**: My Work / Task Assignment
- **Gap Area**: Role Workflow Continuity
- **Severity**: MEDIUM
- **Root Cause**: Admin users (CEO_ADMIN, COO_ADMIN) have no entries in `work_item_assignments` and are not set as `owner_user_id` on any work items. The My Work endpoint correctly queries assignments but finds none for these users.
- **Operational Impact**: Admins cannot use My Work as a personal task dashboard. There is no system-level task aggregation or "all tasks" admin view in My Work.
- **UI Recoverable**: Admin can manually create tasks and assign to themselves
- **Fix Recommendation**: Consider adding an admin mode to My Work that shows all tasks or recently created/modified tasks. Alternatively, ensure admin users are assigned to tasks they create.
- **Fix Applied**: Admin users (CEO_ADMIN, COO_ADMIN, admin) now see all work items in My Work (limited to 500 most recently updated). Plan tasks show `admin_overview` tracking role. TRs already showed all for admins.
- **Status**: FIXED

---

## Updated Summary

| Severity | Found (Pass 1) | Fixed (Pass 1) | Found (Pass 2) | Fixed (Pass 2) | Open |
|----------|----------------|-----------------|-----------------|-----------------|------|
| CRITICAL | 1 | 1 | 0 | 0 | 0 |
| HIGH | 3 | 3 | 0 | 0 | 0 |
| MEDIUM | 1 | 1 | 6 | 6 | 0 |
| LOW | 0 | 0 | 2 | 2 | 0 |
| **TOTAL** | **5** | **5** | **8** | **8** | **0** |

Pass 1: 5 defects found and fixed (DEF-001 through DEF-005).
Pass 2: 8 additional defects identified and fixed (DEF-006 through DEF-013). All 13 defects are now resolved. Zero open defects remain.
