# Admin Control Centre

## Version: 2.0 | Date: 2026-03-06

## Overview
The Admin Control Centre (`/admin/control-center`) is a unified dashboard for CEO_ADMIN and COO_ADMIN roles to monitor system health, manage configuration, and perform system-level operations without direct database access.

**Files**: `server/admin-control-routes.ts`, `client/src/pages/admin-control-center.tsx`
**Access**: CEO_ADMIN, COO_ADMIN only (enforced by `requireAdmin` middleware server-side; entity permission gating client-side)
**Sidebar Location**: SYSTEM section, first item ("Control Center")

---

## What An Admin Can Control From The UI

### 1. System Health Monitoring (Read-Only)
| Metric | Source | What It Shows |
|---|---|---|
| Database connection | Direct DB test query | Connected/disconnected status + hostname |
| User count | `SELECT COUNT(*) FROM users` | Total registered users |
| Project count | `SELECT COUNT(*) FROM project_info` | Total projects + active projects |
| Audit event count | `SELECT COUNT(*) FROM audit_events` | Total audit trail entries |

### 2. Import Statistics (Read-Only)
| Metric | Source | What It Shows |
|---|---|---|
| Total import runs | `smart_import_runs` table | Number of Smart Import executions |
| Committed runs | Filtered by status='committed' | Successfully completed imports |
| Failed runs | Filtered by status='failed' | Failed or rolled-back imports |
| Last run date | MAX(created_at) | When the last import occurred |

### 3. Integration Status (Read-Only)
| Integration | Detection Method | What It Shows |
|---|---|---|
| Outlook | Checks `ms_objects` table for type='calendar_event' | Active/Not Connected + count |
| SharePoint | Checks `ms_objects` table for type='sharepoint_item' | Active/Not Connected + count |
| Teams | Checks `ms_objects` table for type='teams_message' | Active/Not Connected + count |
| Total synced objects | COUNT(*) from `ms_objects` | Total objects synced from Microsoft |

**Limitation**: Integration status is inferred from data presence in `ms_objects`, NOT from real-time API health checks. If synced data exists but the OAuth token has expired, it will still show "Active."

### 4. Quick Links (Navigation)
Direct links to 8 admin pages:
- Admin Recovery Center (`/admin/recovery`)
- KPI Traceability Panel (`/admin/kpi-traceability`)
- Import Control Tower (`/admin/import-control-tower`)
- Users & Roles (`/admin/roles`)
- System Activity Log (`/admin/activity-log`)
- App Settings (`/settings`)
- Database Migration (`/admin/db-migration`)
- Smart Import (`/import`)

### 5. System Enums (Read-Only)
| Enum | Source | Values |
|---|---|---|
| Execution Phases | Hardcoded array | P0_FIRST_ASSESSMENT through P10_CLOSEOUT (11 phases) |
| RAG Values | Hardcoded array | Green, Amber, Red |
| Project Phases | `SELECT DISTINCT phase FROM project_info` | Dynamic from database |
| Workstreams | `SELECT DISTINCT workstream FROM operational_tasks` | Dynamic from database |

**Gap**: Enums are view-only. Admin cannot add/edit/delete execution phases or workstream options from this UI.

### 6. Feature Flags (Read + Toggle)
| Action | How It Works |
|---|---|
| View all flags | Reads from `app_settings` table where key starts with feature flag patterns |
| Toggle flag | PUT `/api/admin/control-center/feature-flags/:key` — updates value, sets `updated_by`, `updated_at` |
| Audit | Toggle action is logged via `logAuditFromReq` with flag key and new value |

### 7. Dangerous Actions (With AlertDialog Confirmation)

| Action | Confirmation Dialog | What It Does | Audit Logged |
|---|---|---|---|
| Clear All Sessions | "This will force all users to re-authenticate. You will also be logged out." | `DELETE FROM session` | Yes |
| Trim Audit Log | "This will permanently delete audit events older than [X] days. This cannot be undone." | Deletes audit_events older than N days (default 90) | Yes |

Both actions require explicit AlertDialog confirmation before execution.

---

## What Is Recoverable Through The UI

Via the Admin Recovery Center (linked from Quick Links):
- **Task data**: Status, title, project linkage, assignee, due date, priority, description — for operational, personal, engineering, and plan tasks
- **Soft-deleted items**: Work items and engineering tasks can be restored from the Deleted Items tab
- **Project metadata**: PM, PD, phase, execution phase, RAG status, active flag
- **Import issues**: View error logs from failed import runs

---

## What Still Requires Future Expansion

| Gap | Current State | Future Need |
|---|---|---|
| Enum editing | View-only | UI to add/edit/remove execution phases, workstream options |
| User management | Requires separate `/admin/roles` page | Inline user list with role assignment on Control Center |
| Integration health | Inferred from data presence | Real-time OAuth token validation and API health check |
| Bulk project actions | Shows counts only | Bulk activate/deactivate projects |
| Error log viewer | Shows failed import count | Display recent error logs and stack traces inline |
| System performance | Not tracked | API response time monitoring, slow query detection |
| Data export | Not available | Bulk export of projects, tasks, financials for backup |
| Session monitoring | Clear-all only | View active sessions, force-logout individual users |

---

## API Endpoints (All require `requireAuth` + `requireAdmin`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/control-center/health` | System health metrics |
| GET | `/api/admin/control-center/feature-flags` | List all feature flags |
| PUT | `/api/admin/control-center/feature-flags/:key` | Toggle a feature flag |
| GET | `/api/admin/control-center/enums` | System enumeration values |
| GET | `/api/admin/control-center/integrations` | MS365 integration status |
| POST | `/api/admin/control-center/dangerous/clear-sessions` | Clear all user sessions |
| POST | `/api/admin/control-center/dangerous/clear-audit-log` | Trim old audit entries |
