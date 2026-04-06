# Emergent Energy Web App — Full Route Inventory

> Generated: 2026-04-06
> Source of truth: `client/src/config/page-registry.ts`, `client/src/App.tsx`
> Router: wouter `<Switch>/<Route>` — NOT react-router
> Auth: `ProtectedRoute` (auth gate) + `RoleGuard` (permission gate via `useAccessMatrix`)

---

## 1. FULL ROUTE MANIFEST

Legend:
- **Load**: E = eager (bundled in main chunk), L = lazy (code-split via `lazyWithRetry`)
- **Access**: `public` = no auth, `protected` = auth + permission entity, `ungated` = auth only (no entity check)
- **Sidebar**: Y = visible in sidebar nav, N = hidden from sidebar
- **Criticality**: P0 = critical (stop-ship), P1 = important (high-traffic), P2 = secondary

---

### 1a. Public & Auth Routes

These routes live OUTSIDE `<ProtectedRoute>` — no auth required.

| # | Route Path | Route Type | Component File | Load | Nav Group | Access | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|--------|---------------|-------------|-------------|-------|
| 1 | `/auth/login` | top-level | `pages/login.tsx` | E | — | public | all | P0-critical | LOW | Microsoft OAuth + admin password (dev only). Eagerly loaded. Entry point for all users. |
| 2 | `/login` | redirect | — | — | — | public | all | P0-critical | LOW | Redirects to `/auth/login` |
| 3 | `/auth/ms-callback` | top-level | `pages/ms-callback.tsx` | E | — | public | all | P0-critical | MEDIUM | OAuth code exchange. Stores JWT + company_role in localStorage. Failure = locked out. |
| 4 | `/` | top-level | `pages/home.tsx` | E | — | ungated | all | P0-critical | LOW | Role-aware dashboard home. Uses `getRoleDashboardConfig()`. Eagerly loaded. |
| 5 | `/*` (catch-all) | top-level | `pages/not-found.tsx` | E | — | ungated | all | P2-secondary | LOW | 404 "Off the grid" page. Eagerly loaded. |

---

### 1b. My Work / Home Routes

All routes below are inside `<ProtectedRoute>` + `<RoleGuard>`.

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 6 | `/my-work` | top-level | `pages/my-work-home.tsx` | L | MY_WORK | Y | protected | `home` | all | P0-critical | LOW | Personal dashboard hub. `matchSubRoutes: true` — catches all `/my-work/*` if no deeper match. |
| 7 | `/my-work/tasks` | sub-route | `pages/my-work-tasks.tsx` | L | MY_WORK | Y | protected | `my_tool` | all | P0-critical | LOW | Personal task board. |
| 8 | `/my-work/calendar` | sub-route | `pages/my-work-calendar.tsx` | L | MY_WORK | Y | protected | `my_work` | all | P1-important | LOW | Calendar view (Microsoft integration). |
| 9 | `/my-work/meetings` | sub-route | `pages/my-work-meetings.tsx` | L | MY_WORK | Y | protected | `meetings` | all | P1-important | MEDIUM | Microsoft Meetings integration — requires MS token. |
| 10 | `/my-work/email` | sub-route | `pages/collab-email.tsx` | L | MY_WORK | Y | protected | `collaboration_hub` | all | P1-important | MEDIUM | Microsoft Email integration — requires MS token. |
| 11 | `/my-work/teams` | sub-route | `pages/teams-chats.tsx` | L | MY_WORK | Y | protected | `teams_chat` | all | P1-important | MEDIUM | Microsoft Teams chat — requires MS token. |
| 12 | `/my-work/approvals` | alias | — | — | MY_WORK | Y | protected | `my_work` | all | P1-important | LOW | Alias → `/my-work/tasks?source=approvals` |
| 13 | `/my-work/settings` | sub-route | `pages/my-work-settings.tsx` | L | MY_WORK | Y | protected | `home` | all | P2-secondary | LOW | User personal settings. |
| 14 | `/inbox` | top-level | `pages/inbox.tsx` | L | MY_WORK | Y | protected | `home` | all | P1-important | LOW | Notification inbox. |

---

