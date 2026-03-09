import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProgramProvider } from "@/hooks/use-program-data";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NetworkStatus } from "@/components/NetworkStatus";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/login";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import ProjectsSummary from "@/pages/projects";
import CashflowPage from "@/pages/cashflow";
import RevenueTracker from "@/pages/revenue";
import RevenueTrackerPage from "@/pages/revenue-tracker";
import CostTracker from "@/pages/cos";
import GpTrackerPage from "@/pages/gp-tracker";
import NotFound from "@/pages/not-found";
import ProjectDetailPage from "@/pages/project-detail";
import AdminPage from "@/pages/admin";
import MyToolTodayPage from "@/pages/my-tool-today";
import MyToolWeekPage from "@/pages/my-tool-week";
import MyToolBacklogPage from "@/pages/my-tool-backlog";
import MyToolSettingsPage from "@/pages/my-tool-settings";
import MyToolAdminSettingsPage from "@/pages/my-tool-admin-settings";
import MyToolHelpPage from "@/pages/my-tool-help";
import MyToolPrioritiesPage from "@/pages/my-tool-priorities";
import MyToolMeetingsPage from "@/pages/my-tool-meetings";
import QmDashboardPage from "@/pages/qm-dashboard";
import EngineeringDashboardPage from "@/pages/engineering-dashboard";
import EngineeringTasksPage from "@/pages/engineering-tasks";
import RoleSettingsPage from "@/pages/role-settings";
import LifecycleBoardPage from "@/pages/lifecycle-board";
import ExecutionBoardPage from "@/pages/execution-board";
import SmartImportPage from "@/pages/smart-import";
import InvoicePatternsPage from "@/pages/invoice-patterns";
import SubcontractorDashboardPage from "@/pages/subcontractor-dashboard";
import SystemActivityLogPage from "@/pages/system-activity-log";
import WeeklyReviewsPage from "@/pages/weekly-reviews";
import AdminRolesPage from "@/pages/admin-roles";
import LeaderboardPage from "@/pages/leaderboard";
import FeedbackPage from "@/pages/feedback";
import EeInfoPage from "@/pages/ee-info";
import PMDashboard from "@/pages/pm-dashboard";
import ExcelUpdatesPage from "@/pages/excel-updates";
import PortfoliosPage from "@/pages/portfolios";
import PortfolioDetailPage from "@/pages/portfolio-detail";
import PdDashboardPage from "@/pages/pd-dashboard";
import PdTicketsPage from "@/pages/pd-tickets";
import PdTicketCreatePage from "@/pages/pd-ticket-create";
import PdTicketDetailPage from "@/pages/pd-ticket-detail";
import MsCallbackPage from "@/pages/ms-callback";
import TeamsChatsPage from "@/pages/teams-chats";
import CollaborationPage from "@/pages/collaboration";
import CollabEmailPage from "@/pages/collab-email";
import CollabTeamsPage from "@/pages/collab-teams";
import FinancialLinkingPage from "@/pages/financial-linking";
import PMOnTheGoHome from "@/pages/pm-on-the-go-home";
import PMOnTheGoProject from "@/pages/pm-on-the-go-project";
import MyWorkHomePage from "@/pages/my-work-home";
import MyWorkTasksPage from "@/pages/my-work-tasks";
import MyWorkCalendarPage from "@/pages/my-work-calendar";
import ApprovalsPage from "@/pages/admin-approvals";
import DatabaseMigrationPage from "@/pages/database-migration";
import ClientsPage from "@/pages/clients";
import ImportControlTowerPage from "@/pages/import-control-tower";
import KpiTraceabilityPage from "@/pages/kpi-traceability";
import AdminRecoveryPage from "@/pages/admin-recovery";
import CommandCenterPage from "@/pages/command-center";
import AdminControlCenterPage from "@/pages/admin-control-center";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, type PermissionEntity } from "@shared/schema";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const ROUTE_TO_ENTITY: Record<string, PermissionEntity> = {
  "/dashboard": "execution_board",
  "/cashflow": "cashflow",
  "/cos": "cos",
  "/revenue-tracker": "revenue_tracker",
  "/gp-tracker": "gp_tracker",
  "/revenue": "revenue",
  "/subcontractor-dashboard": "subcontractors",
  "/engineering": "engineering",
  "/engineering/tasks": "eng_tasks",
  "/quality": "quality",
  "/pd": "pd_dashboard",
  "/pd/tickets": "pd_tickets",
  "/clients": "pd_clients",
  "/lifecycle-board": "lifecycle",
  "/projects": "projects",
  "/portfolios": "portfolios",
  "/pm-dashboard": "pm_dashboard",
  "/pm/on-the-go": "pm_on_the_go",
  "/weekly-reviews": "weekly_review_wizard",
  "/smart-import": "smart_import",
  "/excel-updates": "excel_updates",
  "/invoice-patterns": "invoice_patterns",
  "/ee-info": "ee_info",
  "/feedback": "feedback",
  "/leaderboard": "leaderboard",
  "/company-priorities": "company_priorities",
  "/my-work": "home",
  "/my-work/tasks": "my_tool",
  "/my-work/approvals": "my_work",
  "/my-work/calendar": "my_work",
  "/my-work/meetings": "meetings",
  "/my-work/email": "collaboration_hub",
  "/my-work/teams": "teams_chat",
  "/collaboration": "collaboration_hub",
  "/collaboration/email": "collaboration_hub",
  "/collaboration/teams": "teams_chat",
  "/teams/chats": "teams_chat",
  "/my-tool": "my_tool",
  "/execution-board": "execution_board",
  "/admin/database-migration": "database_migration",
  "/admin/my-tool-settings": "admin",
  "/admin/activity-log": "activity_log",
  "/admin/roles": "admin_roles",
  "/admin/settings": "admin",
  "/admin/kpi-traceability": "admin",
  "/admin/import-control-tower": "admin",
  "/admin/recovery": "admin",
  "/admin/control-center": "admin",
  "/command-center": "home",
};

