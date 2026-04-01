import type { PermissionEntity } from "@shared/schema";

export interface PageRegistryEntry {
  id: string;
  path: string;
  label: string;
  /** 'page' = renders a component; 'alias' = redirects to another path */
  type?: "page" | "alias";
  iconKey?: string;
  navGroup?: string;
  permissionEntity?: PermissionEntity;
  showInSidebar?: boolean;
  routeComponentKey?: string;
  redirectTo?: string;
  aliases?: string[];
  roleLandingEligibility?: string[];
  matchSubRoutes?: boolean;
}

/**
 * Legacy redirects — old bookmarks / deep links that redirect to canonical paths.
 * Kept separate from PAGE_REGISTRY so they don't pollute command palette or sidebar.
 */
export const LEGACY_REDIRECTS: Array<{ path: string; redirectTo: string }> = [
  // Legacy: /dashboard → /execution-board → /gates. Collapsed to direct.
  { path: "/dashboard", redirectTo: "/gates" },
  // Legacy: /pm-dashboard → /execution-board → /gates. Collapsed to direct.
  { path: "/pm-dashboard", redirectTo: "/gates" },
  { path: "/revenue", redirectTo: "/revenue-tracker" },
  { path: "/my-tool", redirectTo: "/" },
  { path: "/my-tool/week", redirectTo: "/my-work/calendar" },
  { path: "/my-tool/backlog", redirectTo: "/my-work/tasks" },
  { path: "/my-tool/settings", redirectTo: "/my-work/settings" },
  { path: "/my-tool/help", redirectTo: "/" },
  { path: "/my-tool/meetings", redirectTo: "/my-work/meetings" },
  { path: "/company-priorities", redirectTo: "/priorities" },
  { path: "/admin", redirectTo: "/admin/control-center" },
  { path: "/admin/legacy-utilities", redirectTo: "/admin/control-center" },
  // Prompt 2 — old nav destinations that moved
  { path: "/exceptions", redirectTo: "/gates/exceptions" },
];

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  { id: "companyOverview", path: "/company-overview", label: "Company Overview", iconKey: "Activity", navGroup: "HOME", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "CompanyOverviewPage", roleLandingEligibility: ["COO_ADMIN", "CEO_ADMIN"] },
  { id: "projectLifecycle", path: "/project-lifecycle", label: "Project Lifecycle", iconKey: "Layers", navGroup: "PROJECTS", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleStageGates", path: "/project-lifecycle/stage-gates", label: "Stage Gates", permissionEntity: "lifecycle", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleLatestUpdates", path: "/project-lifecycle/latest-updates", label: "Latest Updates", permissionEntity: "projects", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleClientOverview", path: "/project-lifecycle/client-overview", label: "Client Overview", permissionEntity: "pd_clients", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projects", path: "/projects", label: "Project List", iconKey: "FileSpreadsheet", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "projects", showInSidebar: true, routeComponentKey: "ProjectsSummary" },
  { id: "projectFinancialLinking", path: "/project/:projectName/financial-linking", label: "Financial Linking", routeComponentKey: "FinancialLinkingPage" },
  { id: "projectDetail", path: "/project/:projectName", label: "Project Detail", routeComponentKey: "ProjectDetailPage" },
  { id: "cashflow", path: "/cashflow", label: "Cashflow", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "cashflow", showInSidebar: true, routeComponentKey: "CashflowPage", roleLandingEligibility: ["CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"] },
  { id: "cos", path: "/cos", label: "COS", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: true, routeComponentKey: "CostTracker" },
  { id: "revenueTracker", path: "/revenue-tracker", label: "Revenue", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: true, routeComponentKey: "RevenueTrackerPage" },
  { id: "gpTracker", path: "/gp-tracker", label: "GP Tracker", iconKey: "Activity", navGroup: "FINANCE", permissionEntity: "gp_tracker", showInSidebar: true, routeComponentKey: "GpTrackerPage" },
  { id: "priorities", path: "/priorities", label: "Priorities", iconKey: "Flag", navGroup: "EXCO", permissionEntity: "company_priorities", showInSidebar: true, routeComponentKey: "PrioritiesPage" },
  { id: "priorityDetail", path: "/priorities/:id", label: "Priority Detail", permissionEntity: "company_priorities", routeComponentKey: "PriorityDetailPage" },
  { id: "adminMyTool", path: "/admin/my-tool-settings", label: "My Work Settings", permissionEntity: "admin", routeComponentKey: "MyWorkAdminSettingsPage" },
  { id: "sharepointIntake", path: "/admin/sharepoint-intake", label: "SharePoint Intake", iconKey: "Cloud", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "SharePointIntakePage" },
  { id: "quality", path: "/quality", label: "Quality", iconKey: "ShieldCheck", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QmDashboardPage", roleLandingEligibility: ["QUALITY_MANAGER"] },
  { id: "qualityDashboardV2", path: "/quality/dashboard", label: "Quality Dashboard (Project)", type: "alias", permissionEntity: "quality", redirectTo: "/quality" },
  { id: "qualityNcrList", path: "/quality/ncrs", label: "NCR List", iconKey: "ListTodo", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "NcrListPage" },
  { id: "qualityNcrDetail", path: "/quality/ncr/:id", label: "NCR Detail", permissionEntity: "quality", showInSidebar: false, routeComponentKey: "NcrDetailPage" },
  { id: "engineering", path: "/engineering", label: "Engineering", iconKey: "Wrench", navGroup: "ENGINEERING", permissionEntity: "engineering", showInSidebar: true, routeComponentKey: "EngineeringDashboardPage", roleLandingEligibility: ["ENGINEERING_MANAGER", "ENGINEER"] },
  { id: "engineeringTasks", path: "/engineering/tasks", label: "Task Board", iconKey: "ListTodo", navGroup: "ENGINEERING", permissionEntity: "eng_tasks", showInSidebar: true, routeComponentKey: "EngineeringTasksPage" },
  { id: "engineeringStandup", path: "/engineering/standup", label: "Engineering Standup", iconKey: "Users", navGroup: "ENGINEERING", permissionEntity: "standups", showInSidebar: true, routeComponentKey: "EngineeringStandupPage" },
  { id: "engineeringAudit", path: "/engineering/audit", label: "Engineering Audit Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngineeringAuditPage" },
  { id: "lifecycle", path: "/lifecycle-board", label: "Lifecycle Board", iconKey: "Layers", navGroup: "PORTFOLIO", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "LifecycleBoardPage" },
  { id: "executionBoard", path: "/execution-board", label: "Execution Board", iconKey: "LayoutDashboard", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "ExecutionBoardPage", aliases: ["/execution-dashboard"], roleLandingEligibility: ["PROJECT_MANAGER_SITE", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"], matchSubRoutes: true },
  { id: "executionBoardProgram", path: "/execution-board/program", label: "Program View", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "executionBoardConstruction", path: "/execution-board/construction", label: "Construction View", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "executionBoardFinance", path: "/execution-board/finance", label: "Program Finance", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "smartImport", path: "/admin/smart-import", label: "Smart Import", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "smart_import", showInSidebar: false, routeComponentKey: "SmartImportPage" },
  { id: "invoicePatterns", path: "/invoice-patterns", label: "Invoice Patterns", iconKey: "FileSpreadsheet", navGroup: "FINANCE", permissionEntity: "invoice_patterns", showInSidebar: true, routeComponentKey: "InvoicePatternsPage" },
  { id: "counterparties", path: "/counterparties", label: "Counterparties", iconKey: "Building2", navGroup: "FINANCE", permissionEntity: "counterparties", showInSidebar: true, routeComponentKey: "CounterpartiesPage" },
  { id: "subcontractor", path: "/subcontractor-dashboard", label: "Subcontractors", iconKey: "Users", navGroup: "FINANCE", permissionEntity: "subcontractors", showInSidebar: true, routeComponentKey: "SubcontractorDashboardPage" },
  { id: "adminActivity", path: "/admin/activity-log", label: "Activity Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "activity_log", showInSidebar: false, routeComponentKey: "SystemActivityLogPage" },
  { id: "weeklyReviews", path: "/weekly-reviews", label: "Weekly Reviews", iconKey: "CalendarCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "weekly_review_wizard", showInSidebar: true, routeComponentKey: "WeeklyReviewsPage" },
  { id: "adminRoles", path: "/admin/roles", label: "Users & Roles", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: false, routeComponentKey: "AdminRolesPage" },
  { id: "leaderboard", path: "/leaderboard", label: "Leaderboard", iconKey: "Trophy", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: false, routeComponentKey: "LeaderboardPage" },
  { id: "feedback", path: "/feedback", label: "Feedback & Support", iconKey: "MessageSquareText", navGroup: "KNOWLEDGE", permissionEntity: "feedback", showInSidebar: true, routeComponentKey: "FeedbackPage" },
  { id: "eeInfo", path: "/ee-info", label: "Processes & SOPs", iconKey: "Leaf", navGroup: "KNOWLEDGE", permissionEntity: "ee_info", showInSidebar: true, routeComponentKey: "EeInfoPage" },
  { id: "training", path: "/training", label: "Training", iconKey: "GraduationCap", navGroup: "KNOWLEDGE", permissionEntity: "training", showInSidebar: true, routeComponentKey: "TrainingPage" },
  { id: "portfolios", path: "/portfolios", label: "Portfolios", iconKey: "FolderOpen", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "portfolios", showInSidebar: true, routeComponentKey: "PortfoliosPage" },
  { id: "portfolioDetail", path: "/portfolios/:id", label: "Portfolio Detail", routeComponentKey: "PortfolioDetailPage" },
  { id: "pdDashboard", path: "/pd", label: "Project Development", iconKey: "Sun", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: true, routeComponentKey: "PdDashboardPage", aliases: ["/pd/dashboard"], roleLandingEligibility: ["CCO", "KEY_ACCOUNTS_MANAGER", "PROJECT_DEVELOPER"] },
  { id: "pdTickets", path: "/pd/tickets", label: "PD Tickets", iconKey: "ClipboardList", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_tickets", showInSidebar: true, routeComponentKey: "PdTicketsPage" },
  { id: "pdTicketCreate", path: "/pd/tickets/create", label: "Create PD Ticket", routeComponentKey: "PdTicketCreatePage" },
  { id: "pdTicketDetail", path: "/pd/tickets/:id", label: "PD Ticket Detail", routeComponentKey: "PdTicketDetailPage" },
  { id: "pdReports", path: "/pd/reports", label: "PD Reports", iconKey: "BarChart3", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: true, routeComponentKey: "PdReportsPage" },
  { id: "teamsChats", path: "/teams/chats", label: "Teams Chat", type: "alias", permissionEntity: "teams_chat", redirectTo: "/my-work/teams" },
  { id: "collaboration", path: "/collaboration", label: "Collaboration Hub", type: "alias", permissionEntity: "collaboration_hub", redirectTo: "/my-work" },
  { id: "collabEmail", path: "/collaboration/email", label: "Collaboration Email", type: "alias", permissionEntity: "collaboration_hub", redirectTo: "/my-work/email" },
  { id: "collabTeams", path: "/collaboration/teams", label: "Collaboration Teams", type: "alias", permissionEntity: "teams_chat", redirectTo: "/my-work/teams" },
  { id: "pmOnTheGo", path: "/pm/on-the-go", label: "Mobile View", iconKey: "Smartphone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_on_the_go", showInSidebar: true, routeComponentKey: "PMOnTheGoHome" },
  { id: "pmOnTheGoProject", path: "/pm/on-the-go/project/:projectId", label: "On-The-Go Project", routeComponentKey: "PMOnTheGoProject" },
  { id: "myWork", path: "/my-work", label: "My Work", iconKey: "Home", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "MyWorkHomePage", matchSubRoutes: true },
  { id: "inbox", path: "/inbox", label: "Inbox", iconKey: "Inbox", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "InboxPage" },
  { id: "myWorkCalendar", path: "/my-work/calendar", label: "Calendar", iconKey: "CalendarCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, routeComponentKey: "MyWorkCalendarPage" },
  { id: "myWorkTasks", path: "/my-work/tasks", label: "Tasks", iconKey: "ListChecks", navGroup: "MY_WORK", permissionEntity: "my_tool", showInSidebar: true, routeComponentKey: "MyWorkTasksPage" },
  { id: "myWorkApprovals", path: "/my-work/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "MY_WORK", type: "alias", permissionEntity: "my_work", showInSidebar: true, redirectTo: "/my-work/tasks?source=approvals" },
  { id: "myWorkMeetings", path: "/my-work/meetings", label: "Meetings", iconKey: "MessageSquareText", navGroup: "MY_WORK", permissionEntity: "meetings", showInSidebar: true, routeComponentKey: "MyWorkMeetingsPage" },
  { id: "myWorkEmail", path: "/my-work/email", label: "Email", iconKey: "Mail", navGroup: "MY_WORK", permissionEntity: "collaboration_hub", showInSidebar: true, routeComponentKey: "CollabEmailPage" },
  { id: "myWorkTeams", path: "/my-work/teams", label: "Teams Chat", iconKey: "MessagesSquare", navGroup: "MY_WORK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "myWorkSettings", path: "/my-work/settings", label: "Settings", iconKey: "Settings", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "MyWorkSettingsPage" },
  { id: "adminDatabaseMigration", path: "/admin/database-migration", label: "Database Migration", permissionEntity: "database_migration", routeComponentKey: "DatabaseMigrationPage" },
  { id: "adminKpiTraceability", path: "/admin/kpi-traceability", label: "KPI Traceability", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "KpiTraceabilityPage" },
  { id: "adminImportControlTower", path: "/admin/import-control-tower", label: "Import Control Tower", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "ImportControlTowerPage" },
  { id: "programmeReports", path: "/reports/programme", label: "Programme Reports", iconKey: "FileSpreadsheet", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "ProgrammeReportsPage" },
  { id: "reportCenter", path: "/reports/center", label: "Report Center", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "ReportCenterPage" },
  { id: "performanceDashboard", path: "/reports/performance", label: "Performance", iconKey: "BarChart3", navGroup: "REPORTS", permissionEntity: "performance", showInSidebar: true, routeComponentKey: "PerformancePage" },
  { id: "pmMonthlyReport", path: "/reports/pm/monthly", label: "PM Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "PmMonthlyReportPage" },
  { id: "pmMonthlyReportHistory", path: "/reports/pm/monthly/history", label: "PM Report History", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportHistoryPage" },
  { id: "pmMonthlyReportCompare", path: "/reports/pm/monthly/compare", label: "PM Report Compare", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportComparePage" },
  { id: "pmMonthlyReportProject", path: "/reports/pm/monthly/:month/project/:projectId", label: "PM Report Project", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportProjectPage" },
  { id: "engMonthlyReport", path: "/reports/engineering/monthly", label: "Engineering Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "EngMonthlyReportPage" },
  { id: "engMonthlyReportHistory", path: "/reports/engineering/monthly/history", label: "Engineering Report History", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportHistoryPage" },
  { id: "engMonthlyReportCompare", path: "/reports/engineering/monthly/compare", label: "Engineering Report Compare", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportComparePage" },
  { id: "engMonthlyReportProject", path: "/reports/engineering/monthly/:month/project/:projectId", label: "Engineering Report Project", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportProjectPage" },
  { id: "adminRecovery", path: "/admin/recovery", label: "Recovery Center", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminRecoveryPage" },
  { id: "stageAdmin", path: "/admin/stage-lifecycle", label: "Stage Lifecycle", iconKey: "Milestone", navGroup: "SYSTEM", permissionEntity: "stage_admin", showInSidebar: false, routeComponentKey: "StageAdminPage" },
  { id: "adminControlCenter", path: "/admin/control-center", label: "Control Center", iconKey: "Gauge", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminControlCenterPage" },
  { id: "clientProjectDepartments", path: "/clients/:clientId/project/:projectId", label: "Project Departments", permissionEntity: "pd_clients", routeComponentKey: "ClientProjectDepartmentsPage" },
  { id: "clientDetail", path: "/clients/:clientId", label: "Client Detail", permissionEntity: "pd_clients", routeComponentKey: "ClientDetailPage" },
  { id: "clients", path: "/clients", label: "Clients", iconKey: "Users", navGroup: "PROJECTS", permissionEntity: "pd_clients", showInSidebar: true, routeComponentKey: "ClientsPage", aliases: ["/pd/clients"] },
  { id: "actionLaunchpad", path: "/actions/launchpad", label: "Quick Create", routeComponentKey: "ActionLaunchpadPage" },
  // Active version: pd-pm-handover-v2.tsx. v1 removed 2026-03-31.
  { id: "pdPmHandover", path: "/pd/handover/:projectId", label: "PD to PM Handover", permissionEntity: "handover", routeComponentKey: "PdPmHandoverPage" },
  { id: "pmHandoverReview", path: "/pm/handover-review", label: "PM Handover Review", permissionEntity: "handover", routeComponentKey: "PmHandoverReviewPage" },
  { id: "financialReviewQueue", path: "/governance/financial-reviews", label: "Financial Review Queue", iconKey: "DollarSign", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "approvals", showInSidebar: true, routeComponentKey: "FinancialReviewQueuePage" },
  { id: "pmApprovals", path: "/pm/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "approvals", showInSidebar: true, routeComponentKey: "ApprovalsPage" },
  { id: "pmDeliverables", path: "/pm/deliverables", label: "Deliverables", iconKey: "Package", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "deliverables", showInSidebar: true, routeComponentKey: "PMDeliverablesPage" },
  { id: "handoverControl", path: "/handover-control", label: "PD to PM Handover", iconKey: "Handshake", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "handover", showInSidebar: true, routeComponentKey: "HandoverControlPage" },
  // Task Management removed from Project Delivery navigation
  { id: "standups", path: "/standups", label: "Standups", iconKey: "Users", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "standups", showInSidebar: true, routeComponentKey: "StandupsPage" },
  { id: "fyeRevenueTracking", path: "/fye-revenue-tracking", label: "FYE Revenue Tracking", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "fye_revenue_tracking", showInSidebar: true, routeComponentKey: "FyeRevenueTrackingPage" },
  { id: "phaseTemplates", path: "/admin/phase-templates", label: "Phase Templates", iconKey: "ListChecks", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "PhaseTemplatesPage" },
  { id: "projectCreate", path: "/project-create", label: "Create Project", permissionEntity: "project_creation", routeComponentKey: "ProjectCreatePage" },
  { id: "departmentScores", path: "/department-scores", label: "Department Scores", iconKey: "BarChart3", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: false, routeComponentKey: "DepartmentScoresPage" },
  { id: "engTemplateAdmin", path: "/admin/eng-templates", label: "Engineering Templates", iconKey: "FileText", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngTemplateAdminPage" },
  { id: "exceptions", path: "/exceptions", label: "Exceptions", iconKey: "ShieldAlert", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "ExceptionsPage" },
  // New entity pages (Phase B)
  { id: "sites", path: "/sites", label: "Sites", iconKey: "MapPin", navGroup: "PROJECTS", permissionEntity: "projects", showInSidebar: true, routeComponentKey: "SitesPage" },
  { id: "opportunities", path: "/opportunities", label: "Opportunities", iconKey: "Sun", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: true, routeComponentKey: "OpportunitiesPage" },
  // New module pages (Phase C)
  { id: "constructionDashboard", path: "/construction", label: "Construction", iconKey: "HardHat", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "ConstructionDashboardPage" },
  { id: "procurementDashboard", path: "/procurement", label: "Procurement", iconKey: "Package", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "procurement", showInSidebar: true, routeComponentKey: "ProcurementDashboardPage" },
  // EPC Workflow Phase 1
  { id: "poApprovalBoard", path: "/po-approval-board", label: "PO Approvals", iconKey: "FileText", navGroup: "FINANCE", permissionEntity: "procurement", showInSidebar: true, routeComponentKey: "POApprovalBoardPage" },
  { id: "paymentRequestBoard", path: "/payment-request-board", label: "Payment Requests", iconKey: "CreditCard", navGroup: "FINANCE", permissionEntity: "procurement", showInSidebar: true, routeComponentKey: "PaymentRequestBoardPage" },
  { id: "paymentBatchManager", path: "/payment-batch-manager", label: "Payment Batches", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "procurement", showInSidebar: true, routeComponentKey: "PaymentBatchManagerPage" },
  { id: "hseDashboard", path: "/hse", label: "Health, Safety & Environment", iconKey: "ShieldAlert", navGroup: "HSE", permissionEntity: "hse", showInSidebar: true, routeComponentKey: "HseDashboardPage", roleLandingEligibility: ["HSE_MANAGER", "SSEG_MANAGER"] },
  { id: "handoverDashboard", path: "/handover", label: "Handover & Closeout", iconKey: "Handshake", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "handover", showInSidebar: true, routeComponentKey: "HandoverDashboardPage" },
  // PD-PM Handover V2 extensions
  { id: "lessonsLearnt", path: "/admin/lessons", label: "Lessons Learnt", iconKey: "BookOpen", navGroup: "SYSTEM", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "LessonsLearntPage" },
  { id: "handoverHealth", path: "/admin/handover-health", label: "Handover Health Score", iconKey: "Handshake", navGroup: "SYSTEM", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "HandoverControlPage" },
  // Admin integration pages (Phase D)
  { id: "adminWorkflowConfig", path: "/admin/workflow-config", label: "Workflow Configuration", iconKey: "Workflow", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminWorkflowConfigPage" },
  { id: "adminBackfill", path: "/admin/data-migration-status", label: "Data Migration Status", iconKey: "Database", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminBackfillPage" },
  { id: "adminPipedrive", path: "/admin/pipedrive", label: "Pipedrive Integration", iconKey: "Plug", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminPipedrivePage" },
  // Gates workspace (Prompt 2)
  { id: "gatesPipeline", path: "/gates", label: "Gates Pipeline", iconKey: "Milestone", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesPipelinePage" },
  { id: "gatesBlocked", path: "/gates/blocked", label: "Blocked Gates", iconKey: "ShieldAlert", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesBlockedPage" },
  { id: "gatesReady", path: "/gates/ready", label: "Ready Gates", iconKey: "CheckCircle", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesReadyPage" },
  { id: "gatesExceptions", path: "/gates/exceptions", label: "Gate Exceptions", iconKey: "AlertTriangle", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesExceptionsPage" },
  { id: "gatesClientUpdates", path: "/gates/client-updates", label: "Client Updates", iconKey: "CalendarCheck", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesClientUpdatesPage" },
  { id: "gatesHandovers", path: "/gates/handovers", label: "Handover Queue", iconKey: "Handshake", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesHandoversPage" },
  { id: "gatesQueries", path: "/gates/queries", label: "Open Queries", iconKey: "MessageSquare", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesQueriesPage" },
  { id: "gatesCommitments", path: "/gates/commitments", label: "Client Commitments", iconKey: "Handshake", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "GatesCommitmentsPage" },
  // Milestone Tracker — standalone page for Construction Manager
  { id: "milestoneTracker", path: "/milestone-tracker", label: "Milestone Tracker", iconKey: "Milestone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "MilestoneTrackerPage" },
  // Commissioning Control Tower — workbook-driven dashboard (project-scoped)
  { id: "commissioningDashboard", path: "/commissioning-dashboard/:projectId", label: "Commissioning Dashboard", permissionEntity: "commissioning", showInSidebar: false, routeComponentKey: "CommissioningDashboardPage" },
];

export const ROLE_LANDING_PAGE: Record<string, string> = PAGE_REGISTRY
  .filter((page) => page.roleLandingEligibility?.length)
  .reduce((acc, page) => {
    page.roleLandingEligibility?.forEach((role) => {
      acc[role] = page.path;
    });
    return acc;
  }, {} as Record<string, string>);

export function findPageByPath(pathname: string): PageRegistryEntry | undefined {
  const exact = PAGE_REGISTRY.find((page) => page.path === pathname || page.aliases?.includes(pathname));
  if (exact) return exact;

  const sorted = [...PAGE_REGISTRY].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((page) => page.matchSubRoutes && (pathname === page.path || pathname.startsWith(`${page.path}/`)));
}

export function getPermissionEntityForPath(pathname: string): PermissionEntity | undefined {
  const sorted = [...PAGE_REGISTRY]
    .filter((page) => !!page.permissionEntity && !page.path.includes(":"))
    .sort((a, b) => b.path.length - a.path.length);

  const match = sorted.find((page) => pathname === page.path || pathname.startsWith(`${page.path}/`));
  return match?.permissionEntity;
}

/**
 * Maps well-known top-level navigation paths to their APP_SECTION key.
 * Uses the navGroup field from PAGE_REGISTRY entries.
 *
 * This is the bridge between the navigation path and the section toggles
 * configured on each role in Admin → Roles & Permissions → Navigation.
 */
/**
 * Maps navGroup from PAGE_REGISTRY entries to the 10-section keys.
 * Used by getAppSectionForPath to gate nav visibility via role_permissions.sections.
 */
const NAV_GROUP_TO_SECTION: Record<string, string> = {
  MY_WORK: "HOME",
  EXCO: "HOME",
  PROJECTS: "PROJECT_DELIVERY",
  PROJECT_DEVELOPMENT: "PROJECT_DEVELOPMENT",
  PROJECT_MANAGEMENT: "PROJECT_DELIVERY",
  ENGINEERING: "ENGINEERING",
  QUALITY: "QUALITY",
  HSE: "HSE",
  GATES: "PORTFOLIO",
  FINANCE: "FINANCE",
  KNOWLEDGE: "ADMIN",
  FEEDBACK: "ADMIN",
  PORTFOLIO: "PORTFOLIO",
  REPORTS: "REPORTS",
  SYSTEM: "ADMIN",
};

// Backward compatibility for older tests/modules.
export const PAGES = PAGE_REGISTRY;

export function getAppSectionForPath(pathname: string): string | undefined {
  if (pathname === "/") {
    return "HOME";
  }
  if (pathname === "/my-work" || pathname.startsWith("/my-work/") || pathname === "/inbox") {
    return "HOME";
  }
  // Milestone Tracker lives under Project Delivery
  if (pathname === "/gates/commitments" || pathname === "/milestone-tracker" || pathname.startsWith("/milestone-tracker/")) {
    return "PROJECT_DELIVERY";
  }
  // Portfolio Dashboard lives under Project Delivery
  if (pathname === "/portfolios" || pathname.startsWith("/portfolios/")) {
    return "PROJECT_DELIVERY";
  }
  // Weekly Reviews lives under Project Delivery
  if (pathname === "/weekly-reviews" || pathname.startsWith("/weekly-reviews/")) {
    return "PROJECT_DELIVERY";
  }
  // Gates live under Portfolio
  if (pathname === "/gates" || pathname.startsWith("/gates/")) {
    return "PORTFOLIO";
  }
  // Quality (separate from HSE)
  if (pathname === "/quality" || pathname.startsWith("/quality/")) {
    return "QUALITY";
  }
  // HSE (separate from Quality)
  if (pathname === "/hse" || pathname.startsWith("/hse/")) {
    return "HSE";
  }
  // Engineering
  if (pathname === "/engineering" || pathname.startsWith("/engineering/")) {
    return "ENGINEERING";
  }
  // PD
  if (pathname === "/pd" || pathname.startsWith("/pd/") || pathname === "/opportunities" || pathname === "/clients" || pathname.startsWith("/clients/")) {
    return "PROJECT_DEVELOPMENT";
  }
  // Execution Board lives under Project Delivery
  if (pathname === "/execution-board" || pathname.startsWith("/execution-board/")) {
    return "PROJECT_DELIVERY";
  }
  // Portfolio paths (lifecycle)
  if (pathname === "/project-lifecycle" || pathname.startsWith("/project-lifecycle/")) {
    return "PORTFOLIO";
  }
  // Reports section
  if (pathname === "/reports" || pathname.startsWith("/reports/")) {
    return "REPORTS";
  }
  const sorted = [...PAGE_REGISTRY]
    .filter((page) => !!page.navGroup && !page.path.includes(":"))
    .sort((a, b) => b.path.length - a.path.length);

  const match = sorted.find((page) => pathname === page.path || pathname.startsWith(`${page.path}/`));
  if (!match?.navGroup) return undefined;
  return NAV_GROUP_TO_SECTION[match.navGroup];
}
