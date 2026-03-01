# UX Inventory Report

Generated from codebase analysis. Covers routes, nav items, role permissions, data dependencies, and flagged issues.

---

## 1. Route Inventory

### 1.1 Public Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/auth/login` | `LoginPage` | User authentication |
| `/auth/ms-callback` | `MsCallbackPage` | Microsoft OAuth callback |

### 1.2 Protected Routes (All require auth)

| Route | Component | Nav Section | Nav Label |
|-------|-----------|-------------|-----------|
| `/` | `Home` | — | Home |
| `/dashboard` | `Dashboard` | PROJECTS | Execution Board |
| `/projects` | `ProjectsSummary` | PROJECTS | Project Summary |
| `/project/:projectName` | `ProjectDetailPage` | — (deep link) | — |
| `/cashflow` | `CashflowPage` | MONEY | Cashflow |
| `/revenue` | `RevenueTracker` | — (no nav) | — |
| `/cos` | `CostTracker` | MONEY | COS Tracker |
| `/cos-control` | `CosControlPage` | — (no nav) | — |
| `/cashflow-forecast` | `CashflowForecastPage` | — (no nav) | — |
| `/my-tool` | `MyToolTodayPage` | COCKPIT | My Tool |
| `/my-tool/week` | `MyToolWeekPage` | — (sub-nav) | — |
| `/my-tool/backlog` | `MyToolBacklogPage` | — (sub-nav) | — |
| `/my-tool/settings` | `MyToolSettingsPage` | — (sub-nav) | — |
| `/my-tool/help` | `MyToolHelpPage` | — (sub-nav) | — |
| `/my-tool/triage-inbox` | `TriageInboxPage` | — (sub-nav) | — |
| `/my-tool/unclassified-tasks` | `UnclassifiedTasksPage` | — (sub-nav) | — |
| `/my-tool/meetings` | `MyToolMeetingsPage` | — (sub-nav) | — |
| `/company-priorities` | `MyToolPrioritiesPage` | COCKPIT | Company Priorities |
| `/lifecycle-board` | `LifecycleBoardPage` | COCKPIT | Company Lifecycle Dashboard |
| `/execution-board` | `ExecutionBoardPage` | — (no nav) | — |
| `/smart-import` | `SmartImportPage` | PROJECTS | Smart Import |
| `/project-normalized/:projectName` | `ProjectNormalizedViewPage` | — (deep link) | — |
| `/pm-dashboard` | `PMDashboard` | PROJECTS | PM Dashboard |
| `/tr-register` | `TrRegisterPage` | PROJECTS | TR Register |
| `/portfolios` | `PortfoliosPage` | PROJECTS | Portfolios |
| `/portfolios/:id` | `PortfolioDetailPage` | — (deep link) | — |
| `/subcontractor-dashboard` | `SubcontractorDashboardPage` | MONEY | Procurement |
| `/invoice-patterns` | `InvoicePatternsPage` | MONEY | Invoice Patterns |
| `/pd` | `PdDashboardPage` | PROJECT_DEVELOPMENT | PD Dashboard |
| `/pd/tickets` | `PdTicketsPage` | PROJECT_DEVELOPMENT | PD Tickets |
| `/pd/tickets/create` | `PdTicketCreatePage` | — (deep link) | — |
| `/pd/tickets/:id` | `PdTicketDetailPage` | — (deep link) | — |
| `/engineering` | `EngineeringDashboardPage` | DELIVERY | Engineering |
| `/engineering/tasks` | `EngineeringTasksPage` | DELIVERY | Task Board |
| `/engineering/sync` | `EngineeringSyncPage` | — (COO only) | SP Sync |
| `/engineering/inbox` | `EngineeringInboxPage` | — (legacy nav only) | Pipeline Inbox |
| `/quality` | `QmDashboardPage` | GOVERNANCE | Quality Dashboard |
| `/collaboration` | `CollaborationPage` | COLLABORATION | Collaboration Hub |
| `/teams/chats` | `TeamsChatsPage` | COLLABORATION | Teams Chat |
| `/notifications` | `NotificationCenterPage` | COLLABORATION | Notifications |
| `/feedback` | `FeedbackPage` | INFORMATION | Feedback & Support |
| `/ee-info` | `EeInfoPage` | INFORMATION | Emergent Energy Info |
| `/leaderboard` | `LeaderboardPage` | INFORMATION | Leaderboard |
| `/settings/integrations` | `MsIntegrationSettingsPage` | INFORMATION | Integration Status |
| `/admin` | `AdminPage` | — (no nav, accessible via /upload redirect) | — |
| `/admin/settings` | `RoleSettingsPage` | ADMIN | Settings (parent) |
| `/admin/roles` | `AdminRolesPage` | ADMIN | Roles & Permissions |
| `/admin/phase-templates` | `PhaseTemplatesPage` | ADMIN | Phase Templates |
| `/admin/approvals` | `AdminApprovalsPage` | ADMIN | Approvals |
| `/admin/activity-log` | `SystemActivityLogPage` | ADMIN | Change Audit |
| `/admin/my-tool-settings` | `MyToolAdminSettingsPage` | — (no nav) | — |
| `/admin/ms-integration` | `MsIntegrationSettingsPage` | ADMIN | Microsoft Integration |
| `/admin/ms-mapping` | `AdminMsMappingPage` | ADMIN | MS Account Mapping |
| `/weekly-reviews` | `WeeklyReviewsPage` | ADMIN | Weekly Reviews |
| `/project-create` | `ProjectCreatePage` | — (no nav, was in legacy) | — |