const EPM_ALLOWED_PATHS = ["/", "/command-center", "/engineering", "/engineering/tasks", "/quality", "/projects", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams"];
const PM_ALLOWED_PATHS = ["/", "/command-center", "/pm-dashboard", "/pm/on-the-go", "/projects", "/engineering", "/engineering/tasks", "/quality", "/cashflow", "/cos", "/gp-tracker", "/revenue-tracker", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams"];

type RouteConfig = { path: string; component?: React.ComponentType<any>; redirectTo?: string };

const ROLE_LANDING_PAGE: Record<string, string> = {
  PROJECT_MANAGER_SITE: "/pm-dashboard",
  quality_manager: "/quality",
  eng_program_manager: "/engineering",
};

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

const APP_ROUTES: RouteConfig[] = [
  { path: "/dashboard", component: Dashboard },
  { path: "/projects", component: ProjectsSummary },
  { path: "/project/:projectName/financial-linking", component: FinancialLinkingPage },
  { path: "/project/:projectName", component: ProjectDetailPage },
  { path: "/cashflow", component: CashflowPage },
  { path: "/revenue", component: RevenueTracker },
  { path: "/cos", component: CostTracker },
  { path: "/revenue-tracker", component: RevenueTrackerPage },
  { path: "/gp-tracker", component: GpTrackerPage },
  { path: "/my-tool", component: MyToolTodayPage },
  { path: "/my-tool/week", component: MyToolWeekPage },
  { path: "/my-tool/backlog", component: MyToolBacklogPage },
  { path: "/my-tool/settings", component: MyToolSettingsPage },
  { path: "/company-priorities", component: MyToolPrioritiesPage },
  { path: "/my-tool/help", component: MyToolHelpPage },
  { path: "/admin", component: AdminPage },
  { path: "/admin/my-tool-settings", component: MyToolAdminSettingsPage },
  { path: "/quality", component: QmDashboardPage },
  { path: "/engineering", component: EngineeringDashboardPage },
  { path: "/engineering/tasks", component: EngineeringTasksPage },
  { path: "/lifecycle-board", component: LifecycleBoardPage },
  { path: "/execution-board", component: ExecutionBoardPage },
  { path: "/my-tool/meetings", component: MyToolMeetingsPage },
  { path: "/admin/settings", component: RoleSettingsPage },
  { path: "/smart-import", component: SmartImportPage },
  { path: "/invoice-patterns", component: InvoicePatternsPage },
  { path: "/subcontractor-dashboard", component: SubcontractorDashboardPage },
  { path: "/admin/activity-log", component: SystemActivityLogPage },
  { path: "/weekly-reviews", component: WeeklyReviewsPage },
  { path: "/admin/roles", component: AdminRolesPage },
  { path: "/leaderboard", component: LeaderboardPage },
  { path: "/tr-register", redirectTo: "/my-work/tasks" },
  { path: "/feedback", component: FeedbackPage },
  { path: "/ee-info", component: EeInfoPage },
  { path: "/pm-dashboard", component: PMDashboard },
  { path: "/excel-updates", component: ExcelUpdatesPage },
  { path: "/portfolios", component: PortfoliosPage },
  { path: "/portfolios/:id", component: PortfolioDetailPage },
  { path: "/pd", component: PdDashboardPage },
  { path: "/pd/tickets", component: PdTicketsPage },
  { path: "/pd/tickets/create", component: PdTicketCreatePage },
  { path: "/pd/tickets/:id", component: PdTicketDetailPage },
  { path: "/settings/integrations", redirectTo: "/admin/settings" },
  { path: "/admin/ms-integration", redirectTo: "/admin/settings" },
  { path: "/teams/chats", component: TeamsChatsPage },
  { path: "/admin/ms-mapping", redirectTo: "/admin/settings" },
  { path: "/collaboration", component: CollaborationPage },
  { path: "/collaboration/email", component: CollabEmailPage },
  { path: "/collaboration/teams", component: CollabTeamsPage },
  { path: "/pm/on-the-go", component: PMOnTheGoHome },
  { path: "/pm/on-the-go/project/:projectId", component: PMOnTheGoProject },
  { path: "/my-work", component: MyWorkHomePage },
  { path: "/my-work/calendar", component: MyWorkCalendarPage },
  { path: "/my-work/tasks", component: MyWorkTasksPage },
  { path: "/my-work/approvals", component: ApprovalsPage },
  { path: "/my-work/meetings", component: MyToolMeetingsPage },
  { path: "/my-work/email", component: CollabEmailPage },
  { path: "/my-work/teams", component: TeamsChatsPage },
  { path: "/admin/database-migration", component: DatabaseMigrationPage },
  { path: "/admin/kpi-traceability", component: KpiTraceabilityPage },
  { path: "/admin/import-control-tower", component: ImportControlTowerPage },
  { path: "/admin/recovery", component: AdminRecoveryPage },
  { path: "/admin/control-center", component: AdminControlCenterPage },
  { path: "/command-center", component: CommandCenterPage },
  { path: "/clients", component: ClientsPage },
];


function AccessDenied() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground">You don't have permission to view this page. Contact your administrator if you need access.</p>
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </a>
      </div>
    </div>
  );
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const navMode = isMobile ? NAVIGATION_MODE.mobile : NAVIGATION_MODE.desktop;

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;

  if (process.env.NODE_ENV !== "production") {
    (window as any).__navMode = navMode;
  }

  const { data: permissions } = useQuery<{ role?: string; entityPermissions?: Record<string, Record<string, boolean>> | null }>({
    queryKey: ["auth-permissions", user?.role],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (user?.role) headers["x-company-role"] = user.role;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!user?.role,
    staleTime: 60_000,
  });

  if (companyRole === "PROJECT_MANAGER_SITE") {
    const allowed = PM_ALLOWED_PATHS.some(p =>
      p === location || (p === "/projects" && location.startsWith("/project/")) || (p === "/pm/on-the-go" && location.startsWith("/pm/on-the-go"))
    );
    if (!allowed) {
      return <Redirect to="/pm-dashboard" />;
    }
  }

  if (user?.role === "eng_program_manager") {
    const allowed = EPM_ALLOWED_PATHS.some(p => 
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
  }

  if (user?.role === "quality_manager") {
    const qmAllowed = ["/", "/command-center", "/quality", "/projects", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams"];
    const allowed = qmAllowed.some(p => 
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
  }

  const ADMIN_COMPANY_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
  const hasAdminAccess = user?.role === "admin" || (companyRole && ADMIN_COMPANY_ROLES.includes(companyRole));
  if (!hasAdminAccess && location.startsWith("/admin")) {
    return <Redirect to="/" />;
  }

  const entity = ROUTE_TO_ENTITY[location] || (() => {
    const sorted = Object.keys(ROUTE_TO_ENTITY).sort((a, b) => b.length - a.length);
    const match = sorted.find(p => location.startsWith(p + "/") || location === p);
    return match ? ROUTE_TO_ENTITY[match] : undefined;
  })();
  if (entity && user?.role) {
    const ep = permissions?.entityPermissions;
    let hasView = true;
    if (ep && ep[entity]) {
      hasView = ep[entity]["view"] === true;
    } else {
      hasView = checkPermission(user.role, entity, "view");
    }
    if (!hasView) {
      return <AccessDenied />;
    }
  }

  return <>{children}</>;
}

function ProtectedPages() {
  return (
    <RoleGuard>
    <AppLayout>
      <Switch>
        <Route path="/">{() => {
          const role = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
          const landingPath = role ? ROLE_LANDING_PAGE[role] : undefined;
          if (landingPath) return <Redirect to={landingPath} />;
          return <Home />;
        }}</Route>
        {APP_ROUTES.map((route) => {
          if (route.redirectTo) {
            return <Route key={route.path} path={route.path}>{() => <Redirect to={route.redirectTo!} />}</Route>;
          }
          return <Route key={route.path} path={route.path} component={route.component!} />;
        })}
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
    </RoleGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={LoginPage} />
      <Route path="/auth/ms-callback" component={MsCallbackPage} />
      <Route>
        <ProtectedRoute>
          <ProtectedPages />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProgramProvider>
            <NetworkStatus />
            <Router />
            <Toaster />
          </ProgramProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
