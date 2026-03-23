import type { PermissionEntity } from "@shared/schema";

export type SidebarVariant = "legacy" | "redesigned" | "unified";

export interface PageRegistryEntry {
  id: string;
  path: string;
  label: string;
  iconKey?: string;
  navGroup?: string;
  permissionEntity?: PermissionEntity;
  showInSidebar?: boolean;
  routeComponentKey?: string;
  redirectTo?: string;
  aliases?: string[];
  roleLandingEligibility?: string[];
  labels?: Partial<Record<SidebarVariant, string>>;
  matchSubRoutes?: boolean;
}

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  { id: "dashboard", path: "/dashboard", label: "Execution Dashboard (Legacy)", permissionEntity: "execution_board", redirectTo: "/execution-board" },
  { id: "projectLifecycle", path: "/project-lifecycle", label: "Project Lifecycle", iconKey: "Layers", navGroup: "PROJECTS", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleStageGates", path: "/project-lifecycle/stage-gates", label: "Stage Gates", permissionEntity: "lifecycle", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleLatestUpdates", path: "/project-lifecycle/latest-updates", label: "Latest Updates", permissionEntity: "projects", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleClientOverview", path: "/project-lifecycle/client-overview", label: "Client Overview", permissionEntity: "pd_clients", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projects", path: "/projects", label: "Project List", iconKey: "FileSpreadsheet", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "projects", showInSidebar: true, routeComponentKey: "ProjectsSummary", labels: { legacy: "Project Summary" } },
  { id: "projectFinancialLinking", path: "/project/:projectName/financial-linking", label: "Financial Linking", routeComponentKey: "FinancialLinkingPage" },
  { id: "projectDetail", path: "/project/:projectName", label: "Project Detail", routeComponentKey: "ProjectDetailPage" },
  { id: "cashflow", path: "/cashflow", label: "Cashflow", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "cashflow", showInSidebar: true, routeComponentKey: "CashflowPage", labels: { redesigned: "Cashflow Control" } },
  { id: "revenue", path: "/revenue", label: "Revenue", redirectTo: "/revenue-tracker" },
  { id: "cos", path: "/cos", label: "COS Tracker", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: true, routeComponentKey: "CostTracker", labels: { redesigned: "COS Control" } },
  { id: "revenueTracker", path: "/revenue-tracker", label: "Revenue Tracker", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: true, routeComponentKey: "RevenueTrackerPage", labels: { redesigned: "Revenue Control" } },
  { id: "gpTracker", path: "/gp-tracker", label: "GP Tracker", iconKey: "Activity", navGroup: "FINANCE", permissionEntity: "gp_tracker", showInSidebar: true, routeComponentKey: "GpTrackerPage", labels: { redesigned: "Gross Profit Control" } },
  { id: "myTool", path: "/my-tool", label: "My Work (Legacy)", redirectTo: "/my-work" },
  { id: "myToolWeek", path: "/my-tool/week", label: "My Work Week (Legacy)", redirectTo: "/my-work/calendar" },
  { id: "myToolBacklog", path: "/my-tool/backlog", label: "My Work Backlog (Legacy)", redirectTo: "/my-work/tasks" },
  { id: "myToolSettings", path: "/my-tool/settings", label: "My Work Settings (Legacy)", redirectTo: "/my-work" },
  { id: "companyPriorities", path: "/company-priorities", label: "Company Priorities", iconKey: "Flag", navGroup: "EXCO", permissionEntity: "company_priorities", showInSidebar: true, routeComponentKey: "MyToolPrioritiesPage" },
  { id: "myToolHelp", path: "/my-tool/help", label: "My Work Help (Legacy)", redirectTo: "/my-work" },
  { id: "admin", path: "/admin", label: "Admin Control Center", permissionEntity: "admin", redirectTo: "/admin/control-center" },
  { id: "adminLegacyUtilities", path: "/admin/legacy-utilities", label: "Legacy Admin Utilities", permissionEntity: "admin", redirectTo: "/admin/control-center" },
  { id: "adminMyTool", path: "/admin/my-tool-settings", label: "Admin My Work Settings", permissionEntity: "admin", routeComponentKey: "MyToolAdminSettingsPage" },
  { id: "sharepointIntake", path: "/admin/sharepoint-intake", label: "SharePoint Intake", iconKey: "Cloud", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "SharePointIntakePage" },
  { id: "quality", path: "/quality", label: "Quality Dashboard", iconKey: "ShieldCheck", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QmDashboardPage" },
  { id: "engineering", path: "/engineering", label: "Eng Overview", iconKey: "Wrench", navGroup: "ENGINEERING", permissionEntity: "engineering", showInSidebar: true, routeComponentKey: "EngineeringDashboardPage", labels: { legacy: "Eng Standup" } },
  { id: "engineeringTasks", path: "/engineering/tasks", label: "Task Execution", iconKey: "ListTodo", navGroup: "ENGINEERING", permissionEntity: "eng_tasks", showInSidebar: true, routeComponentKey: "EngineeringTasksPage" },
  { id: "engineeringAudit", path: "/engineering/audit", label: "Eng Audit Log", iconKey: "Activity", navGroup: "ENGINEERING", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngineeringAuditPage" },
  { id: "lifecycle", path: "/lifecycle-board", label: "Lifecycle", iconKey: "Layers", navGroup: "PROJECTS", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "LifecycleBoardPage", labels: { legacy: "Exco" } },
  { id: "executionBoard", path: "/execution-board", label: "Execution Dashboard", iconKey: "LayoutDashboard", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "ExecutionBoardPage", aliases: ["/execution-dashboard"], roleLandingEligibility: ["PROJECT_MANAGER_SITE"], labels: { legacy: "Work Plan / Board", redesigned: "Execution Dashboard" }, matchSubRoutes: true },
  { id: "executionBoardProgram", path: "/execution-board/program", label: "Program View", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "executionBoardConstruction", path: "/execution-board/construction", label: "Construction View", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "executionBoardFinance", path: "/execution-board/finance", label: "Program Finance", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage" },
  { id: "myToolMeetings", path: "/my-tool/meetings", label: "My Work Meetings (Legacy)", redirectTo: "/my-work/meetings" },
  { id: "smartImport", path: "/admin/smart-import", label: "Smart Import", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "smart_import", showInSidebar: false, routeComponentKey: "SmartImportPage" },
  { id: "invoicePatterns", path: "/invoice-patterns", label: "Invoice Patterns", iconKey: "FileSpreadsheet", navGroup: "FINANCE", permissionEntity: "invoice_patterns", showInSidebar: true, routeComponentKey: "InvoicePatternsPage", labels: { redesigned: "Invoice Pattern Library" } },
  { id: "counterparties", path: "/counterparties", label: "Counterparties", iconKey: "Building2", navGroup: "FINANCE", permissionEntity: "counterparties", showInSidebar: true, routeComponentKey: "CounterpartiesPage" },
  { id: "subcontractor", path: "/subcontractor-dashboard", label: "Procurement", iconKey: "Users", navGroup: "FINANCE", permissionEntity: "subcontractors", showInSidebar: true, routeComponentKey: "SubcontractorDashboardPage", labels: { redesigned: "Procurement Hub" } },
  { id: "adminActivity", path: "/admin/activity-log", label: "Activity Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "activity_log", showInSidebar: false, routeComponentKey: "SystemActivityLogPage", labels: { legacy: "Change Audit" } },
  { id: "weeklyReviews", path: "/weekly-reviews", label: "Weekly Reviews", iconKey: "CalendarCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "weekly_review_wizard", showInSidebar: true, routeComponentKey: "WeeklyReviewsPage" },
  { id: "adminRoles", path: "/admin/roles", label: "Users & Roles", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: false, routeComponentKey: "AdminRolesPage", labels: { legacy: "Roles & Permissions" } },
  { id: "leaderboard", path: "/leaderboard", label: "Leaderboard", iconKey: "Trophy", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: true, routeComponentKey: "LeaderboardPage" },
  { id: "feedback", path: "/feedback", label: "Feedback & Support", iconKey: "MessageSquareText", navGroup: "KNOWLEDGE", permissionEntity: "feedback", showInSidebar: true, routeComponentKey: "FeedbackPage" },
  { id: "eeInfo", path: "/ee-info", label: "Emergent Energy Info", iconKey: "Leaf", navGroup: "KNOWLEDGE", permissionEntity: "ee_info", showInSidebar: true, routeComponentKey: "EeInfoPage" },
  { id: "training", path: "/training", label: "Training", iconKey: "GraduationCap", navGroup: "KNOWLEDGE", permissionEntity: "training", showInSidebar: true, routeComponentKey: "TrainingPage" },
  { id: "pmDashboard", path: "/pm-dashboard", label: "PM Dashboard (Legacy)", permissionEntity: "execution_board", redirectTo: "/execution-board" },
  { id: "portfolios", path: "/portfolios", label: "Portfolios", iconKey: "FolderOpen", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "portfolios", showInSidebar: true, routeComponentKey: "PortfoliosPage" },
  { id: "portfolioDetail", path: "/portfolios/:id", label: "Portfolio Detail", routeComponentKey: "PortfolioDetailPage" },
  { id: "pdDashboard", path: "/pd", label: "PD Dashboard", iconKey: "Sun", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: true, routeComponentKey: "PdDashboardPage", aliases: ["/pd/dashboard"] },
  { id: "pdTickets", path: "/pd/tickets", label: "PD Tickets", iconKey: "ClipboardList", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_tickets", showInSidebar: true, routeComponentKey: "PdTicketsPage" },
  { id: "pdTicketCreate", path: "/pd/tickets/create", label: "Create PD Ticket", routeComponentKey: "PdTicketCreatePage" },
  { id: "pdTicketDetail", path: "/pd/tickets/:id", label: "PD Ticket Detail", routeComponentKey: "PdTicketDetailPage" },
  { id: "teamsChats", path: "/teams/chats", label: "Teams Chat", iconKey: "MessageSquare", navGroup: "FEEDBACK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "collaboration", path: "/collaboration", label: "Collaboration Hub", permissionEntity: "collaboration_hub", routeComponentKey: "CollaborationPage" },
  { id: "collabEmail", path: "/collaboration/email", label: "Collaboration Email", permissionEntity: "collaboration_hub", routeComponentKey: "CollabEmailPage" },
  { id: "collabTeams", path: "/collaboration/teams", label: "Collaboration Teams", permissionEntity: "teams_chat", routeComponentKey: "CollabTeamsPage" },
  { id: "pmOnTheGo", path: "/pm/on-the-go", label: "PM On-The-Go", iconKey: "Smartphone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_on_the_go", showInSidebar: true, routeComponentKey: "PMOnTheGoHome" },
  { id: "pmOnTheGoProject", path: "/pm/on-the-go/project/:projectId", label: "On-The-Go Project", routeComponentKey: "PMOnTheGoProject" },
  { id: "myWork", path: "/my-work", label: "My Work", iconKey: "Home", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "MyWorkHomePage", matchSubRoutes: true },
  { id: "myWorkCalendar", path: "/my-work/calendar", label: "Calendar", iconKey: "CalendarCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, routeComponentKey: "MyWorkCalendarPage" },
  { id: "myWorkTasks", path: "/my-work/tasks", label: "Tasks", iconKey: "ListChecks", navGroup: "MY_WORK", permissionEntity: "my_tool", showInSidebar: true, routeComponentKey: "MyWorkTasksPage" },
  { id: "myWorkApprovals", path: "/my-work/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, redirectTo: "/my-work/tasks?source=approvals" },
  { id: "myWorkMeetings", path: "/my-work/meetings", label: "Meetings", iconKey: "MessageSquareText", navGroup: "MY_WORK", permissionEntity: "meetings", showInSidebar: true, routeComponentKey: "MyToolMeetingsPage" },
  { id: "myWorkEmail", path: "/my-work/email", label: "Email", iconKey: "Mail", navGroup: "MY_WORK", permissionEntity: "collaboration_hub", showInSidebar: true, routeComponentKey: "CollabEmailPage" },
  { id: "myWorkTeams", path: "/my-work/teams", label: "Teams Chat", iconKey: "MessagesSquare", navGroup: "MY_WORK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "adminDatabaseMigration", path: "/admin/database-migration", label: "Database Migration", permissionEntity: "database_migration", routeComponentKey: "DatabaseMigrationPage" },
  { id: "adminKpiTraceability", path: "/admin/kpi-traceability", label: "KPI Traceability", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "KpiTraceabilityPage" },
  { id: "adminImportControlTower", path: "/admin/import-control-tower", label: "Import Control Tower", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "ImportControlTowerPage" },
  { id: "programmeReports", path: "/reports/programme", label: "Programme Reports", iconKey: "FileSpreadsheet", navGroup: "PORTFOLIO", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "ProgrammeReportsPage" },
  { id: "pmMonthlyReport", path: "/reports/pm/monthly", label: "PM Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "PmMonthlyReportPage" },
  { id: "pmMonthlyReportHistory", path: "/reports/pm/monthly/history", label: "PM Report History", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportHistoryPage" },
  { id: "pmMonthlyReportCompare", path: "/reports/pm/monthly/compare", label: "PM Report Compare", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportComparePage" },
  { id: "pmMonthlyReportProject", path: "/reports/pm/monthly/:month/project/:projectId", label: "PM Report Project", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportProjectPage" },
  { id: "engMonthlyReport", path: "/reports/engineering/monthly", label: "Engineering Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: true, routeComponentKey: "EngMonthlyReportPage" },
  { id: "engMonthlyReportHistory", path: "/reports/engineering/monthly/history", label: "Engineering Report History", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportHistoryPage" },
  { id: "engMonthlyReportCompare", path: "/reports/engineering/monthly/compare", label: "Engineering Report Compare", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportComparePage" },
  { id: "engMonthlyReportProject", path: "/reports/engineering/monthly/:month/project/:projectId", label: "Engineering Report Project", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportProjectPage" },
  { id: "adminRecovery", path: "/admin/recovery", label: "Recovery Center", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminRecoveryPage" },
  { id: "adminControlCenter", path: "/admin/control-center", label: "Control Center", iconKey: "Gauge", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminControlCenterPage" },
  { id: "clients", path: "/clients", label: "Clients", iconKey: "Users", navGroup: "PROJECTS", permissionEntity: "pd_clients", showInSidebar: true, routeComponentKey: "ClientsPage", aliases: ["/pd/clients"] },
  { id: "actionLaunchpad", path: "/actions/launchpad", label: "Quick Create", routeComponentKey: "ActionLaunchpadPage" },
  { id: "pdPmHandover", path: "/pd/handover/:projectId", label: "PD to PM Handover", permissionEntity: "handover", routeComponentKey: "PdPmHandoverPage" },
  { id: "pmHandoverReview", path: "/pm/handover-review", label: "PM Handover Review", permissionEntity: "handover", routeComponentKey: "PmHandoverReviewPage" },
  { id: "pmApprovals", path: "/pm/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "approvals", showInSidebar: true, routeComponentKey: "ApprovalsPage" },
  { id: "pmDeliverables", path: "/pm/deliverables", label: "Deliverables", iconKey: "Package", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "deliverables", showInSidebar: true, routeComponentKey: "PMDeliverablesPage" },
  { id: "handoverControl", path: "/handover-control", label: "Site / Execution Controls", iconKey: "Handshake", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "handover", showInSidebar: true, routeComponentKey: "HandoverControlPage" },
  { id: "taskManagement", path: "/tasks", label: "Task Hub", iconKey: "LayoutGrid", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "task_management", showInSidebar: true, routeComponentKey: "TaskManagementPage", labels: { redesigned: "Task Management Hub" } },
  { id: "standups", path: "/standups", label: "Standups", iconKey: "Users", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "standups", showInSidebar: true, routeComponentKey: "StandupsPage", labels: { redesigned: "Bi-Daily Standups" } },
  { id: "fyeRevenueTracking", path: "/fye-revenue-tracking", label: "FYE Revenue Tracking", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "fye_revenue_tracking", showInSidebar: true, routeComponentKey: "FyeRevenueTrackingPage" },
  { id: "phaseTemplates", path: "/admin/phase-templates", label: "Phase Templates", iconKey: "ListChecks", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "PhaseTemplatesPage" },
  { id: "projectCreate", path: "/project-create", label: "Create Project", permissionEntity: "project_create", routeComponentKey: "ProjectCreatePage" },
  { id: "departmentScores", path: "/department-scores", label: "Department Scores", iconKey: "BarChart3", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: false, routeComponentKey: "DepartmentScoresPage" },
  { id: "engTemplateAdmin", path: "/admin/eng-templates", label: "Engineering Templates", iconKey: "FileText", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngTemplateAdminPage" },
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
