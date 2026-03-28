# Soft Delete and Restore Specification

## Overview
The soft delete system ensures that deleted entities can be recovered by administrators. Instead of permanently removing records, a `deleted_at` timestamp is set, and all read queries filter out these records.

## Covered Entities

| Entity | Table | Column | Implementation |
|---|---|---|---|
| Work Items | `work_items` | `deleted_at` TIMESTAMP | Pre-existing |
| Engineering Tasks | `project_eng_tasks` | `soft_deleted_at` TIMESTAMP | Pre-existing |
| Operational Tasks | `operational_tasks` | `deleted_at` TIMESTAMP | Added in close-out |
| My Tool Tasks | `mytool_tasks` | `deleted_at` TIMESTAMP | Added in close-out |

## How It Works

### Delete Operation
When a user deletes an entity, the system sets `deleted_at = NOW()` instead of running a SQL DELETE. The record remains in the database but is excluded from all normal queries.

### Read Filtering
All SELECT queries include `WHERE deleted_at IS NULL` to exclude soft-deleted records. This is enforced in:
- `storage.ts` methods (`getAllOperationalTasks`, `getOperationalTasksByProject`, `getMytoolTasks`, `getMytoolTasksByDate`)
- Direct SQL queries in routes (work_items queries include `deleted_at IS NULL`)

### Restore
Administrators can restore soft-deleted items via the Admin Recovery Center. The restore operation sets `deleted_at = NULL`, making the record visible again.

## API Endpoints

### Delete (Soft)
| Endpoint | Method | Entity |
|---|---|---|
| `/api/work-items/delete` | POST | Work items (bulk) |
| `/api/operational-tasks/:id` | DELETE | Operational tasks |
| `/api/mytool/tasks/:id` | DELETE | My Tool tasks |
| `/api/planning-tasks/:taskId` | DELETE | Plan tasks (non-baseline → operational soft delete) |

### Restore
| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/recovery/deleted` | GET | List all soft-deleted items across all entity types |
| `/api/admin/recovery/restore` | POST | Restore selected items by setting `deleted_at = NULL` |
| `/api/work-items/restore` | POST | Restore work items (bulk) |

## Admin Recycle Bin (Deleted Items Tab)

### Location
Admin Recovery Center → Deleted Items tab

### Features
- **Type filter buttons**: Filter by entity type (Work Item, Engineering Task, Operational Task, My Tool Task) with count badges
- **Search**: Filter by title
- **Age column**: Shows days since deletion with color coding:
  - Green/grey: < 30 days
  - Amber: 30-60 days
  - Red: > 60 days
- **Multi-select**: Checkbox selection for bulk restore
- **Confirm dialog**: AlertDialog confirmation before restore with audit warning
- **Audit logging**: All restore operations logged with item details

## Retention Structure
The `deleted_at` timestamp provides natural retention tracking:
- Items can be identified by age for periodic purge if needed
- Age column in UI helps administrators identify stale deleted items
- No automatic purge is implemented — all cleanup is manual via admin

## Audit Trail
| Action | Source | Details |
|---|---|---|
| Soft delete | `logAuditFromReq` | Entity type, ID, title, user who deleted |
| Restore | `logAuditFromReq` | Entity type, ID, count of restored items |

## Entities NOT Using Soft Delete
| Entity | Delete Type | Reason |
|---|---|---|
| Sessions | Hard DELETE | Session cleanup for security |
| Audit events | Hard DELETE | Admin trim action (intentional) |
| Users | Hard DELETE | User management (rare operation) |
| Financial overrides | Hard DELETE | Override replacement pattern |
