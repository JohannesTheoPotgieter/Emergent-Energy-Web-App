# Role & Permission Matrix

## Version: 1.0 | Date: 2026-03-06

## Roles (13 Active)

| Role Key | Label | System | Sections |
|---|---|---|---|
| CEO_ADMIN | CEO / Admin | Yes | All sections |
| COO_ADMIN | COO / Admin | Yes | All sections |
| CCO | Chief Commercial Officer | Yes | COCKPIT, PROJECTS, MONEY, PROJECT_DEVELOPMENT |
| CFO | Chief Financial Officer | Yes | COCKPIT, MONEY, ADMIN |
| PROGRAM_MANAGER | Program Manager | Yes | COCKPIT, PROJECTS, MONEY, DELIVERY, GOVERNANCE |
| ENGINEERING_MANAGER | Engineering Program Manager | Yes | COCKPIT, PROJECTS, DELIVERY |
| QUALITY_MANAGER | Quality Manager | Yes | COCKPIT, PROJECTS, GOVERNANCE |
| CONSTRUCTION_MANAGER | Construction Manager | Yes | COCKPIT, PROJECTS, DELIVERY |
| PROGRAM_FINANCE_MANAGER | Program Finance Manager | Yes | COCKPIT, MONEY |
| ACCOUNTANT | Accountant | Yes | MONEY |
| ENGINEER | Engineer | Yes | COCKPIT, DELIVERY |
| PROJECT_MANAGER_SITE | Project Manager (Site) | Yes | COCKPIT, PROJECTS, DELIVERY |
| PROJECT_DEVELOPER | Project Developer | Yes | COCKPIT, PROJECT_DEVELOPMENT |

## Entity Permissions Summary

### Financial Entities
| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| normalized_cost_lines | Admin, CFO, PM, PFM, ACCT | Admin, CFO, PFM | Admin, CFO | Admin |
| normalized_revenue_lines | Admin, CFO, PM, PFM, ACCT | Admin, CFO, PFM | Admin, CFO | Admin |
| cashflow | Admin, CFO, PM, PFM, ACCT, CCO | Admin, CFO, PFM | Admin, CFO | Admin |
| opex | Admin, CFO, PFM, ACCT | Admin, CFO, PFM | Admin, CFO | Admin |

### Project Entities
| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| project_info | All roles | Admin, PM, PD, CCO | Admin | Admin |
| operational_tasks | All roles | Admin, PM, ENG_MGR, CONST_MGR, PM_SITE | Admin | Admin |
| work_items | All roles | Admin, PM, ENG_MGR | Admin | Admin |

### Engineering Entities
| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| engineering_tasks | Admin, PM, ENG_MGR, CONST_MGR, ENG, PM_SITE | Admin, ENG_MGR, ENG | Admin, ENG_MGR | Admin |
| engineering_checklist | Admin, PM, ENG_MGR, ENG, QM | Admin, ENG_MGR, ENG | Admin, ENG_MGR, QM | Admin |

### Quality Entities
| Entity | View | Edit | Approve | Delete |
|---|---|---|---|---|
| qc_checklist | Admin, PM, QM, ENG_MGR | Admin, QM | Admin, QM | Admin |
| quality_items | Admin, PM, QM, ENG_MGR, CONST_MGR | Admin, QM | Admin, QM | Admin |

### Admin Entities
| Entity | View | Edit | Delete |
|---|---|---|---|
| users | Admin only | Admin only | Admin only |
| role_permissions | Admin only | Admin only | Admin only |
| audit_log | Admin only | — | — |
| system_settings | Admin only | Admin only | — |

## Middleware Enforcement
- `requireAuth`: All authenticated routes
- `requireAdmin`: All admin-only routes (role-management, recovery, control-center, import-tower, KPI traceability)
- `requirePermission`: Entity-level permission checks via permission-middleware.ts
- EPM_ACCESS_CODE / QM_ACCESS_CODE: Challenge-based access for engineering and quality sections

## Audit Logging
All role and permission changes are audit-logged with:
- User who made the change
- Before/after values (role changes)
- Entity type and action
- Timestamp
