# Emergent Energy Dashboard - System Audit

## Audit Date: 2026-03-06
## Auditor: System Stabilization Agent

---

## 1. System Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript, Vite, TanStack React Query, Tailwind CSS v4, shadcn/ui, Recharts
- **Backend**: Express.js + TypeScript, Passport.js (local + Microsoft SSO), JWT auth
- **Database**: PostgreSQL (Drizzle ORM), ~200 tables
- **Integrations**: Microsoft Graph API (Outlook, Teams, SharePoint), Azure AD SSO

### Core Data Model
```
project_info (70 projects)
  |-- work_items (canonical task source, 3292 items)
  |-- normalized_cost_lines (COS tracking)
  |-- normalized_revenue_lines (revenue tracking)
  |-- operational_tasks (legacy task engine)
  |-- engineering_tasks (legacy engineering)
  |-- qc_checklist / qc_item_instance (quality)
  |-- program_expense / program_inflows (financials)
```

### User Model
- 24 seeded users across 11 roles
- Admin roles: CEO_ADMIN, COO_ADMIN
- Functional roles: CCO, CFO, PROGRAM_MANAGER, QUALITY_MANAGER, CONSTRUCTION_MANAGER, PROGRAM_FINANCE_MANAGER, ACCOUNTANT, ENGINEER, PROJECT_MANAGER_SITE, PROJECT_DEVELOPER

---

## 2. Dependency Map

### Data Flow
```
Smart Import (Excel) --> normalized_plan_tasks --> work_items (canonical)
                     --> normalized_cost_lines --> COS Tracker / Cashflow
                     --> normalized_revenue_lines --> Revenue Tracker / GP Tracker

work_items --> Planning Tasks API --> Project Plan Tab
          --> My Work API --> My Work Tasks Page
          --> Engineering Dashboard
          --> Quality Dashboard

project_info --> Project Summary --> All dashboards
             --> Financial Headline
             --> Portfolio views
             --> Lifecycle Board

Microsoft Graph --> ms_objects --> Calendar/Email/Teams views
               --> ms_accounts --> SSO authentication
```

### Module Dependencies
| Module | Depends On | Feeds Into |
|--------|-----------|------------|
| Smart Import | project_info | work_items, cost/revenue lines |
| Project Plan | work_items, project_plan_overrides | Task Detail, Dashboards |
| Engineering | engineering_tasks, work_items | Engineering Dashboard |
| Quality | qc_checklist, qc_item_instance, work_items | Quality Dashboard |
| My Work | work_items, work_item_assignments, mytool_tasks | Personal task view |
| Financials | normalized_cost_lines, normalized_revenue_lines, program_expense, program_inflows | COS, Revenue, GP, Cashflow |
| MS Integration | ms_accounts, ms_objects | Calendar, Email, Teams views |
| Permissions | role_permissions, users | All UI gating |

---

## 3. API Endpoint Summary

- **Total endpoints**: ~285 (server/routes.ts) + ~15 (ms-sync-routes.ts)
- **Auth-protected**: All endpoints use `requireAuth` middleware
- **Admin-gated**: ~40 endpoints use `requireAdmin`
- **Role-gated**: ~15 endpoints use `requireRole` or `requirePermission`

### Endpoint Categories
| Category | Count | Status |
|----------|-------|--------|
| Authentication | 8 | Working |
| Project Management | 35+ | Working |
| Financial Tracking | 25+ | Working |
| Task Management | 30+ | Working |
| Engineering | 15+ | Working |
| Quality | 10+ | Working |
| MS Integration | 15+ | Working (graceful when no MS account) |
| Admin/System | 20+ | Working |
| My Work/MyTool | 15+ | Working |

---

## 4. Frontend Pages

- **Total routed pages**: 55+
- **Unrouted/deprecated pages**: ~15 (kept for reference)

### Page Categories
| Category | Pages | Status |
|----------|-------|--------|
| Dashboard/Home | 3 | Working |
| Project Management | 8 | Working |
| Financial | 7 | Working |
| Engineering | 4 | Working |
| Quality | 2 | Working |
| My Work/MyTool | 10 | Working |
| Admin | 6 | Working |
| Collaboration | 5 | Working |
| PM On-The-Go | 3 | Working |
| PD/Tickets | 4 | Working |

---

## 5. Database Architecture

### Canonical Data Sources (Single Source of Truth)
1. **work_items** - All tasks (PM, Engineering, Quality)
2. **normalized_cost_lines** - All cost data
3. **normalized_revenue_lines** - All revenue data

### Override System
- `project_plan_overrides` - Soft-delete and field overrides for Excel-imported plan tasks
- `cashflow_planning_overrides` - Manual cashflow adjustments
- `revenue_tracking_overrides` - Revenue field overrides
- `expenditure_overrides` - Expense field overrides

### Migration/Backfill
- Automatic migration from legacy tables (normalized_plan_tasks, engineering_tasks, qc_item_instance) to work_items
- Feature flag: `canonical_work_items_v1` controls canonical data path
- Computed field backfill runs on startup

---

## 6. Security Model

### Authentication
- Local password login restricted to admin roles (CEO_ADMIN, COO_ADMIN)
- Microsoft SSO for all other roles
- JWT tokens for API auth (fallback alongside session)
- Access code required for admin password login

### Authorization
- Backend: `requireAuth`, `requireAdmin`, `requireRole`, `requirePermission` middleware
- Frontend: `PermissionGate` component, `usePermission` hook, sidebar section gating
- Entity-level permissions stored in `role_permissions` table

---

## 7. Known Startup Warnings
1. `Using in-memory session store (SQLite fallback mode)` - Sessions use memory store; OK for single-instance deployment
2. QC migration was previously failing due to column mismatch (FIXED in this audit)
