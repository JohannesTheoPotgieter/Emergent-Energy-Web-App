import type { PermissionEntity } from "@shared/schema";
import type { SectionKey } from "@/config/app-navigation";

/**
 * Nav-group keys used by each PAGE_REGISTRY entry. These are a finer-grained
 * bucket than SectionKey (e.g. GATES and PORTFOLIO both fold into the
 * "Company" section); NAV_GROUP_TO_SECTION below is the mapping.
 */
export const NAV_GROUP_KEYS = [
  "MY_WORK",
  "PORTFOLIO",
  "PRIORITIES",
  "PROJECT_DEVELOPMENT",
  "PROJECTS",
  "PROJECT_MANAGEMENT",
  "GATES",
  "FINANCE",
  "ENGINEERING",
  "QUALITY",
  "HSE",
  "REPORTS",
  "KNOWLEDGE",
  "SYSTEM",
] as const;
export type NavGroupKey = typeof NAV_GROUP_KEYS[number];

export interface PageRegistryEntry {
  id: string;
  path: string;
  label: string;
  /** 'page' = renders a component; 'alias' = redirects to another path */
  type?: "page" | "alias";
  iconKey?: string;
  navGroup?: NavGroupKey;
  permissionEntity?: PermissionEntity;
  showInSidebar?: boolean;
  routeComponentKey?: string;
  redirectTo?: string;
  aliases?: string[];
  roleLandingEligibility?: string[];
  matchSubRoutes?: boolean;
  /**
   * Route access intent:
   * - protected (default): must resolve a permission entity at runtime.
   * - public: reachable without auth/permission checks.
   * - ungated: authenticated route intentionally not permission-entity gated.
   */
  accessPolicy?: "protected" | "public" | "ungated";
}

/**
 * Legacy redirects — old bookmarks / deep links that redirect to canonical paths.
 * Kept separate from PAGE_REGISTRY so they don't pollute command palette or sidebar.
 */
