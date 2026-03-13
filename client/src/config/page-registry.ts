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
  { id: "dashboard", path: "/dashboard", label: "Execution Board", iconKey: "LayoutDashboard", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "Dashboard", labels: { legacy: "Execution Board" } },
  { id: "projects", path: "/projects", label: "Project List", iconKey: "FileSpreadsheet", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "projects", showInSidebar: true, routeComponentKey: "ProjectsSummary", labels: { legacy: "Project Summary" } },
  { id: "projectFinancialLinking", path: "/project/:projectName/financial-linking", label: "Financial Linking", routeComponentKey: "FinancialLinkingPage" },
  { id: "projectDetail", path: "/project/:projectName", label: "Project Detail", routeComponentKey: "ProjectDetailPage" },
  { id: "cashflow", path: "/cashflow", label: "Cashflow", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "cashflow", showInSidebar: true, routeComponentKey: "CashflowPage", labels: { redesigned: "Cashflow Control" } },
  { id: "revenue", path: "/revenue", label: "Revenue", routeComponentKey: "RevenueTracker" },
  { id: "cos", path: "/cos", label: "COS Tracker", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: true, routeComponentKey: "CostTracker", labels: { redesigned: "COS Control" } },
  { id: "revenueTracker", path: "/revenue-tracker", label: "Revenue Tracker", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: true, routeComponentKey: "RevenueTrackerPage", labels: { redesigned: "Revenue Control" } },
  { id: "gpTracker", path: "/gp-tracker", label: "GP Tracker", iconKey: "Activity", navGroup: "FINANCE", permissionEntity: "gp_tracker", showInSidebar: true, routeComponentKey: "GpTrackerPage", labels: { redesigned: "Gross Profit Control" } },
  { id: "myTool", path: "/my-tool", label: "My Work", iconKey: "Briefcase", navGroup: "EXCO", permissionEntity: "my_tool", showInSidebar: false, routeComponentKey: "MyToolTodayPage", matchSubRoutes: true, labels: { legacy: "My Work" } },
  { id: "myToolWeek", path: "/my-tool/week", label: "My Work Week", routeComponentKey: "MyToolWeekPage" },
  { id: "myToolBacklog", path: "/my-tool/backlog", label: "My Work Backlog", routeComponentKey: "MyToolBacklogPage" },
  { id: "myToolSettings", path: "/my-tool/settings", label: "My Work Settings", routeComponentKey: "MyToolSettingsPage" },
  { id: "companyPriorities", path: "/company-priorities", label: "Company Priorities", iconKey: "Flag", navGroup: "EXCO", permissionEntity: "company_priorities", showInSidebar: true, routeComponentKey: "MyToolPrioritiesPage" },
  { id: "myToolHelp", path: "/my-tool/help", label: "My Work Help", routeComponentKey: "MyToolHelpPage" },
  { id: "admin", path: "/admin", label: "Admin Control Center", permissionEntity: "admin", redirectTo: "/admin/control-center" },
  { id: "adminLegacyUtilities", path: "/admin/legacy-utilities", label: "Legacy Admin Utilities", permissionEntity: "admin", routeComponentKey: "AdminPage" },
  { id: "adminMyTool", path: "/admin/my-tool-settings", label: "Admin My Work Settings", permissionEntity: "admin", routeComponentKey: "MyToolAdminSettingsPage" },
  { id: "quality", path: "/quality", label: "Quality Dashboard", iconKey: "ShieldCheck", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QmDashboardPage" },
  { id: "engineering", path: "/engineering", label: "Eng Overview", iconKey: "Wrench", navGroup: "ENGINEERING", permissionEntity: "engineering", showInSidebar: true, routeComponentKey: "EngineeringDashboardPage", labels: { legacy: "Eng Standup" } },
  { id: "engineeringTasks", path: "/engineering/tasks", label: "Task Execution", iconKey: "ListTodo", navGroup: "ENGINEERING", permissionEntity: "eng_tasks", showInSidebar: true, routeComponentKey: "EngineeringTasksPage" },
  { id: "lifecycle", path: "/lifecycle-board", label: "Lifecycle Board", iconKey: "Layers", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "lifecycle", showInSidebar: true, routeComponentKey: "LifecycleBoardPage", labels: { legacy: "Exco" } },
  { id: "executionBoard", path: "/execution-board", label: "Execution Board", permissionEntity: "execution_board", routeComponentKey: "ExecutionBoardPage", aliases: ["/execution-dashboard"] },
  { id: "myToolMeetings", path: "/my-tool/meetings", label: "My Work Meetings", routeComponentKey: "MyToolMeetingsPage" },
  { id: "adminSettings", path: "/admin/settings", label: "App Settings", iconKey: "Settings", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "RoleSettingsPage", labels: { legacy: "Settings" } },
  { id: "smartImport", path: "/smart-import", label: "Smart Import", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "smart_import", showInSidebar: true, routeComponentKey: "SmartImportPage" },
  { id: "invoicePatterns", path: "/invoice-patterns", label: "Invoice Patterns", iconKey: "FileSpreadsheet", navGroup: "FINANCE", permissionEntity: "invoice_patterns", showInSidebar: true, routeComponentKey: "InvoicePatternsPage", labels: { redesigned: "Invoice Pattern Library" } },
  { id: "subcontractor", path: "/subcontractor-dashboard", label: "Procurement", iconKey: "Users", navGroup: "FINANCE", permissionEntity: "subcontractors", showInSidebar: true, routeComponentKey: "SubcontractorDashboardPage", labels: { redesigned: "Procurement Hub" } },
  { id: "adminActivity", path: "/admin/activity-log", label: "Activity Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "activity_log", showInSidebar: false, routeComponentKey: "SystemActivityLogPage", labels: { legacy: "Change Audit" } },
  { id: "weeklyReviews", path: "/weekly-reviews", label: "Weekly Reviews", iconKey: "CalendarCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "weekly_review_wizard", showInSidebar: true, routeComponentKey: "WeeklyReviewsPage" },
  { id: "adminRoles", path: "/admin/roles", label: "Users & Roles", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: false, routeComponentKey: "AdminRolesPage", labels: { legacy: "Roles & Permissions" } },
  { id: "leaderboard", path: "/leaderboard", label: "Leaderboard", iconKey: "Trophy", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: true, routeComponentKey: "LeaderboardPage" },
  { id: "trRegister", path: "/tr-register", label: "TR Register", redirectTo: "/my-work/tasks" },
  { id: "feedback", path: "/feedback", label: "Feedback & Support", iconKey: "MessageSquareText", navGroup: "KNOWLEDGE", permissionEntity: "feedback", showInSidebar: true, routeComponentKey: "FeedbackPage" },
  { id: "eeInfo", path: "/ee-info", label: "Emergent Energy Info", iconKey: "Leaf", navGroup: "KNOWLEDGE", permissionEntity: "ee_info", showInSidebar: true, routeComponentKey: "EeInfoPage" },
  { id: "training", path: "/training", label: "Training", iconKey: "GraduationCap", navGroup: "KNOWLEDGE", permissionEntity: "training", showInSidebar: true, routeComponentKey: "TrainingPage" },
  { id: "knowledgeGame", path: "/knowledge-game", label: "Knowledge Game", iconKey: "Gamepad2", navGroup: "KNOWLEDGE", permissionEntity: "knowledge_game", showInSidebar: true, routeComponentKey: "KnowledgeGamePage" },
  { id: "departmentScores", path: "/department-scores", label: "Department Scores", iconKey: "BarChart3", navGroup: "KNOWLEDGE", permissionEntity: "department_scores", showInSidebar: true, routeComponentKey: "DepartmentScoresPage" },
  { id: "pmDashboard", path: "/pm-dashboard", label: "PM Dashboard", iconKey: "Briefcase", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_dashboard", showInSidebar: true, routeComponentKey: "PMDashboard", roleLandingEligibility: ["PROJECT_MANAGER_SITE"] },
  { id: "excelUpdates", path: "/excel-updates", label: "Excel Updates", iconKey: "ClipboardCheck", navGroup: "SYSTEM", permissionEntity: "excel_updates", showInSidebar: true, routeComponentKey: "ExcelUpdatesPage" },
  { id: "portfolios", path: "/portfolios", label: "Portfolios", iconKey: "FolderOpen", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "portfolios", showInSidebar: true, routeComponentKey: "PortfoliosPage" },
  { id: "portfolioDetail", path: "/portfolios/:id", label: "Portfolio Detail", routeComponentKey: "PortfolioDetailPage" },
  { id: "pdDashboard", path: "/pd", label: "PD Dashboard", iconKey: "Sun", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: true, routeComponentKey: "PdDashboardPage", aliases: ["/pd/dashboard"] },
  { id: "pdTickets", path: "/pd/tickets", label: "PD Tickets", iconKey: "ClipboardList", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_tickets", showInSidebar: true, routeComponentKey: "PdTicketsPage" },
  { id: "pdTicketCreate", path: "/pd/tickets/create", label: "Create PD Ticket", routeComponentKey: "PdTicketCreatePage" },
  { id: "pdTicketDetail", path: "/pd/tickets/:id", label: "PD Ticket Detail", routeComponentKey: "PdTicketDetailPage" },
  { id: "settingsIntegrations", path: "/settings/integrations", label: "Settings Integrations", redirectTo: "/admin/settings" },
  { id: "adminMsIntegration", path: "/admin/ms-integration", label: "MS Integration", redirectTo: "/admin/settings" },
  { id: "teamsChats", path: "/teams/chats", label: "Teams Chat", iconKey: "MessageSquare", navGroup: "FEEDBACK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "adminMsMapping", path: "/admin/ms-mapping", label: "MS Mapping", redirectTo: "/admin/settings" },
  { id: "collaboration", path: "/collaboration", label: "Collaboration Hub", permissionEntity: "collaboration_hub", routeComponentKey: "CollaborationPage" },
  { id: "collabEmail", path: "/collaboration/email", label: "Collaboration Email", permissionEntity: "collaboration_hub", routeComponentKey: "CollabEmailPage" },
  { id: "collabTeams", path: "/collaboration/teams", label: "Collaboration Teams", permissionEntity: "teams_chat", routeComponentKey: "CollabTeamsPage" },
  { id: "pmOnTheGo", path: "/pm/on-the-go", label: "On-The-Go", iconKey: "Smartphone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_on_the_go", showInSidebar: true, routeComponentKey: "PMOnTheGoHome" },
  { id: "pmOnTheGoProject", path: "/pm/on-the-go/project/:projectId", label: "On-The-Go Project", routeComponentKey: "PMOnTheGoProject" },
  { id: "myWork", path: "/my-work", label: "My Work", iconKey: "Home", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "MyWorkHomePage", matchSubRoutes: true },
  { id: "myWorkCalendar", path: "/my-work/calendar", label: "Calendar", iconKey: "CalendarCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, routeComponentKey: "MyWorkCalendarPage" },
  { id: "myWorkTasks", path: "/my-work/tasks", label: "Tasks", iconKey: "ListChecks", navGroup: "MY_WORK", permissionEntity: "my_tool", showInSidebar: true, routeComponentKey: "MyWorkTasksPage" },
  { id: "myWorkApprovals", path: "/my-work/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, routeComponentKey: "ApprovalsPage" },
  { id: "myWorkMeetings", path: "/my-work/meetings", label: "Meetings", iconKey: "MessageSquareText", navGroup: "MY_WORK", permissionEntity: "meetings", showInSidebar: true, routeComponentKey: "MyToolMeetingsPage" },
  { id: "myWorkEmail", path: "/my-work/email", label: "Email", iconKey: "Mail", navGroup: "MY_WORK", permissionEntity: "collaboration_hub", showInSidebar: true, routeComponentKey: "CollabEmailPage" },
  { id: "myWorkTeams", path: "/my-work/teams", label: "Teams Chat", iconKey: "MessagesSquare", navGroup: "MY_WORK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "adminDatabaseMigration", path: "/admin/database-migration", label: "Database Migration", permissionEntity: "database_migration", routeComponentKey: "DatabaseMigrationPage" },
  { id: "adminKpiTraceability", path: "/admin/kpi-traceability", label: "KPI Traceability", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "KpiTraceabilityPage" },
  { id: "adminImportControlTower", path: "/admin/import-control-tower", label: "Import Control Tower", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "ImportControlTowerPage" },
  { id: "adminRecovery", path: "/admin/recovery", label: "Recovery Center", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminRecoveryPage" },
  { id: "adminControlCenter", path: "/admin/control-center", label: "Control Center", iconKey: "Gauge", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminControlCenterPage" },
  { id: "commandCenter", path: "/command-center", label: "Command Center", iconKey: "Zap", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "CommandCenterPage" },
  { id: "clients", path: "/clients", label: "Clients", iconKey: "Users", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_clients", showInSidebar: true, routeComponentKey: "ClientsPage", aliases: ["/pd/clients"] },
  { id: "actionLaunchpad", path: "/actions/launchpad", label: "Quick Create", routeComponentKey: "ActionLaunchpadPage" },
  { id: "pdPmHandover", path: "/pd/handover/:projectId", label: "PD to PM Handover", routeComponentKey: "PdPmHandoverPage" },
  { id: "pmHandoverReview", path: "/pm/handover-review", label: "PM Handover Review", routeComponentKey: "PmHandoverReviewPage" },
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
