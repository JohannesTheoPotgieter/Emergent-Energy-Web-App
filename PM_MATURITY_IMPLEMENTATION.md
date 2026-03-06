# PM Maturity Implementation — V1.2

## Architecture Principles

### Reuse Over Rebuild
All eight features were built on existing foundations:
- **Audit logging**: Every new route uses `logAuditFromReq` from `./audit-logger`
- **Permission middleware**: All routes use `requirePermission` from `./permission-middleware`
- **Authentication**: JWT-based auth via `verifyToken` from `./jwt`
- **Database**: Raw SQL migrations via `db.execute(sql.raw(...))` in `server/index.ts` — never `drizzle-kit push`
- **Frontend patterns**: `@tanstack/react-query`, `SearchableSelect`, Bearer token auth, `data-testid` attributes

### Table Creation
All new tables are created at startup via `ensureXxxTables()` functions using `CREATE TABLE IF NOT EXISTS`. No destructive migrations.

## Backend Routes

| Feature | File | Route Prefix | Routes |
|---------|------|--------------|--------|
| Dependencies | `server/dependency-routes.ts` | `/api/dependencies` | GET project/:id, POST, PATCH/:id, DELETE/:id, GET /api/work-items |
| Change Control | `server/change-control-routes.ts` | `/api/change-requests` | GET project/:id, POST, PATCH/:id, DELETE/:id |
| RAID | `server/raid-routes.ts` | `/api/raid` | GET project/:id, POST, PATCH/:id, DELETE/:id |
| Procurement | `server/procurement-routes.ts` | `/api/procurement` | GET project/:id, POST, PATCH/:id, DELETE/:id |
| Commissioning | `server/commissioning-routes.ts` | `/api/commissioning` | GET project/:id, POST, PATCH/:id, DELETE/:id |
| Invoice Capture | `server/invoice-capture-routes.ts` | `/api/invoice-captures` | GET project/:id, POST, PATCH/:id, DELETE/:id |
| Approvals (enhanced) | `server/approvals-routes.ts` | `/api/approvals/general` | GET, POST, PATCH/:id, DELETE/:id |
| Subcontractor Assignments | `server/subcontractor-routes.ts` | `/api/subcontractor-assignments` | GET project/:id, POST, PATCH/:id, DELETE/:id |

## Frontend Components

| Feature | Component File | Props |
|---------|---------------|-------|
| RAID | `client/src/components/tabs/ProjectRaidTab.tsx` | `projectId, projectName` |
| Change Control | `client/src/components/tabs/ProjectChangeControlTab.tsx` | `projectId, projectName` |
| Procurement | `client/src/components/tabs/ProjectProcurementTab.tsx` | `projectId, projectName` |
| Commissioning | `client/src/components/tabs/ProjectCommissioningTab.tsx` | `projectId, projectName` |
| Dependencies | `client/src/components/DependencyManager.tsx` | `taskId, projectId` |

## Database Tables Added

| Table | Key Columns |
|-------|-------------|
| `change_requests` | id, project_id, title, change_type, status, cost_impact, schedule_impact, owner_user_id |
| `raid_items` | id, project_id, type (risk/assumption/issue/decision), priority, status, owner_user_id |
| `procurement_items` | id, project_id, category, expected_cost, actual_cost, supplier_id, status |
| `commissioning_items` | id, project_id, item_type (commissioning/closeout), category, status, owner_user_id |
| `invoice_captures` | id, project_id, supplier_id, invoice_number, amount, status, document_path |
| `project_subcontractor_assignments` | id, project_id, counterparty_id, work_package, status |

## Columns Added to Existing Tables

| Table | New Columns |
|-------|-------------|
| `approvals` | related_entity_type, related_entity_id, assigned_approver, due_date, project_id, approval_category |

## Status Transition Maps
All features with status pipelines enforce valid transitions server-side. Invalid transitions return 400 errors.

## Permission Entities Added
- `pd_raid` — RAID Log (view, edit, delete)
- `pd_change_control` — Change Control (view, edit, approve, delete)
- `pd_procurement` — Procurement (view, edit, approve, delete)
- `pd_commissioning` — Commissioning (view, edit, approve)
- `pd_dependencies` — Dependencies (view, edit, delete)