export const LEGACY_REDIRECTS: Array<{ path: string; redirectTo: string }> = [
  // /dashboard now points to the canonical company surface (matches the
  // executive landing), so bookmarks that say "open the dashboard" land on
  // something that actually looks like one. /gates remains reachable from
  // the sidebar for stage-gate workflows.
  { path: "/dashboard", redirectTo: "/execution" },
  { path: "/revenue", redirectTo: "/revenue-tracker" },
  { path: "/my-tool", redirectTo: "/" },
  { path: "/my-tool/week", redirectTo: "/my-work/calendar" },
  { path: "/my-tool/backlog", redirectTo: "/my-work/tasks" },
  { path: "/my-tool/settings", redirectTo: "/my-work/settings" },
  { path: "/my-tool/help", redirectTo: "/" },
  { path: "/my-tool/meetings", redirectTo: "/my-work/meetings" },
  { path: "/company-priorities", redirectTo: "/priorities" },
  { path: "/reports", redirectTo: "/reports/center" },
  { path: "/admin", redirectTo: "/settings" },
  { path: "/admin/legacy-utilities", redirectTo: "/settings" },
  // Task #101 — Control Center retired; "Roles & Permissions" is the new
  // single landing page for everything access-related (People / Roles /
  // Advanced tabs). The legacy admin-control-center.tsx is kept on disk as
  // a fallback but no longer routed.
  { path: "/admin/control-center", redirectTo: "/settings" },
  // Prompt 2 — old nav destinations that moved
  { path: "/exceptions", redirectTo: "/gates/exceptions" },
  { path: "/project-lifecycle", redirectTo: "/lifecycle-board" },
  { path: "/command-center", redirectTo: "/my-work" },
  { path: "/sseg", redirectTo: "/handover?tab=sseg" },
  // Hyphenated admin paths used by older code paths / bookmarks. Real
  // routes use slash-separated paths (/admin/pipedrive). Redirect so
  // mistyped or stale links don't dead-end on Access Denied.
  { path: "/admin-pipedrive", redirectTo: "/admin/pipedrive" },
  { path: "/admin-quickbooks", redirectTo: "/admin/quickbooks" },
  { path: "/admin-workflow-config", redirectTo: "/admin/workflow-config" },
  { path: "/admin-backfill", redirectTo: "/admin/data-migration-status" },
  { path: "/admin-recovery", redirectTo: "/admin/recovery" },
  { path: "/admin-roles", redirectTo: "/admin/roles" },
  { path: "/admin-settings", redirectTo: "/admin/settings" },
  { path: "/system-activity-log", redirectTo: "/admin/activity-log" },
  { path: "/phase-templates", redirectTo: "/admin/phase-templates" },
];

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  { id: "companyOverview", path: "/company-overview", label: "Company Overview", iconKey: "Activity", navGroup: "PORTFOLIO", permissionEntity: "execution_board", showInSidebar: false, routeComponentKey: "CompanyOverviewPage" },
  { id: "companyTeam", path: "/company/team", label: "Team", iconKey: "Users", navGroup: "PORTFOLIO", permissionEntity: "company_team", showInSidebar: false, routeComponentKey: "CompanyTeamPage" },
  // Role-specific dashboards stay reachable from the sidebar but executives
  // land on /execution-board so leadership numbers come from the canonical
  // company surface (matches navigation-safety-cleanup contract).
  { id: "ceoHome", path: "/ceo", label: "CEO Dashboard", iconKey: "Sun", navGroup: "REPORTS", permissionEntity: "execution_board", showInSidebar: false, routeComponentKey: "CeoHomePage" },
  { id: "cooHome", path: "/coo", label: "COO Dashboard", iconKey: "Activity", navGroup: "REPORTS", permissionEntity: "execution_board", showInSidebar: false, routeComponentKey: "CooHomePage" },
  { id: "settingsHome", path: "/settings", label: "Settings", iconKey: "SlidersHorizontal", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: false, routeComponentKey: "SettingsHomePage" },
  { id: "projectDocuments", path: "/projects/:projectId/documents", label: "Project Documents", permissionEntity: "projects", routeComponentKey: "ProjectDocumentsPage" },
  // /quickbooks now redirects to the QB Reconciliation page.
  // Kept as a redirect so any bookmarked link still lands in the right place.
  { id: "quickbooksHomeRedirect", path: "/quickbooks", label: "QuickBooks (moved)", type: "alias", permissionEntity: "financials", redirectTo: "/finance/qb-reconciliation" },
  // Visible to anyone with company_priorities:view since the template
  // LIST endpoint already filters by dept visibility (regular users
  // only see role-scope templates they could instantiate). The Create
  // / Edit / Delete buttons are hidden client-side via `canManage` and
  // the server CRUD is gated by `requirePriorityCreator`.
  { id: "adminPriorityTemplates", path: "/admin/priority-templates", label: "Priority templates", iconKey: "Sparkles", navGroup: "SYSTEM", permissionEntity: "company_priorities", routeComponentKey: "AdminPriorityTemplatesPage" },
  { id: "adminDocumentManagement", path: "/admin/document-management", label: "Document management", iconKey: "FolderTree", navGroup: "SYSTEM", permissionEntity: "documents_admin", routeComponentKey: "AdminDocumentManagementPage" },
  { id: "adminEmailLinkerDev", path: "/admin/email-linker-dev", label: "Email auto-linker (dev)", iconKey: "Mail", navGroup: "SYSTEM", permissionEntity: "admin_roles", routeComponentKey: "AdminEmailLinkerDevPage" },
  { id: "pendingApprovals", path: "/pending-approvals", label: "Pending Approvals", iconKey: "Inbox", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: false, routeComponentKey: "PendingApprovalsPage" },
  { id: "handoverLive", path: "/handover/:projectId/live", label: "Handover live meeting", permissionEntity: "projects", routeComponentKey: "HandoverLivePage" },
  { id: "projectLifecycle", path: "/project-lifecycle", label: "Project Lifecycle", iconKey: "Layers", navGroup: "PROJECTS", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleStageGates", path: "/project-lifecycle/stage-gates", label: "Stage Gates", permissionEntity: "lifecycle", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleLatestUpdates", path: "/project-lifecycle/latest-updates", label: "Latest Updates", permissionEntity: "projects", routeComponentKey: "ProjectLifecyclePage" },
  { id: "projectLifecycleClientOverview", path: "/project-lifecycle/client-overview", label: "Client Overview", permissionEntity: "pd_clients", routeComponentKey: "ProjectLifecyclePage" },
  // Retired surface — kept only so /projects resolves to a redirect to the
  // Execution board (its features were migrated there). Hidden from the sidebar.
  { id: "projects", path: "/projects", label: "All Projects", iconKey: "FileSpreadsheet", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "projects", showInSidebar: false, routeComponentKey: "ProjectsSummary" },
  { id: "projectFinancialLinking", path: "/project/:projectName/financial-linking", label: "Financial Linking", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "financial_linking", routeComponentKey: "FinancialLinkingPage" },
  { id: "projectDetail", path: "/project/id/:projectId", label: "Project Detail", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "projects", routeComponentKey: "ProjectDetailPage", aliases: ["/project/:projectName"], matchSubRoutes: true },
  { id: "projectStageGate", path: "/project/id/:projectId/gate/:stageCode", label: "Project Stage Gate", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "stage_lifecycle", routeComponentKey: "ProjectStageGatePage", aliases: ["/project/:projectName/gate/:stageCode"] },
  // Answer-first finance landing — leads with the four weekly-meeting answers
  // (GP vs budget, revenue recognised vs FY target, cash this week, tracker-vs-QB)
  // then the per-project reconciliation health list. Reads canonical endpoints only.
  { id: "financeHome", path: "/finance", label: "Finance Home", iconKey: "LayoutDashboard", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: true, routeComponentKey: "FinanceHomePage" },
  // Weekly Close SCRAPPED in the live-ready module (2026-06-11): its AR
  // schedule + past-dated missing-invoice worklists now live in Cashflow.
  // Kept as a redirect so bookmarks / deep links to /finance/close don't 404.
  // The FinanceWeeklyClosePage component remains on disk (frozen finance code,
  // not deleted) but is no longer routed.
  { id: "financeWeeklyClose", path: "/finance/close", label: "Weekly Close (moved to Cashflow)", type: "alias", permissionEntity: "cashflow", redirectTo: "/cashflow" },
  { id: "cashflow", path: "/cashflow", label: "Cashflow", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "cashflow", showInSidebar: true, routeComponentKey: "CashflowPage", roleLandingEligibility: ["CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"] },
  { id: "cashflowAnalysis", path: "/cashflow/analysis", label: "Cashflow Analysis", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "cashflow", showInSidebar: false, routeComponentKey: "CashflowAnalysisPage" },
  { id: "cos", path: "/cos", label: "COS", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: true, routeComponentKey: "CostTracker" },
  { id: "cosAnalysis", path: "/cos/analysis", label: "COS Analysis", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: false, routeComponentKey: "CosAnalysisPage" },
  { id: "revenueTracker", path: "/revenue-tracker", label: "Revenue", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: true, routeComponentKey: "RevenueTrackerPage", aliases: ["/finance/revenue"] },
  { id: "fyeRevenueTracking", path: "/fye-revenue-tracking", label: "FYE Tracking", iconKey: "CalendarRange", navGroup: "FINANCE", permissionEntity: "fye_revenue_tracking", showInSidebar: true, routeComponentKey: "FyeRevenueTrackingPage" },
  { id: "financeGpCompany", path: "/finance/gp/company", label: "GP", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: true, routeComponentKey: "FinanceGpCompanyPage" },
  { id: "financeGp", path: "/finance/gp", label: "GP — by project", iconKey: "BarChart3", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: false, routeComponentKey: "FinanceGpPage" },
  // TF-9 follow-up (audit V3) — Audit Prep CSV bundles for external auditors.
  // Gated on financials:approve (CFO + COO/CEO admins).
  { id: "financeAuditPrep", path: "/finance/audit-prep", label: "Audit Prep", iconKey: "ShieldCheck", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: true, routeComponentKey: "FinanceAuditPrepPage" },
  { id: "financeHealth", path: "/finance/health", label: "Finance Health", iconKey: "Activity", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: true, routeComponentKey: "FinanceHealthPage" },
  { id: "financeQbReconciliation", path: "/finance/qb-reconciliation", label: "QB Reconciliation", iconKey: "GitCompare", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: true, routeComponentKey: "FinanceQbReconciliationPage" },
  // Per-project Tracker replicas — read-only views that render the source
  // workbook 1:1 with font/fill fidelity. Not in the sidebar; reached from
  // project-level navigation. Permission scope mirrors the existing finance
  // / project-management entities so visibility follows the established RBAC.
  { id: "trackerReplicaRevenue", path: "/projects/:projectId/revenue-tracking", label: "Revenue Tracking (Replica)", iconKey: "TrendingUp", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: false, routeComponentKey: "RevenueTrackingReplicaPage" },
  { id: "trackerReplicaExpenditure", path: "/projects/:projectId/expenditure-breakdown", label: "Expenditure Breakdown (Replica)", iconKey: "TrendingDown", navGroup: "FINANCE", permissionEntity: "cos", showInSidebar: false, routeComponentKey: "ExpenditureBreakdownReplicaPage" },
  { id: "trackerReplicaPlan", path: "/projects/:projectId/program-plan", label: "Program Plan (Replica)", iconKey: "Calendar", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "work_items", showInSidebar: false, routeComponentKey: "ProgramPlanReplicaPage" },
  { id: "manualOverrides", path: "/projects/:projectId/manual-overrides", label: "Manual Edit Log", iconKey: "History", navGroup: "FINANCE", permissionEntity: "revenue_tracker", showInSidebar: false, routeComponentKey: "ManualOverridesPage" },
  // D4 — per-project finance detail: drill any total to its lines to its source
  // cell. Reached from the reconciliation board / finance home; not in the sidebar.
  { id: "financeProjectDetail", path: "/projects/:projectId/finance", label: "Project Finance", iconKey: "GitCompare", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: false, routeComponentKey: "FinanceProjectDetailPage" },
  { id: "legacyRevenue", path: "/revenue", label: "Revenue (Legacy)", type: "alias", permissionEntity: "revenue_tracker", redirectTo: "/revenue-tracker" },
  { id: "legacyCosControl", path: "/cos-control", label: "COS Control (Legacy)", type: "alias", permissionEntity: "cos", redirectTo: "/cos" },
  { id: "legacyCashflowForecast", path: "/cashflow-forecast", label: "Cashflow Forecast (Legacy)", type: "alias", permissionEntity: "cashflow", redirectTo: "/cashflow" },
  { id: "priorities", path: "/priorities", label: "Priorities", iconKey: "Flag", navGroup: "PRIORITIES", permissionEntity: "company_priorities", accessPolicy: "ungated", showInSidebar: true, routeComponentKey: "PrioritiesPage" },
  // Lineage view MUST be listed BEFORE priorityDetail because wouter's
  // <Switch> matches in source order — the :id wildcard would otherwise
  // swallow /priorities/lineage and render the detail page with id="lineage".
  { id: "priorityLineage", path: "/priorities/lineage", label: "Priority Lineage", permissionEntity: "company_priorities", accessPolicy: "ungated", routeComponentKey: "PriorityLineagePage" },
  { id: "priorityDetail", path: "/priorities/:id", label: "Priority Detail", permissionEntity: "company_priorities", accessPolicy: "ungated", routeComponentKey: "PriorityDetailPage" },
  { id: "companyPriorities", path: "/company-priorities", label: "Company Priorities", type: "alias", permissionEntity: "company_priorities", accessPolicy: "ungated", redirectTo: "/priorities" },
  { id: "adminMyTool", path: "/admin/my-tool-settings", label: "My Work Settings", permissionEntity: "admin", routeComponentKey: "MyWorkAdminSettingsPage" },
  { id: "sharepointIntake", path: "/admin/sharepoint-intake", label: "SharePoint Intake", iconKey: "Cloud", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "SharePointIntakePage" },
  { id: "quality", path: "/quality", label: "Quality", iconKey: "ShieldCheck", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QmDashboardPage", roleLandingEligibility: ["QUALITY_MANAGER"] },
  { id: "qualityDashboardV2", path: "/quality/dashboard", label: "Quality Dashboard (Project)", type: "alias", permissionEntity: "quality", redirectTo: "/quality" },
  // NCR backend is live: ncr_reports is now Drizzle-canonical
  // (shared/schema/quality.ts), the routes in server/quality-ncr-routes.ts
  // are actively maintained and emit audit_events. The DEDICATED UI page
  // has not yet been (re)built; until then, deep links land on the QM
  // dashboard at /quality which surfaces NCR count / severity via the
  // Programme Quality report and (forthcoming) the dashboard tile.
  { id: "qualityNcrList", path: "/quality/ncrs", label: "NCRs (redirects to QM dashboard)", type: "alias", permissionEntity: "quality", showInSidebar: false, redirectTo: "/quality" },
  // NCR detail deep links: forward to /quality with the id preserved
  // as ?ncr=<id> so external bookmarks/email/Teams links don't lose context.
  { id: "qualityNcrDetail", path: "/quality/ncr/:id", label: "NCR Detail (redirects)", permissionEntity: "quality", showInSidebar: false, routeComponentKey: "NcrLegacyRedirect" },
  { id: "engineering", path: "/engineering", label: "Engineering", iconKey: "Wrench", navGroup: "ENGINEERING", permissionEntity: "engineering", showInSidebar: true, routeComponentKey: "EngineeringDashboardPage", roleLandingEligibility: ["ENGINEERING_MANAGER", "ENGINEER"] },
  { id: "engineeringTasks", path: "/engineering/tasks", label: "Engineering Task Board", iconKey: "ListTodo", navGroup: "ENGINEERING", permissionEntity: "eng_tasks", showInSidebar: true, routeComponentKey: "EngineeringTasksPage" },
  { id: "engineeringDocuments", path: "/engineering/documents", label: "Engineering Document Management", iconKey: "FolderTree", navGroup: "ENGINEERING", permissionEntity: "engineering", showInSidebar: true, routeComponentKey: "EngineeringDocumentsPage" },
  { id: "engineeringStandup", path: "/engineering/standup", label: "Engineering Standup", iconKey: "Users", navGroup: "ENGINEERING", permissionEntity: "standups", showInSidebar: true, routeComponentKey: "EngineeringStandupPage" },
  { id: "qualityTasks", path: "/quality/tasks", label: "Quality Task Board", iconKey: "ListTodo", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QualityTasksPage" },
  { id: "qualityDocuments", path: "/quality/documents", label: "Quality Document Management", iconKey: "FolderTree", navGroup: "QUALITY", permissionEntity: "quality", showInSidebar: true, routeComponentKey: "QualityDocumentsPage" },
  { id: "standups", path: "/standups", label: "Standups", type: "alias", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "standups", showInSidebar: false, redirectTo: "/engineering/standup" },
  { id: "engineeringAudit", path: "/engineering/audit", label: "Engineering Audit Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngineeringAuditPage" },
  { id: "lifecycle", path: "/lifecycle-board", label: "Lifecycle Board", iconKey: "Layers", navGroup: "PORTFOLIO", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "LifecycleBoardPage" },
  // PR-B redesign (2026-05-27) — /now is the canonical landing surface
  // that answers "what needs attention right now?". /execution-board
  // stays as the legacy 5-tab dashboard for one transition cycle.
  // role-landing eligibility moved here so executives land on /now.
  { id: "now", path: "/now", label: "Now", iconKey: "Flame", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "NowPage", roleLandingEligibility: ["CEO_ADMIN", "COO_ADMIN", "PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"] },
  // PR-C redesign (2026-05-27) — /my-queue replaces the per-board
  // "My Reviews" scatter pattern. Visible to anyone with execution-
  // board access; rows are filtered server-side to the caller.
  { id: "myQueue", path: "/my-queue", label: "My Queue", iconKey: "Inbox", navGroup: "MY_WORK", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "MyQueuePage" },
  // PR-D redesign (2026-05-27) — /portfolio is the 6-column lens-aware
  // replacement for /projects (50+ columns) and the two milestone
  // trackers. The legacy /projects stays for one cycle so anyone
  // who needs the wide-column drill-down still has it.
  { id: "portfolio", path: "/portfolio", label: "Portfolio", iconKey: "LayoutGrid", navGroup: "PROJECTS", permissionEntity: "execution_board", showInSidebar: true, routeComponentKey: "PortfolioPage" },
  // Execution control tower (replaces the legacy 5-tab /execution-board).
  { id: "executionReview", path: "/execution", label: "Execution", iconKey: "LayoutDashboard", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_review", showInSidebar: true, routeComponentKey: "ExecutionReviewBoardPage" },
  { id: "executionMilestones", path: "/execution/milestones", label: "Milestone Tracker", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_review", showInSidebar: false, routeComponentKey: "ExecutionMilestonesPage" },
  { id: "executionDeliveries", path: "/execution/deliveries", label: "Deliveries", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_review", showInSidebar: false, routeComponentKey: "ExecutionDeliveriesPage" },
  { id: "executionAllocations", path: "/execution/allocations", label: "Allocations", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_review", showInSidebar: false, routeComponentKey: "ExecutionAllocationsPage" },
  { id: "executionSite", path: "/execution/site/:projectId", label: "Site Detail", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_review", showInSidebar: false, routeComponentKey: "ExecutionReviewDetailPage" },
  { id: "smartImport", path: "/admin/smart-import", label: "Smart Import", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "smart_import", showInSidebar: false, routeComponentKey: "SmartImportPage" },
  { id: "adminImportMappings", path: "/admin/import-mappings", label: "Import setup", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "smart_import", showInSidebar: true, routeComponentKey: "AdminImportMappingsPage" },
  // Absorbed into QB Throughput > Suppliers tab — hidden from nav.
  // Routes retained for direct-URL access and embedded rendering by the Throughput page.
  { id: "invoicePatterns", path: "/invoice-patterns", label: "Invoice Patterns", iconKey: "FileSpreadsheet", navGroup: "FINANCE", permissionEntity: "invoice_patterns", showInSidebar: false, routeComponentKey: "InvoicePatternsPage" },
  { id: "counterparties", path: "/counterparties", label: "Counterparties", iconKey: "Building2", navGroup: "FINANCE", permissionEntity: "counterparties", showInSidebar: false, routeComponentKey: "CounterpartiesPage" },
  { id: "subcontractor", path: "/subcontractor-dashboard", label: "Subcontractors", iconKey: "Users", navGroup: "FINANCE", permissionEntity: "subcontractors", showInSidebar: false, routeComponentKey: "SubcontractorDashboardPage" },
  { id: "adminActivity", path: "/admin/activity-log", label: "Activity Log", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "activity_log", showInSidebar: true, routeComponentKey: "SystemActivityLogPage" },
  { id: "weeklyReviews", path: "/weekly-reviews", label: "Weekly Reviews", iconKey: "CalendarCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "weekly_review_wizard", showInSidebar: false, routeComponentKey: "WeeklyReviewsPage" },
  { id: "adminRoles", path: "/admin/roles", label: "Roles & Permissions", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: true, routeComponentKey: "AdminRolesPage" },
  { id: "adminFunctionality", path: "/admin/functionality", label: "Functionality Control", iconKey: "ToggleLeft", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: true, routeComponentKey: "AdminFunctionalityPage" },
  { id: "adminIntegrations", path: "/admin/integrations", label: "Integration Statuses", iconKey: "Plug", navGroup: "SYSTEM", permissionEntity: "admin_roles", showInSidebar: true, routeComponentKey: "AdminIntegrationsPage" },
  { id: "leaderboard", path: "/leaderboard", label: "Leaderboard", iconKey: "Trophy", navGroup: "KNOWLEDGE", permissionEntity: "leaderboard", showInSidebar: false, routeComponentKey: "LeaderboardPage" },
  // Prompt 0.7: Feedback & Support is not actively monitored — hide from
  // sidebar/command palette. Route still resolves for direct access.
  { id: "feedback", path: "/feedback", label: "Feedback & Support", iconKey: "MessageSquareText", navGroup: "KNOWLEDGE", permissionEntity: "feedback", showInSidebar: false, routeComponentKey: "FeedbackPage" },
  { id: "eeInfo", path: "/ee-info", label: "Processes & SOPs", iconKey: "Leaf", navGroup: "KNOWLEDGE", permissionEntity: "ee_info", showInSidebar: false, routeComponentKey: "EeInfoPage" },
  { id: "documents", path: "/documents", label: "Documents", iconKey: "FolderOpen", navGroup: "KNOWLEDGE", permissionEntity: "ee_info", showInSidebar: false, routeComponentKey: "DocumentsPage" },
  { id: "training", path: "/training", label: "Training", iconKey: "GraduationCap", navGroup: "KNOWLEDGE", permissionEntity: "training", showInSidebar: false, routeComponentKey: "TrainingPage" },
  { id: "portfolios", path: "/portfolios", label: "Portfolios", iconKey: "FolderOpen", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "portfolios", showInSidebar: false, routeComponentKey: "PortfoliosPage" },
  { id: "portfolioDetail", path: "/portfolios/:id", label: "Portfolio Detail", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "portfolio_detail", routeComponentKey: "PortfolioDetailPage" },
  // Project Development Dashboard. Path stays at /pd; /engineering-board
  // and /engineering-dashboard remain as harmless URL aliases (task #68
  // reverted the user-visible labels from "Engineering & Quality" back to
  // "Project Development" while keeping the alias paths working).
  { id: "pdDashboard", path: "/pd", label: "Project Development Dashboard", iconKey: "Sun", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: false, routeComponentKey: "PdDashboardPage", aliases: ["/pd/dashboard", "/engineering-board", "/engineering-dashboard"], roleLandingEligibility: ["CCO", "KEY_ACCOUNTS_MANAGER", "PROJECT_DEVELOPER"] },
  // Legacy ticket deep links → redirect to Opportunities so existing bookmarks/emails still resolve.
  { id: "pdTicketsRedirect", path: "/pd/tickets", label: "Project Development Tickets (moved)", type: "alias", permissionEntity: "pd_dashboard", redirectTo: "/opportunities" },
  { id: "pdTicketCreateRedirect", path: "/pd/tickets/create", label: "Create Ticket (moved)", type: "alias", permissionEntity: "pd_dashboard", redirectTo: "/opportunities" },
  { id: "pdTicketDetailRedirect", path: "/pd/tickets/:id", label: "Ticket Detail (moved)", type: "alias", permissionEntity: "pd_dashboard", redirectTo: "/opportunities" },
  { id: "pdReportsRedirect", path: "/pd/reports", label: "PD Reports (moved)", type: "alias", permissionEntity: "pd_dashboard", redirectTo: "/opportunities" },
  { id: "teamsChats", path: "/teams/chats", label: "Teams Chat", type: "alias", permissionEntity: "teams_chat", redirectTo: "/my-work/teams" },
  { id: "collaboration", path: "/collaboration", label: "Collaboration Hub", type: "alias", permissionEntity: "collaboration_hub", redirectTo: "/my-work" },
  { id: "collabEmail", path: "/collaboration/email", label: "Collaboration Email", type: "alias", permissionEntity: "collaboration_hub", redirectTo: "/my-work/email" },
  { id: "collabTeams", path: "/collaboration/teams", label: "Collaboration Teams", type: "alias", permissionEntity: "teams_chat", redirectTo: "/my-work/teams" },
  { id: "pmDashboard", path: "/pm-dashboard", label: "PM Dashboard", iconKey: "User", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_dashboard", showInSidebar: false, routeComponentKey: "PMDashboard" },
  { id: "pmOnTheGo", path: "/pm/on-the-go", label: "PM On-The-Go", iconKey: "Smartphone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pm_on_the_go", showInSidebar: false, routeComponentKey: "PMOnTheGoHome" },
  { id: "pmOnTheGoProject", path: "/pm/on-the-go/project/:projectId", label: "On-The-Go Project", permissionEntity: "pm_on_the_go", routeComponentKey: "PMOnTheGoProject" },
  { id: "myWork", path: "/my-work", label: "My Work", iconKey: "Home", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "MyWorkHomePage", matchSubRoutes: true },
  { id: "inbox", path: "/inbox", label: "Inbox", iconKey: "Inbox", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: true, routeComponentKey: "InboxPage" },
  { id: "myWorkCalendar", path: "/my-work/calendar", label: "Calendar", iconKey: "CalendarCheck", navGroup: "MY_WORK", permissionEntity: "my_work", showInSidebar: true, routeComponentKey: "MyWorkCalendarPage" },
  // Phase 7B: showInSidebar flipped to false. Page stays routable for
  // bookmarks + the transition banner that points at /priorities?tab=my.
  // The MY_WORK sidebar no longer renders a "Tasks" entry — users go to
  // Home → Priorities → "My" tab for unified work_items + priorities.
  { id: "myWorkTasks", path: "/my-work/tasks", label: "Tasks", iconKey: "ListChecks", navGroup: "MY_WORK", permissionEntity: "my_tool", showInSidebar: false, routeComponentKey: "MyWorkTasksPage" },
  // Prompt 0.7: duplicate approvals entry point. Canonical approvals surface
  // is `/pm/approvals` (kept in TOP_SECTIONS). Route remains as a redirect
  // alias so deep links still resolve.
  { id: "myWorkApprovals", path: "/my-work/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "MY_WORK", type: "alias", permissionEntity: "my_work", showInSidebar: false, redirectTo: "/my-work/tasks?source=approvals" },
  { id: "myWorkMeetings", path: "/my-work/meetings", label: "Meetings", iconKey: "MessageSquareText", navGroup: "MY_WORK", permissionEntity: "meetings", showInSidebar: true, routeComponentKey: "MyWorkMeetingsPage" },
  { id: "myWorkEmail", path: "/my-work/email", label: "Email", iconKey: "Mail", navGroup: "MY_WORK", permissionEntity: "collaboration_hub", showInSidebar: false, routeComponentKey: "CollabEmailPage" },
  { id: "myWorkTeams", path: "/my-work/teams", label: "Teams Chat", iconKey: "MessagesSquare", navGroup: "MY_WORK", permissionEntity: "teams_chat", showInSidebar: true, routeComponentKey: "TeamsChatsPage" },
  { id: "myWorkSettings", path: "/my-work/settings", label: "Settings", iconKey: "Settings", navGroup: "MY_WORK", permissionEntity: "home", showInSidebar: false, routeComponentKey: "MyWorkSettingsPage" },
  { id: "adminDatabaseMigration", path: "/admin/database-migration", label: "Database Migration", permissionEntity: "database_migration", routeComponentKey: "DatabaseMigrationPage" },
  { id: "adminKpiTraceability", path: "/admin/kpi-traceability", label: "KPI Traceability", iconKey: "Activity", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "KpiTraceabilityPage" },
  { id: "adminImportControlTower", path: "/admin/import-control-tower", label: "Import Control Tower", iconKey: "FileSpreadsheet", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "ImportControlTowerPage" },
  { id: "programWideAssessment", path: "/reports/program-wide-assessment", label: "Program-wide Assessment", iconKey: "GitCompare", navGroup: "REPORTS", permissionEntity: "excel_vs_app", showInSidebar: false, routeComponentKey: "ProgramWideAssessmentPage" },
  { id: "programmeReports", path: "/reports/programme", label: "Programme Reports", iconKey: "FileSpreadsheet", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "ProgrammeReportsPage" },
  { id: "reportCenter", path: "/reports/center", label: "Report Center", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "ReportCenterPage" },
  { id: "performanceDashboard", path: "/reports/performance", label: "Performance", iconKey: "BarChart3", navGroup: "REPORTS", permissionEntity: "performance", showInSidebar: false, routeComponentKey: "PerformancePage" },
  { id: "pmMonthlyReport", path: "/reports/pm/monthly", label: "PM Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "PmMonthlyReportPage" },
  { id: "pmMonthlyReportHistory", path: "/reports/pm/monthly/history", label: "PM Report History", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "PmMonthlyReportHistoryPage" },
  { id: "pmMonthlyReportCompare", path: "/reports/pm/monthly/compare", label: "PM Report Compare", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportComparePage" },
  { id: "pmMonthlyReportProject", path: "/reports/pm/monthly/:month/project/:projectId", label: "PM Report Project", permissionEntity: "reports", routeComponentKey: "PmMonthlyReportProjectPage" },
  { id: "engMonthlyReport", path: "/reports/engineering/monthly", label: "Engineering Monthly Report", iconKey: "FileText", navGroup: "REPORTS", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "EngMonthlyReportPage" },
  { id: "engMonthlyReportHistory", path: "/reports/engineering/monthly/history", label: "Engineering Report History", permissionEntity: "reports", showInSidebar: false, routeComponentKey: "EngMonthlyReportHistoryPage" },
  { id: "engMonthlyReportCompare", path: "/reports/engineering/monthly/compare", label: "Engineering Report Compare", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportComparePage" },
  { id: "engMonthlyReportProject", path: "/reports/engineering/monthly/:month/project/:projectId", label: "Engineering Report Project", permissionEntity: "reports", routeComponentKey: "EngMonthlyReportProjectPage" },
  { id: "adminRecovery", path: "/admin/recovery", label: "Recovery Center", iconKey: "ShieldAlert", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminRecoveryPage" },
  { id: "stageAdmin", path: "/admin/stage-lifecycle", label: "Stage Lifecycle", iconKey: "Milestone", navGroup: "SYSTEM", permissionEntity: "stage_admin", showInSidebar: false, routeComponentKey: "StageAdminPage" },
  // Task #101: Control Center page retired in favour of /admin/roles tabs.
  // The redirect lives in the legacy redirects block above so old bookmarks
  // land on the new home.
  // { id: "adminControlCenter", path: "/admin/control-center", ... }
  { id: "clientProjectDepartments", path: "/clients/:clientId/project/:projectId", label: "Project Departments", permissionEntity: "pd_clients", routeComponentKey: "ClientProjectDepartmentsPage" },
  { id: "clientDetail", path: "/clients/:clientId", label: "Client Detail", permissionEntity: "pd_clients", routeComponentKey: "ClientDetailPage" },
  { id: "clients", path: "/clients", label: "Clients", iconKey: "Users", navGroup: "PROJECTS", permissionEntity: "pd_clients", showInSidebar: false, routeComponentKey: "ClientsPage", aliases: ["/pd/clients"] },
  { id: "actionLaunchpad", path: "/actions/launchpad", label: "Quick Create", permissionEntity: "work_items", routeComponentKey: "ActionLaunchpadPage" },
  // Active version: pd-pm-handover-v2.tsx. v1 removed 2026-03-31.
  { id: "pdPmHandover", path: "/pd/handover/:projectId", label: "PD to PM Handover", permissionEntity: "handover", routeComponentKey: "PdPmHandoverPage" },
  { id: "pmHandoverReview", path: "/pm/handover-review", label: "PM Handover Review", permissionEntity: "handover", routeComponentKey: "PmHandoverReviewPage" },
  { id: "financialReviewQueue", path: "/governance/financial-reviews", label: "Financial Review Queue", iconKey: "DollarSign", navGroup: "FINANCE", permissionEntity: "approvals", showInSidebar: false, routeComponentKey: "FinancialReviewQueuePage" },
  { id: "pmApprovals", path: "/pm/approvals", label: "Approvals", iconKey: "ClipboardCheck", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "approvals", showInSidebar: false, routeComponentKey: "ApprovalsPage" },
  { id: "pmDeliverables", path: "/pm/deliverables", label: "PM Deliverables (Retired)", type: "alias", permissionEntity: "deliverables", redirectTo: "/pm/approvals" },
  { id: "handoverControl", path: "/handover-control", label: "Handover Control", iconKey: "Handshake", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "HandoverControlPage" },
  // Task Management removed from Project Delivery navigation
  { id: "phaseTemplates", path: "/admin/phase-templates", label: "Phase Templates", iconKey: "ListChecks", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "PhaseTemplatesPage" },
  { id: "projectCreate", path: "/project-create", label: "Create Project", permissionEntity: "project_creation", routeComponentKey: "ProjectCreatePage" },
  { id: "departmentScores", path: "/department-scores", label: "Department Scores", iconKey: "BarChart3", navGroup: "KNOWLEDGE", type: "alias", permissionEntity: "leaderboard", showInSidebar: false, routeComponentKey: "DepartmentScoresPage", redirectTo: "/leaderboard?tab=departments" },
  { id: "engTemplateAdmin", path: "/admin/eng-templates", label: "Engineering Templates", iconKey: "FileText", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "EngTemplateAdminPage" },
  { id: "commandCenter", path: "/command-center", label: "Command Center", type: "alias", permissionEntity: "home", redirectTo: "/my-work" },
  // New entity pages (Phase B)
  { id: "sites", path: "/sites", label: "Sites", iconKey: "MapPin", navGroup: "PROJECTS", permissionEntity: "projects", showInSidebar: false, routeComponentKey: "SitesPage" },
  { id: "opportunities", path: "/opportunities", label: "Opportunities", iconKey: "TrendingUp", navGroup: "PROJECT_DEVELOPMENT", permissionEntity: "pd_dashboard", showInSidebar: false, routeComponentKey: "OpportunitiesPage" },
  { id: "procurementDashboard", path: "/procurement", label: "Procurement", type: "alias", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: false, redirectTo: "/execution" },
  // EPC Workflow Phase 1
  { id: "poApprovalBoard", path: "/po-approval-board", label: "PO Approvals", iconKey: "FileText", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "procurement", showInSidebar: false, routeComponentKey: "POApprovalBoardPage" },
  { id: "paymentRequestBoard", path: "/payment-request-board", label: "Payment Requests", iconKey: "CreditCard", navGroup: "FINANCE", permissionEntity: "procurement", showInSidebar: false, routeComponentKey: "PaymentRequestBoardPage" },
  { id: "paymentBatchManager", path: "/payment-batch-manager", label: "Payment Batches", iconKey: "Wallet", navGroup: "FINANCE", permissionEntity: "procurement", showInSidebar: false, routeComponentKey: "PaymentBatchManagerPage" },
  { id: "hseDashboard", path: "/hse", label: "Health, Safety & Environment", iconKey: "ShieldAlert", navGroup: "HSE", permissionEntity: "hse", showInSidebar: false, routeComponentKey: "HseDashboardPage", roleLandingEligibility: ["HSE_MANAGER", "SSEG_MANAGER"] },
  { id: "hseCompliance", path: "/hse/compliance", label: "Compliance / SSEG", type: "alias", redirectTo: "/hse?tab=compliance", navGroup: "HSE", permissionEntity: "hse_compliance", showInSidebar: false },
  { id: "handoverDashboard", path: "/handover", label: "Handover & Closeout", iconKey: "Handshake", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "HandoverDashboardPage" },
  { id: "ssegSubmissions", path: "/sseg-submissions", label: "SSEG Submissions", iconKey: "ClipboardList", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "hse_sseg", showInSidebar: false, routeComponentKey: "SsegSubmissionsPage" },
  // PD-PM Handover V2 extensions
  { id: "lessonsLearnt", path: "/admin/lessons", label: "Lessons Learnt", iconKey: "BookOpen", navGroup: "SYSTEM", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "LessonsLearntPage" },
  { id: "handoverHealth", path: "/admin/handover-health", label: "Handover Health Score", iconKey: "Handshake", navGroup: "SYSTEM", permissionEntity: "handover", showInSidebar: false, routeComponentKey: "HandoverControlPage" },
  // Admin integration pages (Phase D)
  { id: "adminSettings", path: "/admin/settings", label: "System Settings", iconKey: "Settings", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "RoleSettingsPage" },
  { id: "adminWorkflowConfig", path: "/admin/workflow-config", label: "Workflow Configuration", iconKey: "Workflow", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminWorkflowConfigPage" },
  { id: "adminBackfill", path: "/admin/data-migration-status", label: "Data Migration Status", iconKey: "Database", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminBackfillPage" },
  { id: "adminWorkItemLinkage", path: "/admin/work-item-linkage", label: "Work Item Linkage", iconKey: "Link", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminWorkItemLinkagePage" },
  { id: "adminPipedrive", path: "/admin/pipedrive", label: "Pipedrive Integration", iconKey: "Plug", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminPipedrivePage" },
  { id: "adminQuickBooks", path: "/admin/quickbooks", label: "QuickBooks Integration", iconKey: "Plug", navGroup: "SYSTEM", permissionEntity: "admin", showInSidebar: false, routeComponentKey: "AdminQuickBooksPage" },
  // Absorbed into QB Throughput > Mapping / Reconciliation tabs — hidden from nav.
  // Routes retained for direct-URL access and embedded rendering by the Throughput page.
  { id: "financeQuickBooksCustomerMapping", path: "/finance/quickbooks-customer-mapping", label: "QB Customer Mapping", iconKey: "Users", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: false, routeComponentKey: "FinanceQuickBooksCustomerMappingPage" },
  { id: "financeQuickBooksLinks", path: "/finance/quickbooks-links", label: "QB Bill Linking", iconKey: "Plug", navGroup: "FINANCE", permissionEntity: "financials", showInSidebar: false, routeComponentKey: "FinanceQuickBooksLinksPage" },
  // Gates workspace (Prompt 2)
  { id: "gatesPipeline", path: "/gates", label: "Gates Pipeline", iconKey: "Milestone", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesPipelinePage" },
  { id: "gatesBlocked", path: "/gates/blocked", label: "Blocked Gates", iconKey: "ShieldAlert", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesBlockedPage" },
  { id: "gatesReady", path: "/gates/ready", label: "Ready Gates", iconKey: "CheckCircle", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesReadyPage" },
  { id: "gatesExceptions", path: "/gates/exceptions", label: "Gate Exceptions", iconKey: "AlertTriangle", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesExceptionsPage" },
  { id: "gatesClientUpdates", path: "/gates/client-updates", label: "Client Updates", iconKey: "CalendarCheck", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesClientUpdatesPage" },
  { id: "gatesHandovers", path: "/gates/handovers", label: "Handover Queue", iconKey: "Handshake", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesHandoversPage" },
  { id: "gatesQueries", path: "/gates/queries", label: "Open Queries", iconKey: "MessageSquare", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesQueriesPage" },
  { id: "gatesCommitments", path: "/gates/commitments", label: "Client Commitments", iconKey: "Handshake", navGroup: "GATES", permissionEntity: "lifecycle", showInSidebar: false, routeComponentKey: "GatesCommitmentsPage" },
  // Revenue Milestone Tracker — standalone page for Construction Manager.
  // The page surfaces billing-side milestones (invoiced / in bank), not
  // site delivery progress. Label and description updated to avoid
  // confusion with delivery milestones.
  // Retired surface — kept only so /milestone-tracker resolves to a redirect to
  // the Execution board. Hidden from the sidebar.
  { id: "milestoneTracker", path: "/milestone-tracker", label: "Revenue Milestones", iconKey: "Milestone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "execution_board", showInSidebar: false, routeComponentKey: "MilestoneTrackerPage" },
  // Wave-4 audit (2026-05-26) — site delivery milestones split out of
  // the billing tracker. Permission `pd_delivery_milestones` is in the
  // registry; this page lists all active projects with their delivery
  // milestones grouped per project.
  { id: "deliveryMilestones", path: "/delivery-milestones", label: "Delivery Milestones", iconKey: "Milestone", navGroup: "PROJECT_MANAGEMENT", permissionEntity: "pd_delivery_milestones", showInSidebar: true, routeComponentKey: "DeliveryMilestonesPage" },
  { id: "commissioningOverview", path: "/commissioning-dashboard", label: "Commissioning", iconKey: "Shield", navGroup: "QUALITY", permissionEntity: "commissioning", showInSidebar: false, routeComponentKey: "CommissioningDashboardPage" },
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
  const normalizedPath = normalizePathname(pathname);
  const sorted = [...PAGE_REGISTRY].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((page) => matchesPagePath(page, normalizedPath));
}

function normalizePathname(input: string): string {
  const [withoutHash] = input.split("#");
  const [withoutQuery] = withoutHash.split("?");
  if (!withoutQuery) return "/";
  const normalized = withoutQuery.trim().toLowerCase();
  if (normalized === "") return "/";
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function getPermissionEntityForPath(pathname: string): PermissionEntity | undefined {
  return findPageByPath(pathname)?.permissionEntity;
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
const NAV_GROUP_TO_SECTION: Record<NavGroupKey, SectionKey> = {
  MY_WORK: "HOME",
  PROJECTS: "PROJECT_DELIVERY",
  PROJECT_DEVELOPMENT: "PROJECT_DEVELOPMENT",
  PROJECT_MANAGEMENT: "PROJECT_DELIVERY",
  ENGINEERING: "ENGINEERING",
  QUALITY: "QUALITY",
  HSE: "HSE",
  GATES: "PORTFOLIO",
  FINANCE: "FINANCE",
  // KNOWLEDGE is the historical nav-group key for company-knowledge surfaces
  // (Processes & SOPs, Training, Leaderboard, Feedback). They live inside the
  // user-facing "Admin" top section so power users / admins maintain them
  // alongside system tools — see ADMIN_NAV_ITEMS for the surfaced list.
  KNOWLEDGE: "ADMIN",
  PRIORITIES: "PRIORITIES",
  PORTFOLIO: "PORTFOLIO",
  REPORTS: "REPORTS",
  SYSTEM: "ADMIN",
};

// Backward compatibility for older tests/modules.
export const PAGES = PAGE_REGISTRY;

export function getAppSectionForPath(pathname: string): SectionKey | undefined {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === "/") return "HOME";

  const match = findPageByPath(normalizedPath);
  if (!match?.navGroup) return undefined;
  return NAV_GROUP_TO_SECTION[match.navGroup];
}

export function getRouteAccessPolicyForPath(pathname: string): "protected" | "public" | "ungated" | "unknown" {
  const page = findPageByPath(pathname);
  if (!page) return "unknown";
  return page.accessPolicy ?? "protected";
}

function matchesPattern(pathname: string, pattern: string): boolean {
  const routePath = normalizePathname(pattern);
  const pathParts = pathname.split("/").filter(Boolean);
  const routeParts = routePath.split("/").filter(Boolean);

  if (pathParts.length !== routeParts.length) return false;

  for (let i = 0; i < routeParts.length; i += 1) {
    const routePart = routeParts[i];
    const pathPart = pathParts[i];
    if (routePart.startsWith(":")) continue;
    if (routePart !== pathPart) return false;
  }
  return true;
}

function matchesPagePath(page: PageRegistryEntry, normalizedPath: string): boolean {
  const pagePath = normalizePathname(page.path);
  if (normalizedPath === pagePath) return true;

  if (page.aliases?.some((alias) => {
    const normalizedAlias = normalizePathname(alias);
    if (normalizedAlias === normalizedPath) return true;
    if (alias.includes(":") && matchesPattern(normalizedPath, alias)) return true;
    if (page.matchSubRoutes && alias.includes(":")) {
      const aliasParts = normalizedAlias.split("/").filter(Boolean);
      const pathParts = normalizedPath.split("/").filter(Boolean);
      if (pathParts.length > aliasParts.length) {
        const prefix = "/" + pathParts.slice(0, aliasParts.length).join("/");
        if (matchesPattern(prefix, alias)) return true;
      }
    }
    if (page.matchSubRoutes && normalizedPath.startsWith(`${normalizedAlias}/`)) return true;
    return false;
  })) {
    return true;
  }

  if (page.path.includes(":") && matchesPattern(normalizedPath, page.path)) {
    return true;
  }

  return Boolean(page.matchSubRoutes && (normalizedPath === pagePath || normalizedPath.startsWith(`${pagePath}/`)));
}
