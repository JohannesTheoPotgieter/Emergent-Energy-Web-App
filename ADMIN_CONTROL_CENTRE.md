# Admin Control Centre

## Version: 1.0 | Date: 2026-03-06

## Overview
The Admin Control Centre (`/admin/control-center`) is a unified dashboard for system administrators to monitor, configure, and control the Emergent Energy platform without direct database access.

## Access
- Route: `/admin/control-center`
- Sidebar: SYSTEM section, first item ("Control Center")
- Permission: CEO_ADMIN and COO_ADMIN roles only

## Features

### System Health
- Database connection status and host
- Total user count
- Total project count (active vs total)
- Audit event count
- Real-time status indicators

### Import Statistics
- Total import runs
- Committed / failed run counts
- Last import date

### Integration Status
- Microsoft 365 connection summary
- Outlook, SharePoint, Teams sync status
- Synced object count from MS Graph

### Quick Links
All admin pages accessible from one location:
- Admin Recovery Center
- KPI Traceability Panel
- Import Control Tower
- Role Management
- System Activity Log
- Settings
- DB Migration
- Smart Import

### System Enums
View platform enumeration values:
- Execution phases
- RAG status values
- Project phases (from database)
- Workstream options

### Feature Flags
- Toggle system features on/off
- Shows last updated by and timestamp
- Changes are audit-logged

### Dangerous Actions
Protected by AlertDialog confirmation:
- **Clear Sessions**: Removes all active sessions (forces re-login)
- **Trim Audit Log**: Removes audit entries older than 90 days

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /api/admin/control-center/health | System health metrics |
| GET | /api/admin/control-center/feature-flags | List feature flags |
| PUT | /api/admin/control-center/feature-flags/:key | Toggle feature flag |
| GET | /api/admin/control-center/enums | System enumerations |
| GET | /api/admin/control-center/integrations | MS365 integration status |
| POST | /api/admin/control-center/dangerous/clear-sessions | Clear all sessions |
| POST | /api/admin/control-center/dangerous/clear-audit-log | Trim old audit entries |

## Files
- Server: `server/admin-control-routes.ts`
- Frontend: `client/src/pages/admin-control-center.tsx`
