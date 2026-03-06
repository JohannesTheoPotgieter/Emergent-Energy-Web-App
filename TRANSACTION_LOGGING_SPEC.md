# Transaction Logging Specification

## Version: 1.0 | Date: 2026-03-06

## Overview
All significant create, update, and delete operations are logged to the `audit_log` table with user attribution, entity context, and change details. The system uses typed audit helpers for common patterns.

## Audit Logger Module
**File**: `server/audit-logger.ts`

### Core Function
```typescript
logAuditFromReq(req, {
  entityType: string,
  action: string,
  entityId?: string,
  projectName?: string,
  changesJson?: Record<string, any>,
  source?: string,
})
```

### Typed Helpers
| Helper | Purpose | Fields Logged |
|---|---|---|
| logStatusChange | Task status transitions | previousStatus, newStatus, taskId |
| logReassignment | Task reassignment | previousAssignee, newAssignee, taskId |
| logTypeChange | Task type changes | previousType, newType |
| logImportAction | Smart Import operations | importRunId, action, recordCount |
| logAdminRecovery | Admin recovery edits | taskId, taskSource, updates (before/after) |

## Coverage by Route File

### routes.ts (127+ audit calls)
- Operational task CRUD (create, update, bulk update, delete)
- MyTool task CRUD
- Planning task create
- Project summary edits
- Cashflow balance changes
- OPEX budget updates
- Financial document uploads
- Viewer assignment changes
- Work item soft-delete and restore
- Feedback ticket updates

### role-management.ts (7 audit calls)
- Role permission create
- Role permission update (sections, entity perms, flags)
- Role delete
- User role change (with before/after role values)
- User create
- User password reset
- User delete

### quality-routes.ts (20 audit calls)
- QC item status changes
- QC item approval workflows
- Evidence uploads
- Quality checklist updates

### engineering-routes.ts (15 audit calls)
- Engineering task CRUD
- Checklist stage transitions
- Task approval workflows
- SharePoint integration actions

### admin-recovery-routes.ts
- Task recovery edits (all fields, all task types)
- Deleted item restores

### handover-routes.ts
- Gate completion actions
- Gate reopen actions (admin-only)

### smart-import-routes.ts
- Import run creation
- Import commit/rollback

### admin-control-routes.ts
- Feature flag toggles
- Dangerous actions (session clear, audit trim)

## Audit Log Schema
| Column | Type | Description |
|---|---|---|
| id | serial | Primary key |
| user_id | integer | Acting user ID |
| user_name | text | Acting user name |
| entity_type | text | Entity being modified |
| entity_id | text | ID of modified entity |
| action | text | Action performed |
| project_name | text | Associated project (if applicable) |
| changes_json | jsonb | Detailed change payload |
| source | text | UI, API, or System |
| created_at | timestamp | When the action occurred |

## Viewing
- Admin-only System Activity Log page at `/admin/activity-log`
- Filterable by user, entity type, date range, action type
