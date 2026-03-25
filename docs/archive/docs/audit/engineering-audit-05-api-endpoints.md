# Audit 5: API Endpoint Completeness

**Date:** 2026-03-19
**Scope:** All engineering API endpoints — mapping, verification, gaps
**Status:** Read-only audit — no changes made

---

## Executive Summary

- **Total endpoints mapped:** 72 in `engineering-routes.ts` + 22 in `eng-stage-routes.ts` = **94 total**
- **All frontend API calls verified** — no missing endpoints found
- **Critical issues:** Generic error handling on all 72 endpoints, missing enrichment on GET by ID, no auth on constants endpoint

---

## Endpoint Inventory by Category

### Task Management (18 endpoints)

| Method | Path | Auth | Data Source | Notes |
|--------|------|------|-------------|-------|
| GET | `/api/eng/tasks` | requireAuth | work_items adapter | **Enriched**: resolvedAssignees, deliverables, MS items |
| POST | `/api/eng/tasks` | requireAuth | work_items adapter | |
| GET | `/api/eng/tasks/:id` | requireAuth | operationalTasks **direct** | **Missing enrichment** — raw DB row only |
| PATCH | `/api/eng/tasks/:id` | requireAuth | work_items adapter | Validates HOLD transitions |
| DELETE | `/api/eng/tasks/:id` | requireAuth + requirePermission | soft delete | |
| POST | `/api/eng/tasks/bulk-update` | requireAdminOrEpm | operationalTasks direct | No transaction wrapper |
| POST | `/api/eng/tasks/:id/send-for-approval` | requireAuth | operationalTasks direct | File upload via multer |
| POST | `/api/eng/tasks/:id/send-deliverable` | requireAuth | operationalTasks direct | File upload via multer |
| POST | `/api/eng/tasks/:id/link` | requireAuth | operationalTasks direct | |
| GET | `/api/eng/tasks/:id/comments` | requireAuth | taskComments | |
| POST | `/api/eng/tasks/:id/comments` | requireAuth | taskComments | |
| GET | `/api/eng/tasks/:id/activity` | requireAuth | taskActivityLog | |
| GET | `/api/eng/tasks/:id/subtasks` | requireAuth | operationalTasks direct | |
| POST | `/api/eng/tasks/:id/subtasks` | requireAuth | operationalTasks direct | |
| GET | `/api/eng/tasks/:id/deliverables` | requireAuth | taskDeliverables | |
| GET | `/api/eng/tasks/:id/watchers` | requireAuth | taskWatchers | |
| POST | `/api/eng/tasks/:id/watchers` | requireAuth | taskWatchers | |
| DELETE | `/api/eng/tasks/:taskId/watchers/:userId` | requireAuth | taskWatchers | |

### Deliverables (10 endpoints)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/deliverables` | requirePermission("deliverables","view") | Enriched with assignments |
| POST | `/api/deliverables` | requirePermission("deliverables","create") | |
| GET | `/api/deliverables/:id` | requirePermission("deliverables","view") | Returns versions, files, events, assignments |
| PATCH | `/api/deliverables/:id` | requireAuth | Uses `evaluateAuthorityForRequest` (NOT IMPORTED) |
| POST | `/api/deliverables/:id/feedback` | requireAuthority("deliverables","approve") | |
| POST | `/api/deliverables/:id/revise` | requirePermission("deliverables","edit") | |
| POST | `/api/deliverables/:id/files` | requirePermission("deliverables","edit") | File upload |
| PATCH | `/api/deliverables/files/:fileId/approve` | requireAuthority("deliverables","approve") | |
| PATCH | `/api/eng/deliverables/:id/acknowledge` | requireAuth | |
| GET | `/api/eng/deliverables/:id/download` | requireAuth | Streams binary file |

### Dashboard & Reporting (7 endpoints)

| Method | Path | Auth | Data Source |
|--------|------|------|-------------|
| GET | `/api/eng/dashboard/standup` | requireAuth | operationalTasks — **full StandupData shape verified** |
| GET | `/api/eng/dashboard/projects` | requireAdminOrEpm | operationalTasks grouped by project |
| GET | `/api/eng/dashboard/workload` | requireAdminOrEpm | operationalTasks by user |
| GET | `/api/eng/dashboard/milestones-at-risk` | requireAdminOrEpm | operationalTasks by due dates |
| GET | `/api/eng/dashboard/deliverables-pipeline` | requireAdminOrEpm | deliverables by status |
| GET | `/api/eng/dashboard/orphan-tasks` | requireAdminOrEpm | operationalTasks with null projectId |
| GET | `/api/eng/dashboard/warning-tower` | requireAdminOrEpm | qcWarning by severity |