### 1c. Project Management Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 15 | `/execution-board` | top-level | `pages/execution-board.tsx` → `pages/execution-dashboard/index.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `execution_board` | PM_SITE, COO, CEO, PROGRAM_MGR, CONSTRUCTION_MGR (landing) + all with perm | P0-critical | LOW | Barrel re-export. `matchSubRoutes: true`. Aliases: `/execution-dashboard`. Role landing for 5 roles. |
| 16 | `/execution-board/program` | sub-route | `pages/execution-dashboard/index.tsx` | L | PROJECT_MANAGEMENT | N | protected | `execution_board` | same as parent | P1-important | LOW | Programme view tab within execution board. |
| 17 | `/execution-board/finance` | sub-route | `pages/execution-dashboard/index.tsx` | L | PROJECT_MANAGEMENT | N | protected | `execution_board` | same as parent | P1-important | LOW | Finance view tab within execution board. |
| 18 | `/execution-dashboard` | alias | — | — | PROJECT_MANAGEMENT | N | protected | `execution_board` | same as #15 | P2-secondary | LOW | Alias → `/execution-board`. Legacy path. |
| 19 | `/pm-dashboard` | top-level | `pages/pm-dashboard.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `pm_dashboard` | all with perm | P1-important | LOW | PM-specific dashboard. |
| 20 | `/projects` | top-level | `pages/projects.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `projects` | all with perm | P0-critical | LOW | Master project list. |
| 21 | `/project/:projectName` | parameterized | `pages/project-detail.tsx` | L | PROJECT_MANAGEMENT | N | protected | `projects` | all with perm | P0-critical | MEDIUM | Project detail with 20+ tabs. URL param: `:projectName`. Heavy data load. |
| 22 | `/project/:projectName/financial-linking` | deep-link | `pages/financial-linking.tsx` | L | PROJECT_MANAGEMENT | N | protected | `financial_linking` | all with perm | P1-important | MEDIUM | Financial linking sub-page of project. |
| 23 | `/project/:projectName/gate/:stageCode` | deep-link | `pages/project-stage-gate.tsx` | L | PROJECT_MANAGEMENT | N | protected | `stage_lifecycle` | all with perm | P1-important | MEDIUM | Stage gate within project. Two URL params. |
| 24 | `/project-create` | top-level | `pages/project-create.tsx` | L | — | N | protected | `project_creation` | all with perm | P1-important | MEDIUM | Project creation wizard. |
| 25 | `/project-lifecycle` | top-level | `pages/project-lifecycle.tsx` | L | PROJECTS | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Project lifecycle overview. |
| 26 | `/project-lifecycle/stage-gates` | sub-route | `pages/project-lifecycle.tsx` | L | — | N | protected | `lifecycle` | all with perm | P2-secondary | LOW | Stage gates sub-view. Same component. |
| 27 | `/project-lifecycle/latest-updates` | sub-route | `pages/project-lifecycle.tsx` | L | — | N | protected | `projects` | all with perm | P2-secondary | LOW | Latest updates sub-view. Same component. |
| 28 | `/project-lifecycle/client-overview` | sub-route | `pages/project-lifecycle.tsx` | L | — | N | protected | `pd_clients` | all with perm | P2-secondary | LOW | Client overview sub-view. Same component. |
| 29 | `/portfolios` | top-level | `pages/portfolios.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `portfolios` | all with perm | P1-important | LOW | Portfolio list. |
| 30 | `/portfolios/:id` | parameterized | `pages/portfolio-detail.tsx` | L | PROJECT_MANAGEMENT | N | protected | `portfolio_detail` | all with perm | P1-important | MEDIUM | Portfolio detail with Gantt chart. URL param: `:id`. |
| 31 | `/milestone-tracker` | top-level | `pages/milestone-tracker.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `execution_board` | all with perm | P1-important | LOW | Standalone milestone tracker for Construction Manager. |
| 32 | `/weekly-reviews` | top-level | `pages/weekly-reviews.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `weekly_review_wizard` | all with perm | P1-important | LOW | Weekly review wizard. |
| 33 | `/pm/on-the-go` | top-level | `pages/pm-on-the-go-home.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `pm_on_the_go` | all with perm | P1-important | LOW | Mobile-first PM interface — home. |
| 34 | `/pm/on-the-go/project/:projectId` | parameterized | `pages/pm-on-the-go-project.tsx` | L | PROJECT_MANAGEMENT | N | protected | `pm_on_the_go` | all with perm | P1-important | MEDIUM | Mobile PM per-project. URL param: `:projectId`. |
| 35 | `/pm/workboard/:projectId` | parameterized | `pages/pm-workboard.tsx` | L | PROJECT_MANAGEMENT | N | protected | `work_items` | all with perm | P1-important | MEDIUM | PM workboard per project. URL param: `:projectId`. Hidden from sidebar. |
| 36 | `/pm/approvals` | top-level | `pages/admin-approvals.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `approvals` | all with perm | P1-important | LOW | Approval queue for PM. |
| 37 | `/pm/handover-review` | top-level | `pages/pm-handover-review.tsx` | L | — | N | protected | `handover` | all with perm | P1-important | LOW | PM reviews PD handover. |
| 38 | `/pm/deliverables` | alias | — | — | — | N | protected | `deliverables` | all with perm | P2-secondary | LOW | Retired. Alias → `/pm/approvals`. |
| 39 | `/governance/processes` | top-level | `pages/governed-processes.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `projects` | all with perm | P1-important | LOW | Governed processes dashboard. |
| 40 | `/governance/approvals` | top-level | `pages/approvals-board-v2.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `approvals` | all with perm | P1-important | LOW | Approvals board V2. |
| 41 | `/governance/financial-reviews` | top-level | `pages/financial-review-queue.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `approvals` | all with perm | P1-important | LOW | Financial review approval queue. |
| 42 | `/po-approval-board` | top-level | `pages/po-approval-board.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `procurement` | all with perm | P1-important | LOW | PO approval board (EPC Workflow). |
| 43 | `/payment-request-board` | top-level | `pages/payment-request-board.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `procurement` | all with perm | P1-important | LOW | Payment request board (EPC Workflow). |
| 44 | `/payment-batch-manager` | top-level | `pages/payment-batch-manager.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `procurement` | all with perm | P1-important | LOW | Payment batch manager (EPC Workflow). |
| 45 | `/handover-control` | top-level | `pages/handover-control.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `handover` | all with perm | P1-important | LOW | PD→PM handover control board. |
| 46 | `/handover` | top-level | `pages/handover-dashboard.tsx` | L | PROJECT_MANAGEMENT | Y | protected | `handover` | all with perm | P1-important | LOW | Handover & Closeout dashboard. |
| 47 | `/construction` | hidden | `pages/execution-board.tsx` (→ ExecutionBoardPage) | L | PROJECT_MANAGEMENT | N | protected | `execution_board` | all with perm | P2-secondary | LOW | Construction landing — renders ExecutionBoardPage. Not in sidebar. |
| 48 | `/procurement` | alias | — | — | PROJECT_MANAGEMENT | N | protected | `execution_board` | all with perm | P2-secondary | LOW | Alias → `/execution-board`. Not in sidebar. |
| 49 | `/sites` | top-level | `pages/sites.tsx` | L | PROJECTS | Y | protected | `projects` | all with perm | P1-important | LOW | Sites list (Phase B entity). |
| 50 | `/company-overview` | top-level | `pages/company-overview/index.tsx` | L | PORTFOLIO | Y | protected | `execution_board` | COO, CEO (landing) + all with perm | P0-critical | MEDIUM | Executive company overview. Role landing for COO/CEO. Complex multi-widget page. |
| 51 | `/lifecycle-board` | top-level | `pages/lifecycle-board.tsx` | L | PORTFOLIO | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Lifecycle board — project stage overview. |
| 52 | `/actions/launchpad` | hidden | `pages/action-launchpad.tsx` | L | — | N | protected | `work_items` | all with perm | P2-secondary | LOW | Quick-create launchpad. Hidden from nav. |

---

### 1d. Finance Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 53 | `/cashflow` | top-level | `pages/cashflow.tsx` | L | FINANCE | Y | protected | `cashflow` | CFO, PROG_FIN_MGR, ACCOUNTANT (landing) + all with perm | P0-critical | LOW | Cash flow dashboard. Role landing for 3 finance roles. |
| 54 | `/revenue-tracker` | top-level | `pages/revenue-tracker.tsx` | L | FINANCE | Y | protected | `revenue_tracker` | all with perm | P0-critical | LOW | Revenue tracking dashboard. |
| 55 | `/cos` | top-level | `pages/cos.tsx` | L | FINANCE | Y | protected | `cos` | all with perm | P1-important | LOW | Cost of Sales tracker. |
| 56 | `/gp-tracker` | top-level | `pages/gp-tracker.tsx` | L | FINANCE | Y | protected | `gp_tracker` | all with perm | P1-important | LOW | Gross Profit / margin tracker. |
| 57 | `/fye-revenue-tracking` | top-level | `pages/fye-revenue-tracking.tsx` | L | FINANCE | Y | protected | `fye_revenue_tracking` | all with perm | P1-important | LOW | Financial Year End revenue tracking. |
| 58 | `/finance/records` | top-level | `pages/finance-records.tsx` | L | FINANCE | Y | protected | `financials` | all with perm | P1-important | LOW | Finance records dashboard. |
| 59 | `/finance/workspace/:projectId` | parameterized | `pages/finance-workspace.tsx` | L | FINANCE | N | protected | `financials` | all with perm | P1-important | MEDIUM | Per-project finance workspace. URL param: `:projectId`. Hidden from sidebar. |
| 60 | `/invoice-patterns` | top-level | `pages/invoice-patterns.tsx` | L | FINANCE | Y | protected | `invoice_patterns` | all with perm | P1-important | LOW | Invoice patterns dashboard. |
| 61 | `/counterparties` | top-level | `pages/counterparties.tsx` | L | FINANCE | Y | protected | `counterparties` | all with perm | P1-important | LOW | Counterparties management. |
| 62 | `/subcontractor-dashboard` | top-level | `pages/subcontractor-dashboard.tsx` | L | FINANCE | Y | protected | `subcontractors` | all with perm | P1-important | LOW | Subcontractor management. |

