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
import KnowledgeGamePage from "@/pages/knowledge-game";
import DepartmentScoresPage from "@/pages/department-scores";
import TrainingPage from "@/pages/training";
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
import ActionLaunchpadPage from "@/pages/action-launchpad";
import PdPmHandoverPage from "@/pages/pd-pm-handover";
import PmHandoverReviewPage from "@/pages/pm-handover-review";
import HandoverControlPage from "@/pages/handover-control";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions } from "@shared/schema";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PAGE_REGISTRY, ROLE_LANDING_PAGE, getPermissionEntityForPath } from "@/config/page-registry";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { logRoleAwareInteraction } from "@/lib/role-aware-audit";
import { pickRoleAwareLandingPage } from "@/config/role-aware-ux";
import { isSuperAdmin } from "@/lib/access-control";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";

const EPM_ALLOWED_PATHS = ["/", "/engineering", "/engineering/tasks", "/quality", "/projects", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams", "/my-tool", "/my-tool/week", "/my-tool/backlog", "/my-tool/settings", "/my-tool/help", "/my-tool/meetings"];
const PM_ALLOWED_PATHS = ["/", "/pm-dashboard", "/pm/on-the-go", "/projects", "/engineering", "/engineering/tasks", "/quality", "/cashflow", "/cos", "/gp-tracker", "/revenue-tracker", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams", "/my-tool", "/my-tool/week", "/my-tool/backlog", "/my-tool/settings", "/my-tool/help", "/my-tool/meetings"];

type RouteConfig = { path: string; component?: React.ComponentType<any>; redirectTo?: string };

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

const ROUTE_COMPONENTS: Record<string, React.ComponentType<any>> = {
  Dashboard,
  ProjectsSummary,
  FinancialLinkingPage,
  ProjectDetailPage,
  CashflowPage,
  RevenueTracker,
  CostTracker,
  RevenueTrackerPage,
  GpTrackerPage,
  MyToolTodayPage,
  MyToolWeekPage,
  MyToolBacklogPage,
  MyToolSettingsPage,
  MyToolPrioritiesPage,
  MyToolHelpPage,
  AdminPage,
  MyToolAdminSettingsPage,
  QmDashboardPage,
  EngineeringDashboardPage,
  EngineeringTasksPage,
  LifecycleBoardPage,
  ExecutionBoardPage,
  MyToolMeetingsPage,
  RoleSettingsPage,
  SmartImportPage,
  InvoicePatternsPage,
  SubcontractorDashboardPage,
  SystemActivityLogPage,
  WeeklyReviewsPage,
  AdminRolesPage,
  LeaderboardPage,
  FeedbackPage,
  EeInfoPage,
  TrainingPage,
  KnowledgeGamePage,
  DepartmentScoresPage,
  PMDashboard,
  ExcelUpdatesPage,
  PortfoliosPage,
  PortfolioDetailPage,
  PdDashboardPage,
  PdTicketsPage,
  PdTicketCreatePage,
  PdTicketDetailPage,
  TeamsChatsPage,
  CollaborationPage,
  CollabEmailPage,
  CollabTeamsPage,
  PMOnTheGoHome,
  PMOnTheGoProject,
  MyWorkHomePage,
  MyWorkCalendarPage,
  MyWorkTasksPage,
  ApprovalsPage,
  DatabaseMigrationPage,
  KpiTraceabilityPage,
  ImportControlTowerPage,
  AdminRecoveryPage,
  AdminControlCenterPage,
  CommandCenterPage,
  ClientsPage,
  ActionLaunchpadPage,
  PdPmHandoverPage,
  PmHandoverReviewPage,
  HandoverControlPage,
};

const APP_ROUTES: RouteConfig[] = PAGE_REGISTRY.filter((page) => page.routeComponentKey || page.redirectTo).flatMap((page) => {
  const routes: RouteConfig[] = [];
  if (page.redirectTo) {
    routes.push({ path: page.path, redirectTo: page.redirectTo });
  } else if (page.routeComponentKey && ROUTE_COMPONENTS[page.routeComponentKey]) {
    routes.push({ path: page.path, component: ROUTE_COMPONENTS[page.routeComponentKey] });
  }

  for (const alias of page.aliases ?? []) {
    routes.push({ path: alias, redirectTo: page.path });
  }

  return routes;
});


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
  const effectiveRole = normalizeRoleForPermissions(user?.role || companyRole);

  if (process.env.NODE_ENV !== "production") {
    (window as any).__navMode = navMode;
  }

  const { data: permissions } = useQuery<{ role?: string; entityPermissions?: Record<string, Record<string, boolean>> | null }>({
    queryKey: ["auth-permissions", user?.role],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (effectiveRole) headers["x-company-role"] = effectiveRole;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!user?.role,
    staleTime: 60_000,
  });

  if (effectiveRole === "PROJECT_MANAGER_SITE") {
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
    const qmAllowed = ["/", "/quality", "/projects", "/feedback", "/settings/integrations", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams", "/my-tool", "/my-tool/week", "/my-tool/backlog", "/my-tool/settings", "/my-tool/help", "/my-tool/meetings"];
    const allowed = qmAllowed.some(p => 
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
  }

  const hasAdminAccess = isSuperAdmin(user?.role, effectiveRole);
  if (!hasAdminAccess && location.startsWith("/admin")) {
    return <Redirect to="/" />;
  }

  const entity = getPermissionEntityForPath(location);
  if (entity && effectiveRole) {
    const ep = permissions?.entityPermissions;
    let hasView = true;
    if (ep && ep[entity]) {
      hasView = ep[entity]["view"] === true;
    } else {
      hasView = checkPermission(effectiveRole, entity, "view");
    }
    if (!hasView) {
      return <AccessDenied />;
    }

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as any).__permissionDebug = {
        user: user ? { id: user.id, role: user.role } : null,
        effectiveRole,
        route: location,
        checkedEntity: entity,
        hasView,
        entityPermissions: permissions?.entityPermissions ?? null,
      };
    }
  }

  return <>{children}</>;
}

function ProtectedPages() {
  const [location] = useLocation();
  useScrollRestoration(location);

  const { user } = useAuth();

  const effectiveRole = normalizeRoleForPermissions(user?.role || (typeof window !== "undefined" ? localStorage.getItem("company_role") : null));

  const { data: permissions } = useQuery<{ entityPermissions?: Record<string, Record<string, boolean>> | null }>({
    queryKey: ["auth-permissions-landing", user?.role],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (effectiveRole) headers["x-company-role"] = effectiveRole;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!user?.role && location === "/",
    staleTime: 60_000,
  });

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });
  const roleAwareUxEnabled = rolloutFlags?.find((flag) => flag.key === "role_aware_ux")?.value === true;

  return (
    <RoleGuard>
    <AppLayout>
      <Switch>
        <Route path="/">{() => {
          const role = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
          const selectedRole = normalizeRoleForPermissions(role || user?.role || null);

          if (roleAwareUxEnabled) {
            const pagesById = new Map(PAGE_REGISTRY.map((page) => [page.id, page]));
            const canAccess = (path: string) => {
              const entity = getPermissionEntityForPath(path);
              if (!entity || !selectedRole) return true;
              const ep = permissions?.entityPermissions;
              if (ep && ep[entity]) return ep[entity].view === true;
              return checkPermission(selectedRole, entity, "view");
            };

            const suggested = pickRoleAwareLandingPage(selectedRole, pagesById, canAccess);
            const preferredLandingPath = typeof window !== "undefined" ? localStorage.getItem("preferred_landing_path") : null;
            const preferredReason = typeof window !== "undefined" ? localStorage.getItem("preferred_landing_reason") : null;
            const preferredAllowed = !!preferredLandingPath && canAccess(preferredLandingPath);
            const finalPath = preferredAllowed ? preferredLandingPath : suggested?.path;

            if (suggested?.path && finalPath && finalPath !== "/") {
              if (preferredAllowed && preferredReason) {
                void logRoleAwareInteraction({
                  action: "suggestion_overridden",
                  suggestion: suggested.path,
                  finalValue: finalPath,
                  reason: preferredReason,
                  role: selectedRole,
                });
              } else {
                void logRoleAwareInteraction({
                  action: "suggestion_accepted",
                  suggestion: suggested.path,
                  finalValue: finalPath,
                  role: selectedRole,
                });
              }
              return <Redirect to={finalPath} />;
            }
          }

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
