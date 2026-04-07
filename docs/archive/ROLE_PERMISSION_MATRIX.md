# Role & Permission Matrix

## Version: 2.0 | Date: 2026-03-06

## Roles (14 Defined)

| Role Key | Label | System Role | canManageUsers | canManageRoles | canEditData | UI Sections |
|---|---|---|---|---|---|---|
| COO_ADMIN | COO | Yes | Yes | Yes | Yes | All 9 sections |
| CEO_ADMIN | CEO | Yes | Yes | Yes | Yes | All 9 sections |
| CCO | Chief Commercial Officer | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, PROJECT_DEVELOPMENT, INFORMATION |
| CFO | Chief Financial Officer | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, INFORMATION |
| PROGRAM_MANAGER | Program Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, DELIVERY, GOVERNANCE, INFORMATION |
| PROGRAM_FINANCE_MANAGER | Program Finance Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, INFORMATION |
| CONSTRUCTION_MANAGER | Construction Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, DELIVERY, GOVERNANCE, INFORMATION |
| QUALITY_MANAGER | Quality Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, GOVERNANCE, INFORMATION |
| ENGINEERING_MANAGER | Engineering Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, DELIVERY, INFORMATION |
| KEY_ACCOUNTS_MANAGER | Key Accounts Manager | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, INFORMATION |
| PROJECT_MANAGER_SITE | Project Manager (Site) | Yes | No | No | **No** | COLLABORATION, PROJECTS, MONEY, DELIVERY, GOVERNANCE, INFORMATION |
| PROJECT_DEVELOPER | Project Developer | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, PROJECT_DEVELOPMENT, INFORMATION |
| ENGINEER | Engineer | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, DELIVERY, INFORMATION |
| ACCOUNTANT | Accountant | Yes | No | No | Yes | COCKPIT, COLLABORATION, PROJECTS, MONEY, INFORMATION |

**Note**: PROJECT_MANAGER_SITE has `canEditData: false` — this limits their ability to edit data even where they have entity-level edit permissions. All other roles have `canEditData: true`.

## Entity-Level Permissions (ENTITY_PERMISSION_DEFAULTS)

Source: `shared/schema.ts`, lines ~4100–4285. The system defines entity permissions for 90+ entity keys across 14 roles. Below is a representative summary of the most critical entities by functional area.

### Financial Entities

| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| financials | Admin, CFO, CCO, PM, PFM, ACCT, CONST_MGR | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| cos | Admin, CFO, PM, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| cashflow | Admin, CFO, CCO, PM, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| revenue_tracker | Admin, CFO, PM, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| gp_tracker | Admin, CFO, PM, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| cos_control | Admin, CFO, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| cashflow_forecast | Admin, CFO, PFM, ACCT | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin only |
| invoice_patterns | Admin, PM, PFM | Admin, PFM | — | Admin only |

**Gap**: PROJECT_DEVELOPER and ENGINEER have NO view access to financial entities. KEY_ACCOUNTS_MANAGER has NO financial access. This is intentional for data segregation but means PDs cannot see project cost data at all.

### Project Entities

| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| projects | Admin, CCO, CFO, PM, PFM, CONST_MGR, QM, ENG_MGR, PM_SITE, PD, ENG, ACCT, KAM | Admin, CCO, PFM, CONST_MGR | Admin, CCO | Admin only |
| operational_tasks | Admin, PM, CONST_MGR, PM_SITE, ENG | Admin, PM, CONST_MGR | — | Admin only |
| work_items | Admin, PM, PFM, CONST_MGR, PM_SITE, ENG | Admin, PM, PFM, CONST_MGR, PM_SITE, ENG | Admin, PM | Admin only |
| execution_board | Admin, PM, CONST_MGR, PM_SITE | Admin, PM, CONST_MGR, PM_SITE | — | — |
| smart_import | Admin, PM, PFM | Admin, PM, PFM | — | Admin only |
| project_creation | Admin, CCO, PM, PFM, PM_SITE, PD | Admin, CCO, PM, PFM, PM_SITE, PD | — | — |

### Engineering Entities

| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| engineering | Admin, PM, ENG_MGR, CONST_MGR, ENG | Admin, PM, ENG_MGR, CONST_MGR, ENG | Admin, ENG_MGR | Admin only |
| eng_stages | Admin, PM, ENG_MGR, QM, ENG | Admin, ENG_MGR | Admin, ENG_MGR, QM | Admin only |
| eng_tasks | Admin, PM, ENG_MGR, CONST_MGR, ENG | Admin, ENG_MGR, ENG | Admin, ENG_MGR | Admin, ENG_MGR |
| eng_sync | Admin, ENG_MGR | Admin, ENG_MGR | — | — |
| eng_inbox | Admin, ENG_MGR, ENG | Admin, ENG_MGR | — | — |

### Quality Entities

| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| quality | Admin, PM, QM, ENG_MGR, CONST_MGR | Admin, QM | Admin, QM | Admin only |
| approvals | Admin, QM, ENG_MGR | Admin, QM, ENG_MGR | Admin, QM, ENG_MGR | Admin only |

### Admin Entities

| Entity | View | Edit | Approve | Override | Delete |
|---|---|---|---|---|---|
| admin | Admin only | Admin only | Admin only | **COO_ADMIN only** | Admin only |
| admin_roles | Admin only | Admin only | Admin only | **COO_ADMIN only** | Admin only |
| audit_trail | Admin only | — | — | — | — |
| activity_log | Admin only | Admin only | — | — | Admin only |

### Collaboration Entities

| Entity | View | Edit | Delete |
|---|---|---|---|
| my_tool | All 14 roles | All 14 roles | Admin only |
| teams_chat | All 14 roles | All 14 roles | Admin, PM |
| feedback | All 14 roles | All 14 roles | Admin only |
| notifications | All 14 roles | All 14 roles | — |
| meetings | All 14 roles | All 14 roles | Admin only |

## Middleware Enforcement

### Server-Side Guards (Evidenced)
| Guard | Applied To | Evidence |
|---|---|---|
| `jwtAuth + requireAuth` | All API routes | Every route file uses this pattern |
| `requireAdmin` | Admin-only routes | role-management.ts (7 endpoints), admin-recovery-routes.ts (3 endpoints), admin-control-routes.ts (7 endpoints), smart-import admin endpoints, kpi-traceability-routes.ts, handover gate reopen |
| `requirePermission` | Entity-level checks | permission-middleware.ts with `canViewEntity()` / `canEditEntity()` |
| EPM_ACCESS_CODE | Engineering sections | quality-routes.ts challenge endpoint with 5-attempt lockout + 15-min cooldown |
| QM_ACCESS_CODE | Quality sections | quality-routes.ts challenge endpoint with 5-attempt lockout + 15-min cooldown |

### Frontend Permission Gating (Evidenced)
- Sidebar items gated by `PATH_TO_ENTITY` mapping in AppLayout.tsx
- Routes gated by entity-level `view` permission in App.tsx via `PermissionGate` component
- Admin-only pages: `/admin/recovery`, `/admin/control-center`, `/admin/kpi-traceability`, `/admin/import-control-tower`, `/admin/activity-log`, `/admin/roles`

## Assumptions and Known Gaps

### Confirmed Gaps
1. **No project-level role overrides**: Permissions are global per role — you cannot give a user PM access to one project but not another
2. **No row-level security on tasks**: Any user with `operational_tasks.view` can see ALL operational tasks, not just tasks for projects they manage
3. **CLIENT/EXTERNAL roles not implemented**: No role for external clients or auditors to view project progress
4. **canEditData=false for PM_SITE** is a blunt instrument — it blocks ALL data edits for site PMs even where entity permissions grant edit access
5. **Entity permission enforcement is not applied to every single API endpoint** — some older endpoints only check `requireAuth` without entity-level permission verification. The permission middleware is applied to key financial, project, and admin endpoints, but not universally to all 100+ endpoints.
6. **Permission cache invalidation**: `invalidateEntityPermCache()` is called on role updates, but there's no mechanism to force-refresh connected clients' cached permissions without re-login

### Assumptions
- All admin routes correctly check for `COO_ADMIN` or `CEO_ADMIN` role — verified in role-management.ts, admin-recovery-routes.ts, admin-control-routes.ts
- Entity permissions are the source of truth, stored in `role_permissions.entity_permissions` JSONB column
- The `LEGACY_ROLE_MAP` in role-management.ts maps old role names (`admin` → `COO_ADMIN`, `member` → `PROGRAM_MANAGER`, etc.) for backward compatibility
