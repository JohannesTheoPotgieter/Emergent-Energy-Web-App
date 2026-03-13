# App Route / View / Action Inventory

Seeded from `client/src/config/page-registry.ts` and `client/src/App.tsx` route wiring. This is the baseline QA route manifest for smoke + role checks.

## Inventory

| Route | Page/component | Permission entity | Major API dependencies (inferred) | Main user actions/buttons expected |
|---|---|---|---|---|
| `/` | `Home` | `home` (via path resolver) | `/api/home/action-hub`, `/api/home/company-priorities` | Open action hub cards, navigate to role landing modules |
| `/dashboard` | `Dashboard` | `execution_board` | `/api/overview`, `/api/projects-summary` | Filter board, open project tile, drill into execution detail |
| `/projects` | `ProjectsSummary` | `projects` | `/api/projects-summary` | Search/filter projects, open project detail |
| `/project/:projectName` | `ProjectDetailPage` | `projects` (resolved) | `/api/project/:name/info`, `/api/project/:name/plan`, `/api/project/:name/expenses`, `/api/project/:name/inflows` | Edit/inspect tabs, save overrides, open linked finance views |
| `/project/:projectName/financial-linking` | `FinancialLinkingPage` | none explicit | financial linking endpoints + project data APIs | Link/unlink finance lines, confirm mappings |
| `/cashflow` | `CashflowPage` | `cashflow` | `/api/cashflow-2026`, `/api/cashflow-2026/detail` | Change filters, inspect weekly values, export/refresh |
| `/cos` | `CostTracker` | `cos` | `/api/program/cos` | Filter categories, inspect cost line states |
| `/revenue-tracker` | `RevenueTrackerPage` | `revenue_tracker` | revenue tracker endpoints + project finance reads | Filter milestones, inspect invoice/payment states |
| `/gp-tracker` | `GpTrackerPage` | `gp_tracker` | KPI/finance rollup APIs | Compare margin values, drill to project rows |
| `/quality` | `QmDashboardPage` | `quality` | `/api/quality/dashboard`, `/api/quality/templates`, `/api/quality/checklists` | Open checklist, review warnings, capture evidence |
| `/engineering` | `EngineeringDashboardPage` | `engineering` | `/api/engineering/dashboard`, `/api/eng/standup` | Review standup metrics, open tasks |
| `/engineering/tasks` | `EngineeringTasksPage` | `eng_tasks` | `/api/eng/tasks`, `/api/eng/tasks/:id` | Update task status, assign owner, open details/comments |
| `/lifecycle-board` | `LifecycleBoardPage` | `lifecycle` | `/api/lifecycle-board/projects` | Move stage, review lifecycle blockers |
| `/execution-board` | `ExecutionBoardPage` | `execution_board` | execution board/project workflow APIs | Update execution state, open task/work item actions |
| `/smart-import` | `SmartImportPage` | `smart_import` | `/api/smart-import/upload`, `/api/smart-import/:runId`, `/api/smart-import/:runId/commit` | Upload file, resolve issues, commit run |
| `/invoice-patterns` | `InvoicePatternsPage` | `invoice_patterns` | invoice pattern APIs | Create/edit patterns, validate match rules |
| `/subcontractor-dashboard` | `SubcontractorDashboardPage` | `subcontractors` | subcontractor summary/detail APIs | Filter supplier view, inspect commitment pipeline |
| `/weekly-reviews` | `WeeklyReviewsPage` | `weekly_reviews` | weekly review APIs | Create review, close checklist items |
| `/feedback` | `FeedbackPage` | `feedback` | feedback endpoints | Submit feedback, triage status |
| `/teams/chats` | `TeamsChatsPage` | `teams_chat` | Teams integration/chat APIs | Open threads, post/update notes |
| `/collaboration` | `CollaborationPage` | `collaboration_hub` | collaboration hub APIs | Navigate to email/teams workspaces |
| `/my-work` | `MyWorkHomePage` | `home` | `/api/home/action-hub`, my-work task APIs | Open daily focus widgets, launch quick actions |
| `/my-work/tasks` | `MyWorkTasksPage` | `my_tool` | task APIs (`/api/mytool/*`, `/api/eng/tasks`) | Update personal tasks, reprioritize items |
| `/my-work/calendar` | `MyWorkCalendarPage` | `my_work` | `/api/pm/calendar-events`, outlook/calendar integrations | View schedule, open day details |
| `/my-work/approvals` | `ApprovalsPage` | `my_work` | approval workflow APIs | Approve/reject requests, leave notes |
| `/pm-dashboard` | `PMDashboard` | `pm_dashboard` | `/api/pm/dashboard`, `/api/pm/priority-items`, `/api/pm/calendar-events` | Review project health, open priority items |
| `/pm/on-the-go` | `PMOnTheGoHome` | `pm_on_the_go` | on-the-go APIs | Quick capture/update/escalate workflows |
| `/clients` | `ClientsPage` | `pd_clients` | `/api/pd/clients` | Create/edit client, link to tickets/projects |
| `/pd/tickets` | `PdTicketsPage` | `pd_tickets` | `/api/pd/tickets` | Create ticket, update stage/status |
| `/admin/control-center` | `AdminControlCenterPage` | `admin` | admin control endpoints, auth/role APIs | Manage settings, trigger admin actions |
| `/admin/roles` | `AdminRolesPage` | `admin` | `/api/roles`, `/api/admin/users`, `/api/admin/users/:userId/role` | Edit permissions, assign user roles |
| `/admin/activity-log` | `SystemActivityLogPage` | `admin` | `/api/audit/activity-log` | Filter/export logs, inspect actor history |
| `/admin/recovery` | `AdminRecoveryPage` | `admin` | recovery/admin APIs | Run recovery flow, validate safeguards |
| `/admin/database-migration` | `DatabaseMigrationPage` | `database_migration` | migration/admin endpoints | Execute migration tasks, verify status |
| `/admin/kpi-traceability` | `KpiTraceabilityPage` | `admin` | KPI traceability APIs | Inspect KPI lineage, reconcile mismatches |
| `/admin/import-control-tower` | `ImportControlTowerPage` | `admin` | smart import governance APIs | Review runs, resolve blocked imports |

## Notes

- Redirect and alias paths (for example `/execution-dashboard`, `/settings/integrations`, `/pd/clients`) should be included in smoke coverage as navigation checks even when they do not render a distinct component.
- Dynamic routes (`:projectName`, `:projectId`) require fixture-driven smoke data for deterministic QA runs.