### 1.3 Redirect Routes

| From | To | Notes |
|------|----|-------|
| `/upload` | `/admin` | Legacy redirect |
| `/admin/eng-templates` | `/admin/phase-templates` | Legacy redirect |
| `/` (PM_SITE role) | `/pm-dashboard` | Role-based redirect |

### 1.4 Orphan Pages (files exist but NO route registered)

| File | Status |
|------|--------|
| `budget.tsx` | ORPHAN — no route in App.tsx |
| `eng-template-admin.tsx` | ORPHAN — no route (redirect exists to phase-templates) |
| `sp-admin-settings.tsx` | ORPHAN — no route |
| `sp-import-runs.tsx` | ORPHAN — no route |

---

## 2. Navigation Structure (Redesigned Layout — Active)

The app uses `UX_REDESIGN_ENABLED = true`, so the redesigned nav is active.

### 2.1 Sidebar Nav Groups

| Section Key | Heading | Items Count |
|-------------|---------|-------------|
| COCKPIT | EXCO | 3 |
| COLLABORATION | COLLABORATION | 3 |
| PROJECTS | PROJECT MANAGEMENT | 6 |
| MONEY | PROJECT FINANCE | 4 |
| PROJECT_DEVELOPMENT | PROJECT DEVELOPMENT | 2 |
| DELIVERY | ENGINEERING | 2 |
| GOVERNANCE | GOVERNANCE | 1 |
| INFORMATION | INFORMATION | 4 |
| ADMIN | ADMIN | 1 (with 7 children) |

### 2.2 Detailed Nav Items

#### EXCO (COCKPIT)
| Label | Icon | Path |
|-------|------|------|
| My Tool | Briefcase | /my-tool |
| Company Priorities | Flag | /company-priorities |
| Company Lifecycle Dashboard | Layers | /lifecycle-board |

#### COLLABORATION
| Label | Icon | Path |
|-------|------|------|
| Collaboration Hub | Handshake | /collaboration |
| Teams Chat | MessageSquare | /teams/chats |
| Notifications | Bell | /notifications |

#### PROJECT MANAGEMENT (PROJECTS)
| Label | Icon | Path |
|-------|------|------|
| Execution Board | Gauge | /dashboard |
| Project Summary | FolderKanban | /projects |
| PM Dashboard | Briefcase | /pm-dashboard |
| TR Register | ClipboardList | /tr-register |
| Smart Import | FileSpreadsheet | /smart-import |
| Portfolios | FolderOpen | /portfolios |

#### PROJECT FINANCE (MONEY)
| Label | Icon | Path |
|-------|------|------|
| Cashflow | Wallet | /cashflow |
| COS Tracker | TrendingUp | /cos |
| Procurement | Truck | /subcontractor-dashboard |
| Invoice Patterns | FileSpreadsheet | /invoice-patterns |

#### PROJECT DEVELOPMENT
| Label | Icon | Path |
|-------|------|------|
| PD Dashboard | FileEdit | /pd |
| PD Tickets | ClipboardList | /pd/tickets |

