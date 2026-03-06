# Close-Out Actions Register

## Session Objective
Complete all remaining trust and control gaps for controlled internal go-live of the Emergent Energy Dashboard.

---

## Actions Completed

### 1. Viewer Management (T001 + T002)
| Action | Status | Evidence |
|---|---|---|
| Hardened viewer API endpoints (GET/POST/DELETE viewers) | DONE | `server/routes.ts`: 3 dedicated viewer endpoints with audit logging |
| Added `isViewerOnly()` guard to prevent viewer-only users from reassigning | DONE | `server/ms-sync-routes.ts`: guard in reassign handler |
| Audit logging on all viewer add/remove operations | DONE | `server/ms-sync-routes.ts` + `server/routes.ts`: logAuditFromReq calls |
| Viewer tasks included in "Tracking" filter in My Work | DONE | `client/src/pages/my-work-tasks.tsx`: filter + count includes viewer role |
| "Viewing" badge visually distinct (sky-blue) from "Tracking" (teal) | CONFIRMED | Pre-existing implementation verified |
| ViewerManagement component in task detail drawer | CONFIRMED | Pre-existing implementation verified |
| Fixed `assigned_at` column reference bug (should be `created_at`) | DONE | `server/routes.ts`: corrected column name in viewer endpoints |

### 2. Soft Delete & Restore (T003 + T004)
| Action | Status | Evidence |
|---|---|---|
| Added `deleted_at` column to `operational_tasks` | DONE | `shared/schema.ts` + migration in `server/index.ts` |
| Added `deleted_at` column to `mytool_tasks` | DONE | `shared/schema.ts` + migration in `server/index.ts` |
| Converted `deleteOperationalTask()` from hard to soft delete | DONE | `server/storage.ts`: sets `deletedAt` instead of DELETE |
| Converted `deleteMytoolTask()` from hard to soft delete | DONE | `server/storage.ts`: sets `deletedAt` instead of DELETE |
| Filtered soft-deleted records from all read queries | DONE | `storage.ts`: `isNull(deletedAt)` on all get methods |
| Converted `DELETE /api/planning-tasks/:taskId` (non-baseline) to soft delete | DONE | `server/routes.ts`: `UPDATE SET deleted_at` instead of DELETE |
| Expanded admin Deleted Items tab to show all 4 entity types | DONE | `server/admin-recovery-routes.ts` + `client/src/pages/admin-recovery.tsx` |
| Added type filter buttons to Deleted Items view | DONE | `admin-recovery.tsx`: filter by work_item, engineering_task, operational_task, mytool_task |
| Added search in Deleted Items | DONE | `admin-recovery.tsx`: search by title |
| Added "Age" column with color-coded retention indicator | DONE | `admin-recovery.tsx`: days since deletion with amber/red thresholds |
| Updated restore handler for new entity types | DONE | `admin-recovery-routes.ts`: operational_task and mytool_task restore support |

### 3. Activity Log Upgrade (T005)
| Action | Status | Evidence |
|---|---|---|
| Added user dropdown filter | DONE | `system-activity-log.tsx`: SearchableSelect for user name |
| Added action type dropdown filter | DONE | `system-activity-log.tsx`: SearchableSelect for action |
| Added date range picker (From/To) | DONE | `system-activity-log.tsx`: date inputs |
| Added CSV export | DONE | `server/audit-routes.ts`: GET `/api/audit/activity-log/export` |
| Added clear filters button with count | DONE | `system-activity-log.tsx`: shows active filter count |
| Expanded search to include user_name and project_name | DONE | `server/audit-routes.ts`: wider search coverage |
| Added User column to table | DONE | `system-activity-log.tsx`: dedicated User column |

### 4. Admin Control Centre Expansion (T006)
| Action | Status | Evidence |
|---|---|---|
| Active Sessions section with user list | DONE | `admin-control-center.tsx` + `admin-control-routes.ts`: session listing |
| Force Logout by user with confirmation dialog | DONE | DELETE `/api/admin/control-center/sessions/:sid` with audit logging |
| Integration health with per-type status, last sync, counts | DONE | GET `/api/admin/control-center/integration-health` |
| Recent Import Failures section (last 10) | DONE | GET `/api/admin/control-center/recent-import-failures` |
| Recent System Events section | DONE | GET `/api/admin/control-center/recent-issues` |

### 5. Task & Visibility Consistency (T007)
| Action | Status | Evidence |
|---|---|---|
| Viewer logic verified across plan task types | CONFIRMED | ViewerManagement renders for plan tasks in detail drawer |
| Status normalization confirmed on all write paths | CONFIRMED | `normalizeStatus()` applied on all PATCH/POST handlers |
| Badges and filters consistent in list and board views | CONFIRMED | "Viewing" (sky), "Tracking" (teal) badges in both views |
| Tracking filter includes viewer tasks | FIXED | `my-work-tasks.tsx`: filter includes `viewer` tracking role |

### 6. Defect Fixes During Close-Out
| ID | Severity | Description | Fix |
|---|---|---|---|
| CO-001 | HIGH | `assigned_at` column reference in viewer endpoints (should be `created_at`) | Fixed column name in GET and POST viewer SQL queries |
| CO-002 | LOW | Tracking source filter excluded viewer tasks | Added `viewer` to tracking filter and count |

---

## Summary
- **Total actions**: 30+
- **New defects found and fixed**: 2
- **Open defects**: 0
- **Audit logging calls (total)**: 292+ across all server files
- **Soft-deleted entity types**: 4 (work_items, engineering_tasks, operational_tasks, mytool_tasks)
