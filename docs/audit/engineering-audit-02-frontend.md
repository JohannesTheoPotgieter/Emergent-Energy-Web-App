# Audit 2: Frontend Component Audit

**Date:** 2026-03-19
**Scope:** Engineering module UI — bugs, broken references, dead code
**Status:** Read-only audit — no changes made

---

## CRITICAL Runtime Bugs

### Bug #1: `handleStatusChange` References Out-of-Scope Variables
- **File:** `client/src/pages/EngineeringTasksPage.tsx:1177-1178`
- **Severity:** CRITICAL — will crash at runtime
- **Issue:** Inside `TaskDetailDrawer`, `handleStatusChange` references `tasks` (plural) and `taskId` which are NOT in scope. The drawer receives `task` (singular) as a prop.
- **Impact:** Any user attempting to change a task's status inside the drawer will hit a runtime error.
- **Fix needed:** Use the `task` prop directly instead of searching through `tasks`.

### Bug #2: `filterStatuses` Not Passed as Prop to MyTasksView
- **File:** `client/src/pages/EngineeringTasksPage.tsx:3109`
- **Severity:** CRITICAL — will crash at runtime
- **Issue:** `filterStatuses` is defined in parent `EngineeringTasksPage` scope (line 3805) but never passed to `MyTasksView` as a prop. The component uses it on line 3109 to map status filter options.
- **Impact:** "Cannot read property 'map' of undefined" error when the MyTasksView component renders.

### Bug #3: `evaluateAuthorityForRequest` Not Imported
- **File:** `server/engineering-routes.ts:1707-1708`
- **Severity:** HIGH — will crash when endpoint is hit
- **Issue:** The function `evaluateAuthorityForRequest` is called in `PATCH /api/deliverables/:id` but is not imported. The file imports `requireAuthority` and `requirePermission` from permission-middleware, but not `evaluateAuthorityForRequest`.
- **Impact:** Any request to PATCH a deliverable's status will fail.

---

## Duplicate Definitions

### Duplicate #1: `engFetch` — Local vs Shared
- **Local:** `client/src/components/tabs/EngineeringStagesTab.tsx:36-41`
- **Shared:** `client/src/lib/eng-fetch.ts:6-16`
- **Divergence:**
  - Local version: Returns raw `Response` object, no error handling, no JSON auto-parsing
  - Shared version: Returns parsed JSON, auto-adds `Content-Type: application/json`, throws on non-OK responses with error message extraction
- **Risk:** EngineeringStagesTab has different error behavior than EngineeringTasksPage. Bugs fixed in the shared version won't apply to Stages.

### Duplicate #2: `useEngineeringTaskFilters` — Two Versions
- **Comprehensive:** `client/src/hooks/useEngineeringTaskFilters.ts` (284 lines) — filters: status, priority, assignee, project, search, dueDate, workloadState, linkedSource. Returns 11 metrics.
- **Simple:** `hooks/useEngineeringTaskFilters.ts` (43 lines) — filters: status, priority, assignee, project, search. Returns 3 metrics.
- **Used by:** `EngineeringTasksPage.tsx` imports the comprehensive version (line 101). The simple version appears to be dead code.

---

## Hold Dialog Duplication

Two independent hold reason capture implementations exist:

### Page-Level (lines 4518-4568)
- State: `holdDialog`, `holdReason`, `blockedType`
- Dialog rendered at page level
- Triggered when status changes to HOLD from board/list views

### TaskDetailDrawer (lines 1010-1012)
- State: `drawerHoldDialog`, `drawerHoldReason`, `drawerBlockedType`
- Dialog rendered inside drawer
- Triggered when status changes to HOLD from the detail drawer

Both implementations have the same functionality but are maintained separately. Changes to one must be manually replicated to the other.

---

## Permission Gaps

### Gap #1: ProjectKanbanView Calls Restricted Endpoint
- **File:** `client/src/pages/EngineeringTasksPage.tsx:2439`
- **Issue:** `ProjectKanbanView` calls `GET /api/eng/dashboard/projects` which requires `requireAdminOrEpm` middleware. Non-admin engineers accessing the Projects view mode will get a silent 403 error with no UI feedback.
- **Accessible roles:** admin, eng_program_manager, COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER, CONSTRUCTION_MANAGER, PROGRAM_FINANCE_MANAGER, ENGINEERING_PROGRAM_MANAGER, QUALITY_MANAGER, HEAD_OF_DESIGN
- **Question:** Is this intentional? Should the Projects tab be hidden for non-admin users?

### Gap #2: TaskDetailDrawer Delete Permission
- **File:** `client/src/pages/EngineeringTasksPage.tsx:1019`
- **Check:** `usePermission('eng_tasks', 'delete')` — appears correctly implemented. The actual role mapping should be verified in the permission configuration.

---

## Dead Code

- **Simple `useEngineeringTaskFilters`** at `hooks/useEngineeringTaskFilters.ts` — not imported by any component (the comprehensive version in `client/src/hooks/` is used instead).
- No other confirmed dead code found in the audited files. All major components, functions, and imports have observable usage.

---

## Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | handleStatusChange out-of-scope `tasks`/`taskId` | CRITICAL | Unfixed |
| 2 | MyTasksView missing `filterStatuses` prop | CRITICAL | Unfixed |
| 3 | `evaluateAuthorityForRequest` not imported | HIGH | Unfixed |
| 4 | Duplicate `engFetch` with divergent behavior | MEDIUM | Unfixed |
| 5 | Duplicate `useEngineeringTaskFilters` | MEDIUM | Unfixed |
| 6 | ProjectKanbanView silent 403 for non-admins | MEDIUM | Unfixed |
| 7 | Duplicate hold dialog code paths | LOW | Intentional design |
| 8 | Dead simple filter hook | LOW | Dead code |