#### ENGINEERING (DELIVERY)
| Label | Icon | Path |
|-------|------|------|
| Engineering | HardHat | /engineering |
| Task Board | ListTodo | /engineering/tasks |

#### GOVERNANCE
| Label | Icon | Path |
|-------|------|------|
| Quality Dashboard | ShieldCheck | /quality |

#### INFORMATION
| Label | Icon | Path |
|-------|------|------|
| Feedback & Support | MessageSquareText | /feedback |
| Emergent Energy Info | BookOpen | /ee-info |
| Leaderboard | Trophy | /leaderboard |
| Integration Status | Plug | /settings/integrations |

#### ADMIN (collapsed parent)
| Label | Icon | Path |
|-------|------|------|
| Settings (parent) | Cog | /admin/settings |
| ↳ Roles & Permissions | ShieldAlert | /admin/roles |
| ↳ Phase Templates | ClipboardCheck | /admin/phase-templates |
| ↳ Weekly Reviews | CalendarCheck | /weekly-reviews |
| ↳ Change Audit | Activity | /admin/activity-log |
| ↳ Approvals | ShieldCheck | /admin/approvals |
| ↳ Microsoft Integration | Cog | /admin/ms-integration |
| ↳ MS Account Mapping | Users | /admin/ms-mapping |

---

## 3. Role Permissions Matrix

### 3.1 System Roles & Section Access

| Role | Label | Sections | Manage Users | Manage Roles | Edit Data |
|------|-------|----------|-------------|-------------|-----------|
| COO_ADMIN | COO | ALL (9 sections) | Yes | Yes | Yes |
| CEO_ADMIN | CEO | ALL (9 sections) | Yes | Yes | Yes |
| CCO | CCO | COCKPIT, COLLAB, PROJECTS, MONEY, PD, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| CFO | CFO | COCKPIT, COLLAB, PROJECTS, MONEY, GOVERNANCE, INFO | No | No | Yes |
| PROGRAM_MANAGER | Program Manager | COCKPIT, COLLAB, PROJECTS, MONEY, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| PROGRAM_FINANCE_MANAGER | Program Finance Mgr | COCKPIT, COLLAB, PROJECTS, MONEY, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| CONSTRUCTION_MANAGER | Construction Manager | COCKPIT, COLLAB, PROJECTS, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| QUALITY_MANAGER | Quality Manager | COCKPIT, COLLAB, PROJECTS, GOVERNANCE, INFO | No | No | Yes |
| ENGINEERING_MANAGER | Engineering Manager | COCKPIT, COLLAB, PROJECTS, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| KEY_ACCOUNTS_MANAGER | Key Accounts Mgr | COCKPIT, COLLAB, PROJECTS, INFO | No | No | Yes |
| PROJECT_MANAGER_SITE | Project Manager | COLLAB, PROJECTS, MONEY, DELIVERY, GOVERNANCE | No | No | No (view-only) |
| PROJECT_DEVELOPER | Project Developer | COCKPIT, COLLAB, PROJECTS, MONEY, PD, DELIVERY, GOVERNANCE, INFO | No | No | Yes |
| ENGINEER | Engineer | COCKPIT, COLLAB, PROJECTS, DELIVERY, INFO | No | No | Yes |
| ACCOUNTANT | Accountant | COCKPIT, COLLAB, PROJECTS, MONEY, INFO | No | No | Yes |

### 3.2 Client-Side Role Guards