### Team & Users (7 endpoints)
### Notifications (6 endpoints)
### Warning Engine (4 endpoints)
### File Pointers (3 endpoints)
### Audit & Analytics (4 endpoints)
### Project Phase (4 endpoints)
### Admin Reconciliation (3 endpoints)
### Config & Misc (6 endpoints)

---

## Frontend API Call Verification

### EngineeringTasksPage.tsx — All Verified
All `engFetch` and `fetch` calls match existing backend routes.

### engineering-dashboard.tsx — All Verified
- `GET /api/eng/dashboard/standup` — verified, full StandupData shape
- `GET /api/eng/audit-log?limit=15` — verified
- `GET /api/mytool/company-priorities` — verified (in `exco-routes.ts`, not engineering-routes)

### EngineeringStagesTab.tsx — All Verified
All eng-stages calls match routes in `eng-stage-routes.ts`.

### Feature Flags
- `GET /api/feature-flags/rollout` — verified in `routes.ts:835`

**Result: No missing endpoints found.**

---

## Critical Issues

### Issue 1: Generic Error Handling (71 endpoints)
**Severity:** HIGH
Every endpoint uses the same catch pattern:
```
catch (err) {
  console.error("[Engineering] Error:", err);
  res.status(500).json({ error: "Internal server error" });
}
```
Clients receive no diagnostic information. Cannot distinguish between validation errors, auth errors, DB errors, or network errors.

### Issue 2: GET `/api/eng/tasks/:id` Missing Enrichment
**Severity:** HIGH
- `GET /api/eng/tasks` (list) returns enriched data: resolvedAssignees, deliverables, MS items, computed flags
- `GET /api/eng/tasks/:id` (detail) returns raw DB row from operationalTasks
- Frontend task detail view is missing critical context

### Issue 3: `evaluateAuthorityForRequest` Not Imported
**Severity:** HIGH
- Called in `PATCH /api/deliverables/:id` but not imported
- Will crash at runtime

### Issue 4: Bulk Update — No Transaction Safety
**Severity:** MEDIUM
- If bulk update for 100 tasks fails on task #50, the first 49 are already committed
- No rollback mechanism
- Frontend may be unaware of partial failure

### Issue 5: No Auth on Constants Endpoint
**Severity:** LOW
- `GET /api/eng/constants` has no `requireAuth` — only endpoint accessible without auth
- Returns task statuses, priorities, phases

### Issue 6: Response Shape Inconsistency
**Severity:** MEDIUM
| Pattern | Endpoints |
|---------|-----------|
| Direct array `[...]` | GET /api/eng/tasks |
| Wrapped `{items: [], total}` | GET /api/notifications |
| Complex object | GET /api/eng/dashboard/standup |
| Bare value `{count}` | GET /api/notifications/unread-count |

---

## Auth Middleware Summary

| Middleware | Count | Purpose |
|-----------|-------|---------|
| `requireAuth` only | ~40 | Basic auth — any authenticated user |
| `requireAuth + requireAdminOrEpm` | ~10 | Admin/EPM operations |
| `requireAuth + requireAdmin` | ~4 | Admin-only (audit, reconciliation) |
| `requireAuth + requirePermission()` | ~6 | Resource-level permissions |
| `requireAuth + requireAuthority()` | ~2 | Approval authority |
| No auth | 1 | GET /api/eng/constants |

**Gap:** No endpoint checks whether a user can edit/comment on a *specific* task. Any authenticated user can modify any task if they know the ID.

---

## Data Source Summary

| Source | Endpoint Count | Risk |
|--------|---------------|------|
| work_items adapter | 3 (list, create, update) | Canonical — low risk |
| operationalTasks direct | 25+ | Legacy — data divergence risk |
| Other tables (comments, activity, watchers, deliverables) | ~15 | FK to operationalTasks |
| Mixed/hybrid | ~5 | Highest divergence risk |