---

### 1e. Engineering Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 63 | `/engineering` | top-level | `pages/engineering-dashboard.tsx` | L | ENGINEERING | Y | protected | `engineering` | ENG_MGR, ENGINEER (landing) + all with perm | P0-critical | LOW | Engineering dashboard. Role landing for 2 roles. |
| 64 | `/engineering/tasks` | sub-route | `pages/engineering-tasks.tsx` → barrel → `pages/EngineeringTasksPage.tsx` | L | ENGINEERING | Y | protected | `eng_tasks` | all with perm | P0-critical | LOW | Engineering task board. Barrel re-export chain. |
| 65 | `/engineering/standup` | sub-route | `pages/engineering/standup/index.tsx` | L | ENGINEERING | Y | protected | `standups` | all with perm | P1-important | LOW | Engineering standup with blocker strips, task lanes, queue. |
| 66 | `/engineering/audit` | hidden | `pages/engineering-audit.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Engineering audit log. Admin-gated. Hidden from sidebar. |
| 67 | `/engineering/deliverables-v2/:projectId` | parameterized | `pages/engineering-deliverables-v2.tsx` | L | ENGINEERING | N | protected | `deliverables` | all with perm | P1-important | MEDIUM | Per-project engineering deliverables. URL param: `:projectId`. Hidden from sidebar. |

---

### 1f. Quality & HSE Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 68 | `/quality` | top-level | `pages/qm-dashboard.tsx` | L | QUALITY | Y | protected | `quality` | QUALITY_MGR (landing) + all with perm | P0-critical | LOW | Quality management dashboard. Role landing for QUALITY_MANAGER. |
| 69 | `/quality/dashboard` | alias | — | — | — | N | protected | `quality` | same as #68 | P2-secondary | LOW | Alias → `/quality`. |
| 70 | `/quality/ncrs` | alias | — | — | — | N | protected | `quality` | same as #68 | P2-secondary | LOW | Legacy NCR list. Alias → `/quality`. |
| 71 | `/quality/ncr/:id` | alias | — | — | — | N | protected | `quality` | same as #68 | P2-secondary | LOW | Legacy NCR detail. Alias → `/quality`. |
| 72 | `/commissioning-dashboard` | top-level | `pages/commissioning-dashboard.tsx` | L | QUALITY | Y | protected | `commissioning` | all with perm | P1-important | LOW | Commissioning overview. Also has explicit `<Route>` in ProtectedPages for selector. |
| 73 | `/commissioning-dashboard/:projectId` | parameterized | `pages/commissioning-dashboard.tsx` | L | QUALITY | N | protected | `commissioning` | all with perm | P1-important | MEDIUM | Per-project commissioning. URL param: `:projectId`. Hidden from sidebar. |
| 74 | `/hse` | top-level | `pages/hse-dashboard.tsx` | L | HSE | Y | protected | `hse` | HSE_MGR, SSEG_MGR (landing) + all with perm | P0-critical | LOW | HSE dashboard. Role landing for 2 roles. |
| 75 | `/hse/compliance` | alias | — | — | HSE | N | protected | `hse_compliance` | all with perm | P2-secondary | LOW | Alias → `/hse?tab=compliance`. SSEG compliance tab. |

---

### 1g. Gates Workspace Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 76 | `/gates` | top-level | `pages/gates/gates-pipeline.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P0-critical | LOW | Gates pipeline — main lifecycle view. Default landing for CEO/PROGRAM_MGR lens. |
| 77 | `/gates/blocked` | sub-route | `pages/gates/gates-blocked.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Blocked gates view. |
| 78 | `/gates/ready` | sub-route | `pages/gates/gates-ready.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Ready gates view. |
| 79 | `/gates/exceptions` | sub-route | `pages/gates/gates-exceptions.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Gate exceptions. |
| 80 | `/gates/client-updates` | sub-route | `pages/gates/gates-client-updates.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Client updates per gate. |
| 81 | `/gates/handovers` | sub-route | `pages/gates/gates-handovers.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Gate handover queue. |
| 82 | `/gates/queries` | sub-route | `pages/gates/gates-queries.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Open queries. |
| 83 | `/gates/commitments` | sub-route | `pages/gates/gates-commitments.tsx` | L | GATES | Y | protected | `lifecycle` | all with perm | P1-important | LOW | Client commitments. |

---

### 1h. Project Development Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 84 | `/pd` | top-level | `pages/pd-dashboard.tsx` | L | PROJECT_DEVELOPMENT | Y | protected | `pd_dashboard` | CCO, KEY_ACCT_MGR, PROJ_DEV (landing) + all with perm | P0-critical | LOW | PD dashboard. Role landing for 3 roles. Aliases: `/pd/dashboard`. |
| 85 | `/pd/tickets` | sub-route | `pages/pd-tickets.tsx` | L | PROJECT_DEVELOPMENT | Y | protected | `pd_tickets` | all with perm | P1-important | LOW | PD ticket list. |
| 86 | `/pd/tickets/create` | deep-link | `pages/pd-ticket-create.tsx` | L | PROJECT_DEVELOPMENT | N | protected | `pd_tickets` | all with perm | P1-important | LOW | Create PD ticket. |
| 87 | `/pd/tickets/:id` | parameterized | `pages/pd-ticket-detail.tsx` | L | PROJECT_DEVELOPMENT | N | protected | `pd_tickets` | all with perm | P1-important | MEDIUM | PD ticket detail. URL param: `:id`. |
| 88 | `/pd/reports` | sub-route | `pages/pd-reports.tsx` | L | PROJECT_DEVELOPMENT | Y | protected | `pd_dashboard` | all with perm | P1-important | LOW | PD reports dashboard. |
| 89 | `/pd/handover/:projectId` | parameterized | `pages/pd-pm-handover-v2.tsx` | L | — | N | protected | `handover` | all with perm | P1-important | MEDIUM | PD→PM handover V2. URL param: `:projectId`. Active version (v1 removed 2026-03-31). |
| 90 | `/opportunities` | top-level | `pages/opportunities.tsx` | L | PROJECT_DEVELOPMENT | Y | protected | `pd_dashboard` | all with perm | P1-important | LOW | Opportunities / pipeline (Phase B entity). |
| 91 | `/clients` | top-level | `pages/clients.tsx` | L | PROJECTS | Y | protected | `pd_clients` | all with perm | P1-important | LOW | Clients list. Aliases: `/pd/clients`. |
| 92 | `/clients/:clientId` | parameterized | `pages/client-detail.tsx` | L | — | N | protected | `pd_clients` | all with perm | P1-important | MEDIUM | Client detail. URL param: `:clientId`. |
| 93 | `/clients/:clientId/project/:projectId` | deep-link | `pages/client-project-departments.tsx` | L | — | N | protected | `pd_clients` | all with perm | P1-important | MEDIUM | Client project departments. Two URL params. |

---