| Guard | Affected Roles | Allowed Paths | Redirect |
|-------|---------------|---------------|----------|
| EPM Guard | `eng_program_manager` | /, /engineering/*, /quality, /projects, /feedback, /settings/integrations, /collaboration, /notifications, /teams/chats | → / |
| PM Guard | `PROJECT_MANAGER_SITE` | /, /pm-dashboard, /projects, /project/*, /engineering/*, /quality, /cashflow, /cos, /feedback, /settings/integrations, /collaboration, /notifications, /teams/chats | → /pm-dashboard |
| QM Guard | `quality_manager` | /, /quality, /projects, /project/*, /feedback, /settings/integrations, /collaboration, /notifications, /teams/chats | → / |
| Admin Guard | Non-admin roles | Blocks `/admin/*` | → / |

### 3.3 Special Visibility Rules (Sidebar)
- `/engineering/sync` only visible to `COO_ADMIN` company role
- `PROJECT_MANAGER_SITE` sees a filtered subset of nav items

---

## 4. Home Dashboard Widgets

### 4.1 Current Widget Definitions

| Widget ID | Label | Available To |
|-----------|-------|-------------|
| `my_projects` | My Projects | CEO, COO, CCO, CFO, PM, PFM, CM, PM_SITE, PD |
| `company_priorities` | Company Priorities | CEO, COO, CCO, CFO, PM, PFM, CM |
| `action_banner` | Attention Banner | All roles |
| `priority_queue` | Priority Queue | All roles |
| `stat_cards` | Statistics Cards | All roles |
| `my_tasks` | My Tasks | CEO, COO, PM, PFM, CM, EM, ENG, PM_SITE, QM |
| `pending_approvals` | Pending Approvals | CEO, COO, CCO, CFO, PM, PFM, CM, EM, QM |
| `notifications` | Notifications | All roles |

---

## 5. Data Dependencies Per Page

| Page | Primary API / Data Source | Foundation Table |
|------|--------------------------|------------------|
| Home | `/api/projects-summary`, `/api/my-tasks`, `/api/notifications` | project_info, program_expense, program_inflows |
| Dashboard | `useProgramData()` → `/api/program-data` | project_info, program_expense, program_inflows |
| Projects | `/api/projects-summary` | project_info, project_revenue_summary |
| Project Detail | `/api/project/:name` (multiple sub-endpoints) | All foundation tables per project |
| Cashflow | `useProgramData()` + `/api/cashflow/:project` | cashflow_points |
| Revenue | `useProgramData()` | program_inflows |
| COS | `useProgramData()` | program_expense |
| COS Control | `/api/cos-summary` | program_expense |
| Cashflow Forecast | `/api/cashflow-forecast` | cashflow_points, cashflow_planning_overrides |
| Engineering | `/api/engineering/*` | engineering_tasks, engineering_deliverables |
| Engineering Tasks | `/api/engineering/tasks` | engineering_tasks |
| Quality | `/api/quality/*` | quality_checklists, quality_items |
| PM Dashboard | `/api/pm-dashboard` | project_info, project_plan |
| Smart Import | `/api/smart-import/*` | smart_import_runs |
| Lifecycle Board | `/api/projects-summary` | project_info |
| Portfolios | `/api/portfolios` | portfolios, portfolio_projects |
| Subcontractor | `/api/subcontractors` | program_expense (supplier extraction) |
| PD Dashboard | `/api/pd/*` | pd_tickets |
| Collaboration | `/api/collaboration/*` | Various |
| Teams Chat | `/api/teams/*` | External (Microsoft Graph) |

---

## 6. Flagged Issues

### 6.1 Duplicate / Redundant Routes

| Issue | Details | Severity |
|-------|---------|----------|
| **Duplicate component target** | `/settings/integrations` and `/admin/ms-integration` both render `MsIntegrationSettingsPage` | MEDIUM |
| **Dashboard vs Execution Board** | `/dashboard` (nav label "Execution Board") and `/execution-board` (separate route, no nav) — potential confusion | LOW |
| **Revenue page not in nav** | `/revenue` has a route but no nav item in redesigned layout | MEDIUM |
| **COS Control not in nav** | `/cos-control` has a route but no nav item | LOW |
| **Cashflow Forecast not in nav** | `/cashflow-forecast` has a route but no nav item | LOW |
| **Admin page not in nav** | `/admin` route exists (upload redirect target) but no direct nav link | LOW |

### 6.2 Orphan Pages (Dead Code)

| File | Issue |
|------|-------|
| `budget.tsx` | No route registered, never rendered |
| `eng-template-admin.tsx` | No route registered (redirect to phase-templates exists) |
| `sp-admin-settings.tsx` | No route registered, never rendered |
| `sp-import-runs.tsx` | No route registered, never rendered |

### 6.3 Confusing Labels / Naming

| Issue | Details |
|-------|---------|
| **"Execution Board" vs "Dashboard"** | Nav says "Execution Board" but route is `/dashboard`; separate `/execution-board` route also exists |
| **"Procurement" label mismatch** | Nav label is "Procurement" but route is `/subcontractor-dashboard` |
| **"My Tool" overloaded** | "My Tool" is used as nav label AND has 7+ sub-routes not visible in main nav |
| **"PM Dashboard" icon reuse** | Uses `Briefcase` icon — same as "My Tool" in COCKPIT section |
| **"PD Tickets" icon reuse** | Uses `ClipboardList` icon — same as "TR Register" in PROJECTS section |
| **"Smart Import" icon reuse** | Uses `FileSpreadsheet` icon — same as "Invoice Patterns" in MONEY section |
| **"Company Lifecycle Dashboard"** | Very long label, truncates on narrow sidebar |
| **"SP Sync"** | Abbreviation unclear to non-technical users |

### 6.4 Inconsistent Icons

| Duplicated Icon | Used By |
|----------------|---------|
| `Briefcase` | My Tool, PM Dashboard |
| `ClipboardList` | TR Register, PD Tickets |
| `FileSpreadsheet` | Smart Import, Invoice Patterns |
| `ShieldCheck` | Quality Dashboard, Approvals (admin child) |
| `Cog` | Settings (parent), Microsoft Integration (child) |

### 6.5 Missing Empty States

The following pages have no empty-state messaging when data is absent:

| Page | Priority |
|------|----------|
| admin-ms-mapping | LOW |
| admin-roles | MEDIUM |
| admin | LOW |
| cashflow-forecast | MEDIUM |
| cos-control | MEDIUM |
| cos | HIGH |
| engineering-dashboard | HIGH |
| engineering-inbox | MEDIUM |
| engineering-sync | LOW |
| feedback | MEDIUM |
| invoice-patterns | MEDIUM |
| leaderboard | MEDIUM |
| lifecycle-board | HIGH |
| ms-integration-settings | LOW |
| notification-center | MEDIUM |
| pd-dashboard | HIGH |
| pd-ticket-create | LOW |
| pd-ticket-detail | LOW |
| pd-tickets | MEDIUM |
| project-create | LOW |
| project-detail | HIGH |
| projects | HIGH |
| revenue | HIGH |
| role-settings | LOW |
| subcontractor-dashboard | MEDIUM |
| system-activity-log | MEDIUM |
| teams-chats | MEDIUM |
| weekly-reviews | MEDIUM |

### 6.6 Role Guard Gaps

| Issue | Details |
|-------|---------|
| **Legacy role mapping** | `admin` → `COO_ADMIN`, `quality_manager` → `QUALITY_MANAGER`, `eng_program_manager` → `ENGINEERING_MANAGER`, `member` → `PROGRAM_MANAGER` — dual role system creates confusion |
| **Client vs Server guards** | Role enforcement happens both in `RoleGuard` component (client) AND `permission-middleware` (server) — potential for drift |
| **EPM allowed paths outdated** | `EPM_ALLOWED_PATHS` includes `/engineering` but not `/engineering/sync` or deeper routes that may be needed |
| **No guard for PROJECT_DEVELOPMENT** | PD routes (`/pd`, `/pd/tickets`) have no client-side role guard — rely solely on section-based nav filtering |

### 6.7 Data-Testid Coverage

Total files with `data-testid` attributes: **91 files** across components and pages. Coverage is broad but not verified for completeness on all interactive elements.

### 6.8 Navigation Visibility vs Route Access Mismatch

| Route | In Nav? | Guarded? | Risk |
|-------|---------|----------|------|
| `/execution-board` | No | No specific guard | Users could navigate directly but can't discover it |
| `/revenue` | No | No specific guard | Accessible but hidden |
| `/cos-control` | No | No specific guard | Accessible but hidden |
| `/cashflow-forecast` | No | No specific guard | Accessible but hidden |
| `/admin/my-tool-settings` | No | Admin guard only | Hidden admin page |
| `/project-create` | No (removed from redesign) | No specific guard | Was in legacy nav, now hidden |

---

## 7. Summary Statistics

| Metric | Count |
|--------|-------|
| Total registered routes | 56 |
| Protected routes | 54 |
| Public routes | 2 |
| Redirect routes | 3 |
| Nav items (redesigned) | 35 (including children) |
| Orphan page files | 4 |
| Routes without nav entry | 13 |
| System roles | 14 |
| Nav sections | 9 |
| Widget definitions | 8 |
| Pages missing empty states | 29 |
| Duplicate icon usage instances | 5 pairs |
