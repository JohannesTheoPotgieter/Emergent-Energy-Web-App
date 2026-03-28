# API Routes + Frontend Migration Report

> Generated: 2026-03-20 | Prompt 8 of 15

## Overview

All primary read paths now query `work_items` instead of `operational_tasks` or `engineering_tasks`. Write paths retain backward compat during transition.

## Changes Made

### 1. shared/types/unified-task.ts (NEW)

**Canonical data-layer type for all task data:**
- `UnifiedTask` interface — 60+ fields covering core + all 3 extensions
- `fromWorkItem(row)` — adapter that handles both camelCase and snake_case
- `toOperationalTaskShape(t)` — backward-compat mapper for legacy API responses
- `toEngineeringTaskShape(t)` — backward-compat mapper for eng API responses

### 2. server/canonical-boundaries.ts (UPDATED)

Removed bidirectional sync — work_items is now the sole source of truth:
- `mirrorWorkItemToOperationalTask()` → **no-op stub** (deprecated)
- `syncOperationalTaskFromWorkItemUpdate()` → **no-op stub** (deprecated)
- `softDeleteLegacyOperationalTaskByWorkItemId()` → **no-op stub** (deprecated)
- `softDeleteCanonicalWorkItem()` → kept (canonical delete)
- `softDeleteCanonicalWorkItemByLegacyTaskId()` → kept (legacy reference delete)

### 3. server/lib/work-item-queries.ts (NEW)

Centralized query helper with LEFT JOINs on all 3 extension tables:
- `queryWorkItems(opts)` — filters by projectId, projectName, workstream, ownerUserId, status
- `getWorkItemById(id)` — single item fetch
- `getAssignmentsByWorkItemIds(ids)` — batch assignment fetch

### 4. server/work-items-adapter.ts (UPDATED)

- Added `getUnifiedTasksForProject()` using new query helpers
- Re-exports `UnifiedTask`, `fromWorkItem`, `toOperationalTaskShape`, `toEngineeringTaskShape`
- All existing functions retained for backward compat

### 5. Route Changes

| File | Route | Change |
|------|-------|--------|
| routes.ts | GET /api/operational-tasks/:projectName | Removed feature flag check — always canonical |
| routes.ts | GET /api/operational-tasks/task/:id | Try work_items first, fall back to operational_tasks |
| routes.ts | GET /api/projects/:projectName/health-summary | ENG tasks from work_items |
| routes.ts | GET /api/program-dashboard | ENG tasks from work_items |
| routes.ts | GET /api/calendar/my-tasks | ENG tasks from work_items |
| routes.ts | PATCH /api/calendar/schedule-task | Schedule ENG via work_items |
| ms-sync-routes.ts | GET /api/my-work/all-tasks | ENG tasks from work_items |

### 6. Routes NOT Yet Changed (documented for next prompt)

| File | Route | Reason |
|------|-------|--------|
| routes.ts | POST /api/operational-tasks | Creates in operational_tasks (needs write migration) |
| routes.ts | PATCH /api/operational-tasks/:id | Updates operational_tasks (needs write migration) |
| routes.ts | DELETE /api/operational-tasks/:id | Soft-deletes operational_tasks (needs write migration) |
| routes.ts | POST /api/operational-tasks/bulk-update | Bulk ops on operational_tasks |
| routes.ts | POST /api/operational-tasks/:id/convert | Workstream conversion |
| pd-routes.ts | POST /api/pd/tickets/:id/spawn-tasks | Spawns operational_tasks |
| template-routes.ts | POST /api/projects/:projectId/apply-template | Creates operational_tasks |
| meeting-routes.ts | POST /api/meetings/action-items/:id/convert-to-task | Creates operational_tasks |
| admin-recovery-routes.ts | Multiple | Recovery operations |

### 7. Frontend Changes

| File | Change |
|------|--------|
| TaskDetailDrawer.tsx | Type changed from `OperationalTask` to `UnifiedTask & Record<string, any>` |
| my-work-tasks.tsx | Added note about convergence with shared UnifiedTask |

## Response Shape Compatibility

All route changes preserve the existing response shape. The `toOperationalTaskShape()` and `toEngineeringTaskShape()` adapters ensure frontend code receives the same field names and structure.

## Files

| File | Status |
|------|--------|
| `shared/types/unified-task.ts` | NEW — canonical type + adapters |
| `server/lib/work-item-queries.ts` | NEW — centralized query with JOINs |
| `server/canonical-boundaries.ts` | UPDATED — sync functions deprecated |
| `server/work-items-adapter.ts` | UPDATED — unified query function added |
| `server/routes.ts` | UPDATED — 6 routes switched to work_items |
| `server/ms-sync-routes.ts` | UPDATED — 1 route switched |
| `client/src/components/TaskDetailDrawer.tsx` | UPDATED — UnifiedTask type |
| `client/src/pages/my-work-tasks.tsx` | UPDATED — convergence note |
| `docs/spine-v2/06-api-frontend-migration-report.md` | This report |
