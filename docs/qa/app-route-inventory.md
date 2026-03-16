# App Route Inventory (Stability Proof Baseline)

Seeded from `client/src/config/page-registry.ts` and route component wiring in `client/src/App.tsx`.
API dependencies are inferred from `/api/...` calls in each page component and should be refined as hooks/services evolve.

| Route | Component/page | Permission entity | Expected main API dependencies | Expected main user actions/buttons | Source |
|---|---|---|---|---|---|
| `/actions/launchpad` | ActionLaunchpadPage | `none` | `/api/eng/tasks`, `/api/pm-otg/projects/`, `/api/projects-summary` | Create, Save, Reject, Export | `actionLaunchpad` |
| `/admin` | — | `admin` | redirect only | Redirect to `/admin/control-center` and validate access control. | `admin` |
| `/admin/activity-log` | SystemActivityLogPage | `activity_log` | `/api/audit/activity-log`, `/api/audit/activity-log/export`, `/api/audit/changeset/` | Create, Export, Import, Filter | `adminActivity` |
| `/admin/control-center` | AdminControlCenterPage | `admin` | `/api/admin/control-center/active-sessions`, `/api/admin/control-center/dangerous/clear-audit-log`, `/api/admin/control-center/dangerous/clear-sessions` | Create, Save, Upload, Export | `adminControlCenter` |
| `/admin/database-migration` | DatabaseMigrationPage | `database_migration` | `/api/admin/migration/archive`, `/api/admin/migration/check-references`, `/api/admin/migration/drop-archived` | Create, Export, Import, Delete | `adminDatabaseMigration` |
| `/admin/import-control-tower` | ImportControlTowerPage | `admin` | `/api/import-control-tower/history`, `/api/import-control-tower/retry/`, `/api/import-control-tower/run` | Upload, Export, Import, Filter | `adminImportControlTower` |
| `/admin/kpi-traceability` | KpiTraceabilityPage | `admin` | `/api/admin/kpi-traceability` | Export, Import, Filter, Search | `adminKpiTraceability` |
| `/admin/legacy-utilities` | AdminPage | `admin` | `/api/admin/clear-all-data`, `/api/admin/folder-config`, `/api/admin/mark-active` | Save, Upload, Export, Import | `adminLegacyUtilities` |
| `/admin/ms-integration` | — | `none` | redirect only | Redirect to `/admin/settings` and validate access control. | `adminMsIntegration` |
| `/admin/ms-mapping` | — | `none` | redirect only | Redirect to `/admin/settings` and validate access control. | `adminMsMapping` |
| `/admin/my-tool-settings` | MyToolAdminSettingsPage | `admin` | `/api/mytool/company-priorities`, `/api/mytool/company-priorities/`, `/api/mytool/settings` | Create, Save, Export, Import | `adminMyTool` |
| `/admin/recovery` | AdminRecoveryPage | `admin` | `/api/admin/recovery/deleted`, `/api/admin/recovery/imports`, `/api/admin/recovery/project/` | Save, Upload, Export, Import | `adminRecovery` |
| `/admin/roles` | AdminRolesPage | `admin_roles` | `/api/admin/control-center/permission-enforcement`, `/api/admin/users`, `/api/admin/users/` | Create, Save, Approve, Export | `adminRoles` |
| `/admin/settings` | RoleSettingsPage | `admin` | `/api/admin/ms-integration`, `/api/admin/ms-integration/`, `/api/admin/users/` | Create, Save, Export, Import | `adminSettings` |
| `/admin/smart-import` | SmartImportPage | `admin` | `/api/import/preview`, `/api/import/commit/`, `/api/import/history` | Upload, Approve, Rollback, Export | `adminSmartImport` |
| `/admin/excel-updates` | AdminExcelUpdatePage | `admin` | `/api/weekly-updates`, `/api/weekly-updates/`, `/api/weekly-updates/by-project/` | Create, Save, Filter, Export | `adminExcelUpdates` |
| `/cashflow` | CashflowPage | `cashflow` | `/api/cashflow-2026`, `/api/cashflow-2026/available-payment`, `/api/cashflow-2026/available-payment-history` | Save, Upload, Export, Import | `cashflow` |
| `/cashflow-forecast` | redirect to `/cashflow` | `none` | redirect only | Redirect to `/cashflow` and validate legacy finance bookmarks still resolve to the canonical tracker. | `cashflowForecastLegacyRedirect` |
| `/clients` | ClientsPage | `pd_clients` | `/api/pd/clients`, `/api/pd/clients/`, `/api/pd/clients/project-counts` | Create, Save, Export, Import | `clients` |
| `/collaboration` | CollaborationPage | `collaboration_hub` | `/api/admin/sp-settings`, `/api/ms-objects/`, `/api/ms-objects/mine` | Create, Save, Approve, Export | `collaboration` |
| `/collaboration/email` | CollabEmailPage | `collaboration_hub` | `/api/ms-objects/mine`, `/api/ms-sync/trigger` | Export, Import, Filter, Search | `collabEmail` |
| `/collaboration/teams` | CollabTeamsPage | `teams_chat` | `/api/chat-groups/mine`, `/api/ms-objects/mine`, `/api/ms-sync/trigger` | Export, Import | `collabTeams` |
| `/command-center` | redirect to `/my-work` | `my_work` | redirect only | Redirect to `/my-work` and verify Command Center is not a live workspace. | `commandCenter` |
| `/company-priorities` | MyToolPrioritiesPage | `company_priorities` | `/api/mytool/company-priorities`, `/api/mytool/company-priorities/`, `/api/mytool/priority-links/` | Create, Save, Export, Import | `companyPriorities` |
| `/cos` | CostTracker | `cos` | `/api/cos-tracker`, `/api/cos-tracker/month-detail`, `/api/cos-tracker/toggle-realised/` | Export, Import, Filter, Search | `cos` |
| `/cos-control` | redirect to `/cos` | `none` | redirect only | Redirect to `/cos` and validate legacy finance bookmarks still resolve to the canonical tracker. | `cosControlLegacyRedirect` |
| `/counterparties` | CounterpartiesPage | `subcontractors` | `/api/counterparties`, `/api/counterparties/`, `/api/subcontractor-dashboard/counterparty/` | Create, Save, Export, Import | `counterparties` |
| `/dashboard` | Dashboard | `execution_board` | `/api/program-dashboard` | Export, Import, Filter, Search | `dashboard` |
| `/department-scores` | DepartmentScoresPage | `department_scores` | `/api/gamification/leaderboard` | Export, Import | `departmentScores` |
| `/ee-info` | EeInfoPage | `ee_info` | `/api/ee-info/os/departments`, `/api/ee-info/os/departments/`, `/api/ee-info/os/lifecycle` | Create, Save, Approve, Reject | `eeInfo` |
| `/engineering` | EngineeringDashboardPage | `engineering` | `/api/eng/dashboard/standup`, `/api/eng/tasks`, `/api/eng/tasks/` | Create, Approve, Export, Import | `engineering` |
| `/engineering/tasks` | EngineeringTasksPage | `eng_tasks` | No direct fetch in page component (uses shared hooks/services). | Export | `engineeringTasks` |
| `/excel-updates` | ExcelUpdatesPage | `excel_updates` | `/api/excel-updates`, `/api/excel-updates/bulk-confirm`, `/api/notifications/` | Create, Export, Import, Filter | `excelUpdates` |
| `/execution-board` | ExecutionBoardPage | `execution_board` | `/api/lifecycle-board/execution-dashboard` | Export, Import, Filter, Search | `executionBoard` |
| `/execution-dashboard` | Alias → `/execution-board` | `execution_board` | redirect only | Navigate alias and confirm redirect to `/execution-board`. | alias of `executionBoard` |
| `/exceptions` | redirect to `/my-work` | `my_work` | redirect only | Redirect to `/my-work` and validate no duplicate exception workspace exists outside My Work. | `exceptions` |
| `/feedback` | FeedbackPage | `feedback` | `/api/feedback`, `/api/feedback/` | Create, Save, Export, Import | `feedback` |
| `/gp-tracker` | GpTrackerPage | `gp_tracker` | `/api/gp-tracker` | Export, Import, Filter, Search | `gpTracker` |
| `/handover-control` | HandoverControlPage | `projects` | `/api/pd-pm-handover/control` | Reject, Export, Import, Filter | `handoverControl` |
| `/invoice-patterns` | InvoicePatternsPage | `invoice_patterns` | `/api/counterparties`, `/api/counterparties/`, `/api/invoice-patterns` | Create, Save, Export, Import | `invoicePatterns` |
| `/knowledge-game` | KnowledgeGamePage | `knowledge_game` | `/api/gamification/leaderboard` | Export, Import | `knowledgeGame` |
| `/leaderboard` | LeaderboardPage | `leaderboard` | `/api/gamification/leaderboard`, `/api/gamification/user/` | Reject, Upload, Export, Import | `leaderboard` |
| `/lifecycle-board` | LifecycleBoardPage | `lifecycle` | `/api/lifecycle-board/projects`, `/api/lifecycle-board/projects/`, `/api/lifecycle-board/projects/link-engineering` | Create, Save, Approve, Export | `lifecycle` |
| `/my-tool` | MyToolTodayPage | `my_tool` | `/api/meetings/webhook-status`, `/api/mytool/company-priorities`, `/api/mytool/company-priorities/` | Create, Save, Export, Import | `myTool` |
| `/my-tool/backlog` | MyToolBacklogPage | `none` | `/api/mytool/tasks`, `/api/mytool/tasks/`, `/api/outlook/email-to-task` | Create, Export, Import, Filter | `myToolBacklog` |
| `/my-tool/help` | MyToolHelpPage | `none` | `/api/mytool/support-ticket` | Create, Save, Export, Import | `myToolHelp` |
| `/my-tool/meetings` | MyToolMeetingsPage | `none` | `/api/meetings`, `/api/meetings/`, `/api/meetings/action-items/` | Create, Save, Export, Import | `myToolMeetings` |
| `/my-tool/settings` | MyToolSettingsPage | `none` | `/api/mytool/dod-templates`, `/api/mytool/dod-templates/`, `/api/mytool/preferences` | Create, Save, Export, Import | `myToolSettings` |
| `/my-tool/week` | MyToolWeekPage | `none` | `/api/mytool/tasks`, `/api/mytool/tasks/`, `/api/outlook/calendar-events` | Create, Export, Import, Filter | `myToolWeek` |
| `/my-work` | MyWorkHomePage | `home` | `/api/ms-objects/mine`, `/api/ms-sync/trigger`, `/api/ms-teams/chats` | Create, Approve, Export, Import | `myWork` |
| `/my-work/approvals` | ApprovalsPage | `my_work` | `/api/approvals/pending`, `/api/deliverables/`, `/api/eng-stages/approvals/` | Create, Approve, Reject, Export | `myWorkApprovals` |
| `/my-work/calendar` | MyWorkCalendarPage | `my_work` | `/api/calendar/schedule-task`, `/api/ms-objects/mine`, `/api/ms-sync/trigger` | Approve, Export, Import, Filter | `myWorkCalendar` |
| `/my-work/email` | CollabEmailPage | `collaboration_hub` | `/api/ms-objects/mine`, `/api/ms-sync/trigger` | Export, Import, Filter, Search | `myWorkEmail` |
| `/my-work/meetings` | MyToolMeetingsPage | `meetings` | `/api/meetings`, `/api/meetings/`, `/api/meetings/action-items/` | Create, Save, Export, Import | `myWorkMeetings` |
| `/my-work/tasks` | MyWorkTasksPage | `my_tool` | `/api/eng/tasks/`, `/api/ms-objects/`, `/api/ms-objects/mine` | Create, Save, Export, Import | `myWorkTasks` |
| `/my-work/teams` | TeamsChatsPage | `teams_chat` | `/api/ms-sync/trigger`, `/api/ms-teams/channels/`, `/api/ms-teams/chats` | Create, Export, Import, Filter | `myWorkTeams` |
| `/pd` | PdDashboardPage | `pd_dashboard` | `/api/pd/dashboard`, `/api/pd/tickets` | Create, Export, Import, Edit | `pdDashboard` |
| `/pd/clients` | Alias → `/clients` | `pd_clients` | redirect only | Navigate alias and confirm redirect to `/clients`. | alias of `clients` |
| `/pd/dashboard` | Alias → `/pd` | `pd_dashboard` | redirect only | Navigate alias and confirm redirect to `/pd`. | alias of `pdDashboard` |
| `/pd/handover/:projectId` | PdPmHandoverPage | `none` | `/api/pd-pm-handover/` | Save, Reject, Upload, Export | `pdPmHandover` |
| `/pd/tickets` | PdTicketsPage | `pd_tickets` | `/api/pd/tickets` | Create, Export, Import, Filter | `pdTickets` |
| `/pd/tickets/:id` | PdTicketDetailPage | `none` | `/api/pd/tickets`, `/api/pd/tickets/`, `/api/projects` | Create, Save, Export, Import | `pdTicketDetail` |
| `/pd/tickets/create` | PdTicketCreatePage | `none` | `/api/pd/clients`, `/api/pd/dashboard`, `/api/pd/projects/search` | Create, Save, Export, Import | `pdTicketCreate` |
| `/pm-dashboard` | PMDashboard | `pm_dashboard` | `/api/pm/calendar-events`, `/api/pm/dashboard`, `/api/pm/priority-items` | Export, Import, Filter, Search | `pmDashboard` |
| `/pm/handover-review` | PmHandoverReviewPage | `none` | `/api/pd-pm-handover/submitted` | Reject, Export, Import | `pmHandoverReview` |
| `/pm/on-the-go` | PMOnTheGoHome | `pm_on_the_go` | `/api/pm-otg/projects` | Export, Import | `pmOnTheGo` |
| `/pm/on-the-go/project/:projectId` | PMOnTheGoProject | `none` | `/api/approvals/general/`, `/api/approvals/pending`, `/api/commissioning/` | Save, Approve, Reject, Upload | `pmOnTheGoProject` |
| `/portfolios` | PortfoliosPage | `portfolios` | `/api/eng/team-members`, `/api/portfolio-dashboard`, `/api/portfolios` | Create, Approve, Reject, Export | `portfolios` |
| `/portfolios/:id` | PortfolioDetailPage | `none` | `/api/eng/team-members`, `/api/portfolios`, `/api/portfolios/` | Create, Save, Approve, Reject | `portfolioDetail` |
| `/project/:projectName` | ProjectDetailPage | `none` | `/api/cashflow`, `/api/eng/tasks`, `/api/eng/tasks/` | Create, Save, Approve, Export | `projectDetail` |
| `/project/:projectName/financial-linking` | FinancialLinkingPage | `none` | `/api/expense-task-links/`, `/api/financial-integration/rules`, `/api/financial-integration/suggested-rules/` | Reject, Export, Import, Filter | `projectFinancialLinking` |
| `/project-lifecycle` | ProjectLifecyclePage | `projects` | `/api/project-lifecycle/workspace`, `/api/pd-pm-handover/control`, `/api/project-events/project/` | Filter, Search, Open project, Review lifecycle state | `projectLifecycle` |
| `/project-lifecycle/client-overview` | ProjectLifecyclePage | `pd_clients` | `/api/project-lifecycle/workspace`, `/api/pd/clients`, `/api/project-events/project/` | Filter, Search, Review client-linked lifecycle state | `projectLifecycleClientOverview` |
| `/project-lifecycle/latest-updates` | ProjectLifecyclePage | `projects` | `/api/project-lifecycle/workspace`, `/api/projects-summary`, `/api/project-events/project/` | Filter, Search, Review canonical latest updates | `projectLifecycleLatestUpdates` |
| `/project-lifecycle/stage-gates` | ProjectLifecyclePage | `lifecycle` | `/api/project-lifecycle/workspace`, `/api/lifecycle-board/projects`, `/api/project-events/project/` | Filter, Search, Review stage gates | `projectLifecycleStageGates` |
| `/projects` | ProjectsSummary | `projects` | `/api/export/projects-summary`, `/api/financial-close/files/`, `/api/financial-close/upload` | Save, Reject, Upload, Export | `projects` |
| `/pm/approvals` | ApprovalsPage | `approvals` | `/api/approvals/pending`, `/api/deliverables/`, `/api/eng-stages/approvals/` | Approve, Reject, Open project, Filter | `pmApprovals` |
| `/pm/deliverables` | PMDeliverablesPage | `deliverables` | `/api/projects-summary`, `/api/deliverable-capture/list/`, `/api/ms-objects/project/` | Capture Deliverable, Download, Open approvals, Open project | `pmDeliverables` |
| `/quality` | QmDashboardPage | `quality` | `/api/projects-summary`, `/api/quality/all-items`, `/api/quality/checklists` | Create, Approve, Export, Import | `quality` |
| `/revenue` | redirect to `/revenue-tracker` | `none` | redirect only | Redirect to `/revenue-tracker` and validate legacy finance bookmarks still resolve to the canonical tracker. | `revenue` |
| `/revenue-tracker` | RevenueTrackerPage | `revenue_tracker` | `/api/revenue-tracker`, `/api/revenue-tracker/month-detail`, `/api/tracker-monthly` | Export, Import, Filter, Search | `revenueTracker` |
| `/settings/integrations` | — | `none` | redirect only | Redirect to `/admin/settings` and validate access control. | `settingsIntegrations` |
| `/smart-import` | SmartImportPage | `smart_import` | `/api/counterparties`, `/api/smart-import/`, `/api/smart-import/pending-runs` | Create, Save, Approve, Upload | `smartImport` |
| `/subcontractor-dashboard` | SubcontractorDashboardPage | `subcontractors` | `/api/invoice-patterns`, `/api/procurement-analysis/pattern-stats`, `/api/subcontractor-dashboard/counterparty/` | Create, Save, Approve, Export | `subcontractor` |
| `/teams/chats` | TeamsChatsPage | `teams_chat` | `/api/ms-sync/trigger`, `/api/ms-teams/channels/`, `/api/ms-teams/chats` | Create, Export, Import, Filter | `teamsChats` |
| `/tr-register` | — | `none` | redirect only | Redirect to `/my-work/tasks` and validate access control. | `trRegister` |
| `/training` | TrainingPage | `training` | No direct fetch in page component (uses shared hooks/services). | Save, Export, Import, Filter | `training` |
| `/weekly-reviews` | WeeklyReviewsPage | `weekly_review_wizard` | `/api/weekly-reviews-all` | Create, Export, Import, Filter | `weeklyReviews` |