### 1i. Reports Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 94 | `/reports/center` | top-level | `pages/reports/report-center.tsx` | L | REPORTS | Y | protected | `reports` | all with perm | P1-important | LOW | Central report hub. |
| 95 | `/reports/performance` | top-level | `pages/reports/performance.tsx` | L | REPORTS | Y | protected | `performance` | all with perm | P1-important | LOW | Performance dashboard. |
| 96 | `/reports/programme` | top-level | `pages/programme-reports.tsx` | L | REPORTS | Y | protected | `reports` | all with perm | P1-important | LOW | Programme-level reports. |
| 97 | `/reports/pm/monthly` | top-level | `pages/pm-monthly-report.tsx` | L | REPORTS | Y | protected | `reports` | all with perm | P1-important | LOW | PM monthly report. |
| 98 | `/reports/pm/monthly/history` | sub-route | `pages/pm-monthly-report-history.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | LOW | PM report history. |
| 99 | `/reports/pm/monthly/compare` | sub-route | `pages/pm-monthly-report-compare.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | LOW | PM report comparison. |
| 100 | `/reports/pm/monthly/:month/project/:projectId` | deep-link | `pages/pm-monthly-report-project.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | MEDIUM | PM report per project per month. Two URL params. |
| 101 | `/reports/engineering/monthly` | top-level | `pages/engineering-monthly-report.tsx` | L | REPORTS | Y | protected | `reports` | all with perm | P1-important | LOW | Engineering monthly report. |
| 102 | `/reports/engineering/monthly/history` | sub-route | `pages/engineering-monthly-report-history.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | LOW | Engineering report history. |
| 103 | `/reports/engineering/monthly/compare` | sub-route | `pages/engineering-monthly-report-compare.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | LOW | Engineering report comparison. |
| 104 | `/reports/engineering/monthly/:month/project/:projectId` | deep-link | `pages/engineering-monthly-report-project.tsx` | L | — | N | protected | `reports` | all with perm | P2-secondary | MEDIUM | Engineering report per project per month. Two URL params. |

---

### 1j. Knowledge & Parties Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 105 | `/priorities` | top-level | `pages/priorities.tsx` | L | PRIORITIES | Y | protected | `company_priorities` | all with perm | P1-important | LOW | Company priorities dashboard. |
| 106 | `/priorities/:id` | parameterized | `pages/priority-detail.tsx` | L | — | N | protected | `company_priorities` | all with perm | P1-important | MEDIUM | Priority detail. URL param: `:id`. Uses `isPriorityAdminRole()` for edit access. |
| 107 | `/leaderboard` | hidden | `pages/leaderboard.tsx` | L | KNOWLEDGE | N | protected | `leaderboard` | all with perm | P2-secondary | LOW | Gamification leaderboard. Hidden from sidebar. |
| 108 | `/feedback` | top-level | `pages/feedback.tsx` | L | KNOWLEDGE | Y | protected | `feedback` | all with perm | P2-secondary | LOW | Feedback & support page. |
| 109 | `/ee-info` | top-level | `pages/ee-info.tsx` | L | KNOWLEDGE | Y | protected | `ee_info` | all with perm | P2-secondary | LOW | Processes & SOPs. |
| 110 | `/training` | top-level | `pages/training.tsx` | L | KNOWLEDGE | Y | protected | `training` | all with perm | P2-secondary | LOW | Training materials. |
| 111 | `/parties` | top-level | `pages/parties-registry.tsx` | L | PARTIES | Y | protected | `counterparties` | all with perm | P1-important | LOW | Parties registry (unified counterparties view). |

---

### 1k. Admin Routes

| # | Route Path | Route Type | Component File | Load | Nav Group | Sidebar | Access | Permission Entity | Allowed Roles | Criticality | Runtime Risk | Notes |
|---|-----------|------------|----------------|------|-----------|---------|--------|-------------------|---------------|-------------|-------------|-------|
| 112 | `/admin/control-center` | top-level | `pages/admin-control-center.tsx` | L | SYSTEM | N | protected | `admin` | COO, CEO (admin) | P1-important | LOW | Central admin hub. COO_SUPER_ADMIN lens landing. Not in sidebar (accessible via Admin nav pills). |
| 113 | `/admin/roles` | top-level | `pages/admin-roles.tsx` | L | SYSTEM | N | protected | `admin_roles` | COO, CEO (admin) | P1-important | LOW | Roles & Permissions management. |
| 114 | `/admin/settings` | hidden/admin | `pages/role-settings.tsx` | L | SYSTEM | N | protected | `admin` | COO, CEO (admin) | P2-secondary | LOW | System settings. Hidden from sidebar. |
| 115 | `/admin/smart-import` | top-level | `pages/smart-import.tsx` | L | SYSTEM | N | protected | `smart_import` | admin roles | P1-important | MEDIUM | Multi-step data import wizard. Complex state machine. |
| 116 | `/admin/sharepoint-intake` | hidden/admin | `pages/SharePointIntakePage.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | MEDIUM | SharePoint document intake. Requires SharePoint integration. |
| 117 | `/admin/activity-log` | top-level | `pages/system-activity-log.tsx` | L | SYSTEM | N | protected | `activity_log` | admin roles | P1-important | LOW | System audit trail. |
| 118 | `/admin/migration-control` | top-level | `pages/admin-migration-control.tsx` | L | ADMIN | Y | protected | `admin` | admin roles | P2-secondary | LOW | Migration control interface. Only admin route shown in sidebar. |
| 119 | `/admin/database-migration` | hidden/admin | `pages/database-migration.tsx` | L | — | N | protected | `database_migration` | admin roles | P2-secondary | HIGH | Database migration runner. Dangerous in production. |
| 120 | `/admin/kpi-traceability` | hidden/admin | `pages/kpi-traceability.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | KPI calculation traceability. |
| 121 | `/admin/import-control-tower` | hidden/admin | `pages/import-control-tower.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Import pipeline monitoring. |
| 122 | `/admin/recovery` | hidden/admin | `pages/admin-recovery.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | MEDIUM | Soft-delete recovery center. |
| 123 | `/admin/stage-lifecycle` | hidden/admin | `components/stage-lifecycle/StageAdminPanel` | L | SYSTEM | N | protected | `stage_admin` | admin roles | P2-secondary | MEDIUM | Stage lifecycle admin. Note: component is in `components/` not `pages/`. |
| 124 | `/admin/phase-templates` | hidden/admin | `pages/phase-templates.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Project phase template management. |
| 125 | `/admin/eng-templates` | hidden/admin | `pages/eng-template-admin.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Engineering deliverable templates. |
| 126 | `/admin/workflow-config` | hidden/admin | `pages/admin-workflow-config.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Approval workflow configuration. |
| 127 | `/admin/data-migration-status` | hidden/admin | `pages/admin-backfill.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | LOW | Data migration / backfill status. |
| 128 | `/admin/pipedrive` | hidden/admin | `pages/admin-pipedrive.tsx` | L | SYSTEM | N | protected | `admin` | admin roles | P2-secondary | MEDIUM | Pipedrive CRM integration. External dependency. |
| 129 | `/admin/my-tool-settings` | hidden/admin | `pages/my-work-admin-settings.tsx` | L | — | N | protected | `admin` | admin roles | P2-secondary | LOW | My Work admin configuration. |
| 130 | `/admin/lessons` | hidden/admin | `pages/lessons-learnt.tsx` | L | SYSTEM | N | protected | `handover` | all with perm | P2-secondary | LOW | Lessons learnt from handovers. |
| 131 | `/admin/handover-health` | hidden/admin | `pages/handover-control.tsx` | L | SYSTEM | N | protected | `handover` | all with perm | P2-secondary | LOW | Handover health score. Reuses HandoverControlPage component. |

---

### 1l. Legacy Redirects (LEGACY_REDIRECTS array)

These are old bookmarks / deep links that redirect to canonical paths. They do NOT appear in sidebar or command palette.

| # | Old Path | Redirect Target | Notes |
|---|---------|----------------|-------|
| R1 | `/dashboard` | `/gates` | Legacy dashboard → Gates pipeline. Collapsed chain: was /dashboard → /execution-board → /gates. |
| R2 | `/revenue` | `/revenue-tracker` | Old finance path. |
| R3 | `/my-tool` | `/` | Old personal tool → Home. |
| R4 | `/my-tool/week` | `/my-work/calendar` | Old calendar path. |
| R5 | `/my-tool/backlog` | `/my-work/tasks` | Old backlog path. |
| R6 | `/my-tool/settings` | `/my-work/settings` | Old settings path. |
| R7 | `/my-tool/help` | `/` | Old help path → Home. |
| R8 | `/my-tool/meetings` | `/my-work/meetings` | Old meetings path. |
| R9 | `/company-priorities` | `/priorities` | Renamed. |
| R10 | `/admin` | `/admin/control-center` | Bare /admin → control center. |
| R11 | `/admin/legacy-utilities` | `/admin/control-center` | Removed legacy utilities. |
| R12 | `/exceptions` | `/gates/exceptions` | Moved under gates workspace. |
| R13 | `/project-lifecycle` | `/lifecycle-board` | Renamed. |
| R14 | `/command-center` | `/my-work` | Old command center → My Work. |
| R15 | `/sseg` | `/handover?tab=sseg` | SSEG → handover compliance tab. |
| R16 | `/finance/home` | `/finance/records` | Department shell redirect. |
| R17 | `/governance` | `/governance/processes` | Department shell redirect. |

### 1m. In-Registry Aliases (type: "alias" entries)

These are PAGE_REGISTRY entries with `type: "alias"` or `redirectTo` — they exist in the registry but redirect.

| # | Alias Path | Redirect Target | Notes |
|---|-----------|----------------|-------|
| A1 | `/revenue` | `/revenue-tracker` | Also in LEGACY_REDIRECTS (double coverage). |
| A2 | `/cos-control` | `/cos` | Legacy COS path. |
| A3 | `/cashflow-forecast` | `/cashflow` | Legacy cashflow path. |
| A4 | `/company-priorities` | `/priorities` | Also in LEGACY_REDIRECTS (double coverage). |
| A5 | `/execution-dashboard` | `/execution-board` | Alias declared on executionBoard entry. |
| A6 | `/pd/dashboard` | `/pd` | Alias declared on pdDashboard entry. |
| A7 | `/pd/clients` | `/clients` | Alias declared on clients entry. |
| A8 | `/quality/dashboard` | `/quality` | Legacy quality dashboard. |
| A9 | `/quality/ncrs` | `/quality` | Legacy NCR list. |
| A10 | `/quality/ncr/:id` | `/quality` | Legacy NCR detail — LOSES the :id param on redirect. |
| A11 | `/standups` | `/engineering/standup` | Moved under engineering. |
| A12 | `/teams/chats` | `/my-work/teams` | Moved under my-work. |
| A13 | `/collaboration` | `/my-work` | Moved under my-work. |
| A14 | `/collaboration/email` | `/my-work/email` | Moved under my-work. |
| A15 | `/collaboration/teams` | `/my-work/teams` | Moved under my-work. |
| A16 | `/command-center` | `/my-work` | Also in LEGACY_REDIRECTS (double coverage). |
| A17 | `/my-work/approvals` | `/my-work/tasks?source=approvals` | Alias with query param. |
| A18 | `/pm/deliverables` | `/pm/approvals` | Retired PM deliverables. |
| A19 | `/department-scores` | `/leaderboard?tab=departments` | Alias with query param. |
| A20 | `/procurement` | `/execution-board` | Procurement alias. |
| A21 | `/hse/compliance` | `/hse?tab=compliance` | Tab alias. |

### 1n. Role Landing Page Map

Derived from `roleLandingEligibility` in PAGE_REGISTRY → `ROLE_LANDING_PAGE`.

| Company Role | Landing Path | Page |
|-------------|-------------|------|
| COO_ADMIN | `/company-overview` | CompanyOverviewPage |
| CEO_ADMIN | `/company-overview` | CompanyOverviewPage |
| PROJECT_MANAGER_SITE | `/execution-board` | ExecutionBoardPage |
| PROGRAM_MANAGER | `/execution-board` | ExecutionBoardPage |
| CONSTRUCTION_MANAGER | `/execution-board` | ExecutionBoardPage |
| CFO | `/cashflow` | CashflowPage |
| PROGRAM_FINANCE_MANAGER | `/cashflow` | CashflowPage |
| ACCOUNTANT | `/cashflow` | CashflowPage |
| ENGINEERING_MANAGER | `/engineering` | EngineeringDashboardPage |
| ENGINEER | `/engineering` | EngineeringDashboardPage |
| QUALITY_MANAGER | `/quality` | QmDashboardPage |
| CCO | `/pd` | PdDashboardPage |
| KEY_ACCOUNTS_MANAGER | `/pd` | PdDashboardPage |
| PROJECT_DEVELOPER | `/pd` | PdDashboardPage |
| HSE_MANAGER | `/hse` | HseDashboardPage |
| SSEG_MANAGER | `/hse` | HseDashboardPage |
| *(any other role)* | `/` | HomePage (fallback) |

### Summary Statistics

| Category | Count |
|----------|-------|
| Total routable paths (pages + aliases + redirects) | **148** |
| Active page routes (with component) | **107** |
| Alias/redirect routes | **38** |
| Legacy redirects (LEGACY_REDIRECTS) | **17** |
| Parameterized routes (`:param`) | **16** |
| Deep-link routes (2+ params) | **4** |
| Eagerly loaded pages | **4** |
| Lazy-loaded pages | **103** |
| Sidebar-visible routes | **~60** |
| Hidden/non-sidebar routes | **~47** |
| Admin-only routes | **20** |
| Public (no-auth) routes | **3** |
| Role landing pages | **16 roles mapped** |

---

## 2. ROUTES MOST LIKELY TO FAIL AT RUNTIME

Ranked by probability of runtime failure, highest first.

### RISK TIER 1 — HIGH (likely to break without targeted testing)

| # | Route | Risk Level | Failure Mode | Why |
|---|-------|-----------|-------------|-----|
| 2.1 | `/auth/ms-callback` | **HIGH** | Silent auth failure, user locked out | OAuth code exchange depends on Microsoft tenant config, redirect URI match, token endpoint availability. If `exchange-code` API fails, user sees a flash then lands on `/auth/login?error=ms_auth_failed`. No retry UX. This is the ONLY production login path. |
| 2.2 | `/admin/database-migration` | **HIGH** | Data corruption, schema drift | Runs DDL against production database. Permission entity is `database_migration` (not `admin`) — if this entity isn't properly gated, non-admins could theoretically reach it. No sidebar visibility but URL-accessible. |
| 2.3 | `/admin/smart-import` | **HIGH** | Partial data commit, orphaned records | Multi-step wizard with complex state machine (Upload → Mapping → Issues → Commit). Interruption at any step can leave partial state. Uses direct localStorage auth token for API calls rather than standard hook pattern — diverges from app auth standard. |
| 2.4 | `/project/:projectName/gate/:stageCode` | **HIGH** | 404 / crash on invalid gate code | Two URL params. If `:stageCode` doesn't match a valid lifecycle stage, component behavior is undefined. No evidence of param validation at the route level. |
| 2.5 | `/reports/pm/monthly/:month/project/:projectId` | **HIGH** | Crash on invalid month format | Two URL params including `:month` which likely expects a specific date format. No route-level validation. Same risk for engineering variant (#104). |
| 2.6 | `/quality/ncr/:id` | **MEDIUM-HIGH** | Redirect loses the `:id` parameter | This alias redirects to `/quality` — the `:id` param is silently dropped. Users following old NCR bookmarks will land on the quality dashboard with no indication which NCR they wanted. |

### RISK TIER 2 — MEDIUM (could fail under specific conditions)

| # | Route | Risk Level | Failure Mode | Why |
|---|-------|-----------|-------------|-----|
| 2.7 | `/my-work/meetings` | **MEDIUM** | Empty state or MS token error | Requires valid Microsoft token for calendar API. If MS token is expired/missing, behavior depends on error handling in `MyWorkMeetingsPage`. |
| 2.8 | `/my-work/email` | **MEDIUM** | Same as meetings | Microsoft Graph email integration — same token dependency. |
| 2.9 | `/my-work/teams` | **MEDIUM** | Same as meetings | Microsoft Teams integration — same token dependency. |
| 2.10 | `/finance/workspace/:projectId` | **MEDIUM** | Crash on deleted/invalid project | Parameterized route. If `:projectId` references a soft-deleted or non-existent project, behavior depends on API error handling. |
| 2.11 | `/pm/workboard/:projectId` | **MEDIUM** | Same as finance workspace | Same parameterized project risk. |
| 2.12 | `/engineering/deliverables-v2/:projectId` | **MEDIUM** | Same as finance workspace | Same parameterized project risk. |
| 2.13 | `/commissioning-dashboard/:projectId` | **MEDIUM** | Same as finance workspace | Same parameterized project risk. Dual registration: explicit `<Route>` in ProtectedPages AND in APP_ROUTES — could cause route shadowing. |
| 2.14 | `/admin/pipedrive` | **MEDIUM** | External API timeout / config missing | Depends on Pipedrive CRM integration being configured. Will fail with unhelpful error if Pipedrive API keys are not set. |
| 2.15 | `/admin/sharepoint-intake` | **MEDIUM** | External dependency on SharePoint | Requires SharePoint integration to be configured and accessible. |
| 2.16 | `/admin/stage-lifecycle` | **MEDIUM** | Component loaded from `components/` not `pages/` | `StageAdminPage` is lazy-imported from `@/components/stage-lifecycle/StageAdminPanel` rather than the standard `@/pages/` directory. This breaks the assumption that all route components live in `pages/`. If the component path changes during refactoring, this route silently breaks. |
| 2.17 | `/pd/handover/:projectId` | **MEDIUM** | V2 migration risk | Comment says "v1 removed 2026-03-31" — this was very recently migrated. V2 component (`pd-pm-handover-v2.tsx`) may have edge cases not yet caught in production. |

### RISK TIER 3 — LOW-MEDIUM (edge cases)

| # | Route | Risk Level | Failure Mode | Why |
|---|-------|-----------|-------------|-----|
| 2.18 | `/commissioning-dashboard` (no param) | **LOW-MEDIUM** | Dual route registration | Has BOTH an explicit `<Route path="/commissioning-dashboard" component={...} />` in ProtectedPages AND appears in APP_ROUTES via PAGE_REGISTRY. The explicit route takes precedence due to Switch ordering, but this is fragile. |
| 2.19 | `/sseg` (legacy redirect) | **LOW-MEDIUM** | Query param may not be preserved correctly | Redirects to `/handover?tab=sseg`. The `RedirectPreserveQuery` component handles query params, but this redirect TARGET already has a query param — merging behavior with any existing user query params could produce unexpected results. |
| 2.20 | `/` (home) | **LOW-MEDIUM** | Role resolution failure | `HomeRedirect` reads role from both `user?.role` and `localStorage.company_role`. If these disagree or both are null, the fallback is `/` which renders HomePage. But if the ROLE_LANDING_PAGE lookup returns a path the user doesn't have permission to, they'll hit AccessDenied on their landing page. |

---

## 3. ROUTES THAT LOOK ORPHANED OR HALF-MIGRATED

### 3a. Orphan Page Files (exist on disk, NOT imported in App.tsx router)

These `.tsx` files exist in `client/src/pages/` but are **never lazy-imported or eagerly-imported** in `App.tsx`. They are dead code or half-migrated remnants.

| # | File | Status | Evidence | Action Needed |
|---|------|--------|----------|---------------|
| 3.1 | `pages/construction-dashboard.tsx` | **ORPHAN** | File exists with a full `ConstructionDashboardPage` component. But the registry entry `constructionDashboard` at `/construction` maps to `ExecutionBoardPage` instead. This file is never imported. | Delete or wire up. Currently dead code. |
| 3.2 | `pages/procurement-dashboard.tsx` | **ORPHAN** | File exists with a full `ProcurementDashboardPage` component. But the registry entry `procurementDashboard` at `/procurement` is an alias → `/execution-board`. This file is never imported. | Delete or wire up. Currently dead code. |
| 3.3 | `pages/standups.tsx` | **ORPHAN** | File exists with a full standup component. But the registry entry `standups` at `/standups` is an alias → `/engineering/standup`. The router imports `EngineeringStandupPage` from `pages/engineering/standup/index.tsx` instead. | Delete. Superseded by `engineering/standup/`. |
| 3.4 | `pages/dashboard.tsx` | **ORPHAN** | File exists with a full dashboard component. But `/dashboard` is a legacy redirect → `/gates`. This file is never imported. | Delete. Legacy remnant. |
| 3.5 | `pages/exceptions.tsx` | **ORPHAN** | File exists with a full exceptions component. But `/exceptions` is a legacy redirect → `/gates/exceptions`. This file is never imported. | Delete. Legacy remnant. |
| 3.6 | `pages/collaboration.tsx` | **ORPHAN** | File exists exporting `useProjectsList()` hook and a full collaboration component. But `/collaboration` is an alias → `/my-work`. This file is never imported as a route component. The hook may be imported elsewhere. | Verify if the hook is used elsewhere. If not, delete. |
| 3.7 | `pages/collab-teams.tsx` | **ORPHAN** | File exists with `CollabTeamsPage`. But `/my-work/teams` imports `TeamsChatsPage` from `pages/teams-chats.tsx`. This file is never imported. | Delete. Superseded by `teams-chats.tsx`. |
| 3.8 | `pages/my-work-priorities.tsx` | **ORPHAN** | File exists with a priorities component. No PAGE_REGISTRY entry maps to this file. No `routeComponentKey` references it. Never imported. | Delete. No route exists for this file. |
| 3.9 | `pages/EngineeringTasksPage.tsx` | **NOT ORPHAN** | PascalCase file. `pages/engineering-tasks.tsx` barrel-exports from this file (`export { default } from "./EngineeringTasksPage"`). It IS used, just indirectly. | Keep. Working barrel pattern. |

### 3b. Half-Migrated Patterns (registry says one thing, code does another)

| # | Issue | Details |
|---|-------|---------|
| 3.10 | **`/construction` renders wrong component** | Registry entry `constructionDashboard` has `routeComponentKey: "ExecutionBoardPage"` — it renders the execution board, not the dedicated `construction-dashboard.tsx` that exists on disk. Either the page file is abandoned or the registry is wrong. |
| 3.11 | **`/procurement` is an alias but has a dedicated page file** | Registry entry `procurementDashboard` has `type: "alias"` redirecting to `/execution-board`, but `procurement-dashboard.tsx` exists with a full component. Same pattern as #3.10. |
| 3.12 | **Dual legacy/alias coverage** | Three paths appear in BOTH `LEGACY_REDIRECTS` AND as `type: "alias"` entries in PAGE_REGISTRY: `/revenue`, `/company-priorities`, `/command-center`. The legacy redirect fires first (it's mapped first in APP_ROUTES), making the registry alias unreachable. No functional bug, but confusing maintenance hazard. |
| 3.13 | **`/admin/stage-lifecycle` component lives in `components/`** | All other routes load from `pages/`. This one loads from `components/stage-lifecycle/StageAdminPanel`. It works but breaks the convention and will be missed by any pages-directory-scoped refactoring. |
| 3.14 | **`/execution-board` barrel chain** | `pages/execution-board.tsx` → re-exports from `pages/execution-dashboard/index.tsx`. The lazy import in App.tsx imports from `pages/execution-board`. This indirection works but adds a fragile barrel hop. |
| 3.15 | **`/commissioning-dashboard` dual registration** | Has both an explicit `<Route path="/commissioning-dashboard" ...>` in ProtectedPages AND appears in APP_ROUTES from PAGE_REGISTRY. The explicit route wins due to Switch ordering, but the duplicate is unnecessary and confusing. |
| 3.16 | **`/department-scores` has both `routeComponentKey` AND `redirectTo`** | Registry entry has `routeComponentKey: "DepartmentScoresPage"` AND `redirectTo: "/leaderboard?tab=departments"`. The `redirectTo` takes precedence in APP_ROUTES building logic (checked first), so the component is never rendered. The lazy import of `DepartmentScoresPage` in App.tsx is dead code. |
| 3.17 | **Old `config/page-registry.ts` at repo root** | A second `page-registry.ts` exists at `/config/page-registry.ts` (outside `client/src/`). This appears to be an older version. If any import accidentally resolves to this file instead of `client/src/config/page-registry.ts`, routes will break silently. |

---

## 4. ROUTES VISIBLE TO USERS AND THEREFORE STOP-SHIP IF BROKEN

These routes are **in the sidebar**, **in top-nav pills**, or are **role landing pages**. If they break, users see it immediately. Grouped by business criticality.

### TIER 0 — Login & Landing (every user hits these)

| Route | Why Stop-Ship | Who Is Blocked |
|-------|--------------|----------------|
| `/auth/login` | Only login path. Broken = nobody can get in. | ALL users |
| `/auth/ms-callback` | OAuth callback. Broken = login completes but token exchange fails = locked out. | ALL users |
| `/` | Home / role-aware dashboard. Broken = first thing every user sees after login is broken. | ALL users |
| `/company-overview` | COO_ADMIN + CEO_ADMIN landing page. C-suite can't work. | Leadership (2 roles) |
| `/execution-board` | Landing for PM_SITE, PROGRAM_MGR, CONSTRUCTION_MGR. Core operational cockpit. | PM + Construction teams (3 roles) |
| `/cashflow` | Landing for CFO, PROG_FIN_MGR, ACCOUNTANT. Finance team blocked. | Finance team (3 roles) |
| `/engineering` | Landing for ENG_MGR, ENGINEER. Engineering team blocked. | Engineering team (2 roles) |
| `/quality` | Landing for QUALITY_MANAGER. Quality team blocked. | Quality team (1 role) |
| `/pd` | Landing for CCO, KEY_ACCT_MGR, PROJECT_DEVELOPER. BD team blocked. | Business dev team (3 roles) |
| `/hse` | Landing for HSE_MANAGER, SSEG_MANAGER. Safety team blocked. | HSE team (2 roles) |
| `/gates` | Primary lifecycle view. CEO/PROGRAM_MGR lens default. Visible in top nav. | Leadership + PM |

### TIER 1 — High-Traffic Sidebar Pages (daily use by multiple roles)

| Route | Why Stop-Ship | Primary Users |
|-------|--------------|---------------|
| `/my-work` | Personal task hub. Every user's daily driver. | ALL users |
| `/my-work/tasks` | Personal task list. Core productivity surface. | ALL users |
| `/inbox` | Notifications. Users expect this to always work. | ALL users |
| `/projects` | Master project list. Core navigation hub. | PM, Engineering, Finance |
| `/project/:projectName` | Project detail — 20+ tabs. Most-visited parameterized route. | ALL project-facing roles |
| `/pm-dashboard` | PM overview dashboard. | PM team |
| `/engineering/tasks` | Engineering task board. Daily use by eng team. | Engineering |
| `/pd/tickets` | PD ticket pipeline. Daily use by BD team. | Business dev |
| `/priorities` | Company priorities visible to leadership. | Leadership + all roles |
| `/revenue-tracker` | Revenue tracking. Finance daily use. | Finance |
| `/cos` | Cost of Sales. Finance daily use. | Finance |
| `/finance/records` | Finance records hub. | Finance |
| `/weekly-reviews` | Weekly review wizard. PM weekly cadence. | PM team |
| `/po-approval-board` | PO approvals — procurement workflow. | PM + Finance |
| `/payment-request-board` | Payment requests — procurement workflow. | PM + Finance |
| `/governance/processes` | Governed processes. Operational governance. | PM + Leadership |
| `/governance/approvals` | Approvals board. Operational governance. | PM + Leadership |
| `/handover-control` | PD→PM handover queue. Cross-team workflow. | PD + PM teams |
| `/handover` | Handover & Closeout dashboard. | PM team |

### TIER 2 — Sidebar-Visible But Lower Frequency

| Route | Primary Users |
|-------|---------------|
| `/my-work/calendar` | All (Microsoft integration dependent) |
| `/my-work/meetings` | All (Microsoft integration dependent) |
| `/my-work/email` | All (Microsoft integration dependent) |
| `/my-work/teams` | All (Microsoft integration dependent) |
| `/gp-tracker` | Finance |
| `/fye-revenue-tracking` | Finance |
| `/invoice-patterns` | Finance |
| `/counterparties` | Finance |
| `/subcontractor-dashboard` | Finance + PM |
| `/parties` | Finance |
| `/engineering/standup` | Engineering |
| `/commissioning-dashboard` | Quality |
| `/lifecycle-board` | Leadership |
| `/milestone-tracker` | Construction Manager |
| `/portfolios` | Leadership |
| `/pd/reports` | Business dev |
| `/opportunities` | Business dev |
| `/clients` | Business dev |
| `/sites` | PM |
| `/reports/center` | All |
| `/reports/programme` | Leadership |
| `/reports/pm/monthly` | PM |
| `/reports/engineering/monthly` | Engineering |
| `/reports/performance` | Leadership |
| `/feedback` | All |
| `/ee-info` | All |
| `/training` | All |

---

## 5. ROUTES THAT REQUIRE MANUAL BUSINESS UAT

These routes cannot be fully validated by automated tests. They require a human with domain knowledge to verify correctness of displayed data, business logic, workflow outcomes, and cross-system integrations.

### 5a. Financial Accuracy (requires domain expert with real data)

| Route | What to UAT | Why Automated Tests Aren't Enough |
|-------|------------|-----------------------------------|
| `/cashflow` | Cash flow projections, forecast accuracy, date alignment | Financial projections depend on business rules, fiscal calendar, and real invoice/payment data. Wrong numbers = wrong decisions. |
| `/revenue-tracker` | Revenue recognition, period allocation, totals vs source systems | Must cross-check against source financial systems (Xero, etc.). |
| `/cos` | Cost of Sales calculation correctness | Calculation rules are business-specific. Need accountant to verify. |
| `/gp-tracker` | Gross profit margin calculations | Derived from revenue + COS — compound error risk. |
| `/fye-revenue-tracking` | FYE projections, year-end close figures | Fiscal year boundary logic. Needs finance team sign-off. |
| `/invoice-patterns` | Pattern detection accuracy | Business rules for invoice pattern matching are domain-specific. |
| `/finance/records` | Record completeness, categorization | Need to verify against actual financial records. |
| `/finance/workspace/:projectId` | Per-project financial data accuracy | Must match project actuals. |
| `/governance/financial-reviews` | Review queue completeness, threshold logic | Approval thresholds are business-configured. |

### 5b. Workflow & Approval Chains (requires multi-user testing)

| Route | What to UAT | Why |
|-------|------------|-----|
| `/po-approval-board` | PO approval workflow end-to-end | Multi-step approval chain. Need to test with approver + requester roles. |
| `/payment-request-board` | Payment request → approval → batch flow | Cross-references POs, budgets, approval chains. |
| `/payment-batch-manager` | Batch creation, payment scheduling | Financial action — wrong batch = wrong payments. |
| `/pm/approvals` | PM approval queue accuracy | Need to verify correct items surface for correct approver. |
| `/governance/approvals` | Governance approval board | Multi-entity approval routing. |
| `/weekly-reviews` | Weekly review wizard flow | Multi-step wizard producing reports. Need PM to verify output matches reality. |

### 5c. Cross-System Integrations (requires live external systems)

| Route | What to UAT | External System |
|-------|------------|-----------------|
| `/my-work/meetings` | Meeting data accuracy, calendar sync | Microsoft Graph API (Outlook Calendar) |
| `/my-work/email` | Email rendering, send/reply | Microsoft Graph API (Outlook Email) |
| `/my-work/teams` | Teams chat threads, message rendering | Microsoft Graph API (Teams) |
| `/my-work/calendar` | Calendar event display | Microsoft Graph API |
| `/admin/pipedrive` | Deal sync, pipeline mapping | Pipedrive CRM API |
| `/admin/sharepoint-intake` | Document intake flow | SharePoint API |
| `/auth/ms-callback` | Full OAuth flow with real tenant | Microsoft Entra ID |

### 5d. Role-Specific Landing & Access (requires testing with each role)

| Route | What to UAT | Why |
|-------|------------|-----|
| `/` (home) | Each of 16 roles should land on correct page | Role landing logic uses `ROLE_LANDING_PAGE` map + `normalizeRoleForPermissions()`. Must verify each role actually lands where expected AND has permission to view that page. |
| `/company-overview` | Executive KPIs match reality | COO/CEO landing — numbers drive executive decisions. |
| `/execution-board` | Execution status matches reality | PM landing — project status must be current. |
| `/admin/control-center` | System health indicators accurate | Admin landing — health checks must reflect actual system state. |
| `/admin/roles` | Permission matrix produces correct access | Role config changes propagate to all affected routes. |

### 5e. Data Integrity & Lifecycle (requires end-to-end business process)

| Route | What to UAT | Why |
|-------|------------|-----|
| `/pd/tickets/create` → `/pd/tickets/:id` | Ticket creation through full lifecycle | Need to verify: create → draft → in-progress → complete flow. |
| `/pd/handover/:projectId` | PD→PM handover completeness | V2 recently deployed (v1 removed 2026-03-31). Cross-team handover — both PD and PM must verify. |
| `/pm/handover-review` | PM review of PD handover | Counterpart to handover — PM must verify received data. |
| `/project-create` | Project creation wizard | Creates project entity — must verify all required fields, default values, and downstream effects. |
| `/project/:projectName/gate/:stageCode` | Gate progression logic | Stage gates control project advancement. Business rules must be verified. |
| `/admin/smart-import` | Full import cycle: upload → map → resolve → commit | Data goes into production tables. Must verify with real data files. |
| `/admin/database-migration` | Schema migration safety | Must verify on staging with production-like data first. |
| `/commissioning-dashboard/:projectId` | Commissioning checklist completeness | Quality sign-off — must verify against physical commissioning requirements. |
| `/hse` | HSE compliance data accuracy | Regulatory compliance — must verify against actual site safety records. |
| `/quality` | Quality metrics accuracy | Quality system data must match real NCR/inspection records. |

### 5f. Report Accuracy (requires domain expert verification)

| Route | What to UAT | Why |
|-------|------------|-----|
| `/reports/pm/monthly` | PM monthly report data accuracy | Report is exported/shared with stakeholders. Wrong data = wrong narrative. |
| `/reports/engineering/monthly` | Engineering monthly report accuracy | Same concern — shared with management. |
| `/reports/programme` | Programme report accuracy | Aggregated programme data must match individual project data. |
| `/reports/performance` | Performance metrics correctness | KPI calculations must be verified against business definitions. |
| `/reports/center` | Report generation and export | Report center is the hub — all reports must render and export correctly. |
