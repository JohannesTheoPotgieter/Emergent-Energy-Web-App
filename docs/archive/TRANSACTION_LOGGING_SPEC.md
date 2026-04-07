# Transaction Logging Specification

## Version: 2.0 | Date: 2026-03-06

## Overview
The audit logging system records create, update, and delete operations to the `audit_events` table with user attribution and change context. The system uses a primary helper (`logAuditFromReq`) and specialized helpers for common patterns.

**Core Module**: `server/audit-logger.ts`

---

## Audit Log Schema

| Column | Type | Description |
|---|---|---|
| id | serial | Primary key |
| user_id | integer | ID of acting user (from JWT payload) |
| user_name | text | Name of acting user |
| entity_type | text | Entity being modified (e.g., "operational_task", "user", "role_permissions") |
| entity_id | text | ID of the specific entity |
| action | text | Action performed (e.g., "create", "update", "delete", "role_change") |
| project_name | text | Associated project name (where applicable) |
| changes_json | jsonb | Detailed change payload with before/after values |
| source | text | Origin: "UI", "API", or "System" |
| created_at | timestamp | When the action occurred |

---

## Logging Helpers

### Primary Helper
```typescript
logAuditFromReq(req, {
  entityType: string,     // Required: what entity was modified
  action: string,         // Required: what happened
  entityId?: string,      // ID of specific record
  projectName?: string,   // Project context
  changesJson?: object,   // Change details
  source?: string,        // Default: "UI"
})
```

### Specialized Helpers (Defined but Under-Utilized)
| Helper | Purpose | Actual Usage |
|---|---|---|
| logStatusChange | Task status transitions | **0 calls** — defined but not invoked in routes; status changes use `logAuditFromReq` directly |
| logReassignment | Task reassignment | **0 calls** — defined but not invoked in routes |
| logTypeChange | Task type changes | **0 calls** — defined but not invoked in routes |
| logImportAction | Smart Import operations | **0 calls** — defined but not invoked in smart-import-routes.ts |
| logAdminRecovery | Admin recovery edits | **0 calls** — recovery uses `logAuditFromReq` directly |

**Gap**: The specialized helpers exist in `audit-logger.ts` but are not used anywhere. All logging goes through the generic `logAuditFromReq`. This works functionally but means status transitions, reassignments, and imports don't get the structured before/after format the helpers were designed to provide.

---

## Coverage by Route File (Evidenced)

### Fully Covered (100% of mutating endpoints logged)

| File | Audit Calls | Endpoints | Coverage |
|---|---|---|---|
| server/role-management.ts | 8 | 7 mutating | **100%** — role CRUD, user CRUD, password reset, role change (with before/after) |
| server/quality-routes.ts | 20 | 20 mutating | **100%** — QC item CRUD, approval workflows, evidence uploads |
| server/engineering-routes.ts | 15 | 15 mutating | **100%** — engineering task CRUD, checklist stages, approvals |
| server/admin-recovery-routes.ts | 4 | 3 mutating | **100%** — task edits, item restores, project edits |
| server/admin-control-routes.ts | 4 | 3 mutating | **100%** — feature flag toggles, dangerous actions |
| server/portfolio-routes.ts | 11 | 11 mutating | **100%** |
| server/lifecycle-routes.ts | 11 | 11 mutating | **100%** |
| server/pm-on-the-go-routes.ts | 12 | 12 mutating | **100%** |
| server/eng-stage-routes.ts | 18 | 18 mutating | **100%** |
| server/handover-routes.ts | 3 | 3 mutating | **100%** |

### Partially Covered

| File | Audit Calls | Endpoints | Missing Endpoints |
|---|---|---|---|
| server/routes.ts | 127 | ~85 mutating | **~30 missing**: scenarios CRUD, some operational task bulk operations, task comment deletion, planning task PATCH, some approval endpoints |

### Not Covered (0 audit calls)

| File | Endpoints | Risk Level | Impact |
|---|---|---|---|
| server/smart-import-routes.ts | 10+ mutating | **HIGH** — imports are a critical data ingestion path | Import uploads, commits, and rollbacks are not logged via audit helpers |
| server/sync-routes.ts | 10 mutating | MEDIUM — SharePoint sync operations | Push/pull sync actions not tracked |
| server/departments/*.ts | ~15 mutating | MEDIUM — department-specific routes | Financial close uploads, reprocess-all, financial integration rules |
| server/role-auth-routes.ts | 3 mutating | LOW — uses direct `db.insert(auditEvents)` instead of helpers | Login, password change, settings update — functionally logged but via different pattern |

---

## What Is Logged (Evidenced Examples)

### Role Management (role-management.ts)
| Action | entityType | Logged Details |
|---|---|---|
| Role permission update | role_permissions | role key, sections, canManageUsers, canManageRoles, canEditData, whether entity perms changed |
| Role create | role_permissions | role key, label, sections |
| Role delete | role_permissions | role key, label |
| User role change | user | **before/after**: previousRole, newRole, userName |
| User create | user | username, name, email, assigned role |
| User password reset | user | userName (no password content logged) |
| User delete | user | userName, email |

### Task Operations (routes.ts)
| Action | entityType | Logged Details |
|---|---|---|
| Operational task create | operational_task | title, projectName |
| Project summary edit | project_info | projectName, changed fields |
| Cashflow balance update | cashflow_balance | weekStartDate, openingBalance |
| OPEX budget update | opex_budget | monthKey, amount |
| Financial doc upload | financial_close_doc | filename |

### Admin Actions (admin-control-routes.ts, admin-recovery-routes.ts)
| Action | entityType | Logged Details |
|---|---|---|
| Feature flag toggle | feature_flag | key, new value |
| Clear sessions | system | action description |
| Trim audit log | system | days threshold |
| Recovery task edit | task | taskId, taskSource, all updated fields |
| Restore deleted items | task | restored item IDs and types |
| Recovery project edit | project | projectId, all updated fields |

---

## Visibility to Admin

### System Activity Log Page
- **Route**: `/admin/activity-log`
- **Access**: Admin only
- **Features**: Filterable list of audit events
- **Current Filters**: Basic list view with pagination

### Gap in Activity Log UI
The activity log page exists but filtering capabilities are basic. It does not currently support:
- Filter by specific user
- Filter by entity type
- Filter by date range
- Filter by action type
- Export to CSV/PDF

---

## Audit/Governance Usability Assessment

| Criterion | Status | Evidence |
|---|---|---|
| User attribution on every log entry | **YES** | `logAuditFromReq` extracts user_id and user_name from JWT |
| Linked to logged-in user | **YES** | Uses `(req as any).user` from JWT middleware |
| Visible to admin | **YES** | Activity log page at `/admin/activity-log` |
| Before/after values on role changes | **YES** | Explicit `previousRole`/`newRole` in changesJson |
| Before/after values on task edits | **PARTIAL** | Admin recovery logs fields sent, but not all task updates capture previous values |
| Import actions logged | **NO** | smart-import-routes.ts has 0 audit calls |
| SharePoint sync logged | **NO** | sync-routes.ts has 0 audit calls |
| Cannot be tampered with by non-admin | **YES** | Only admin can trim audit log; no delete endpoint for individual entries |
