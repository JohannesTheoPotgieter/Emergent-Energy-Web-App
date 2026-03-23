import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NetworkStatus } from "@/components/NetworkStatus";
import AppLayout from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions } from "@shared/schema";
import { ShieldAlert, ArrowLeft, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PAGE_REGISTRY, ROLE_LANDING_PAGE, getPermissionEntityForPath } from "@/config/page-registry";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { lazy, Suspense, useEffect } from "react";

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";

// Lazy-loaded pages (code-split into separate chunks)
const Dashboard = lazy(() => import("@/pages/dashboard"));
const ProjectLifecyclePage = lazy(() => import("@/pages/project-lifecycle"));
const ProjectsSummary = lazy(() => import("@/pages/projects"));
const CashflowPage = lazy(() => import("@/pages/cashflow"));
const RevenueTrackerPage = lazy(() => import("@/pages/revenue-tracker"));
const CostTracker = lazy(() => import("@/pages/cos"));
const GpTrackerPage = lazy(() => import("@/pages/gp-tracker"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const MyToolAdminSettingsPage = lazy(() => import("@/pages/my-tool-admin-settings"));
const MyToolPrioritiesPage = lazy(() => import("@/pages/my-tool-priorities"));
const MyToolMeetingsPage = lazy(() => import("@/pages/my-tool-meetings"));
const QmDashboardPage = lazy(() => import("@/pages/qm-dashboard"));
const EngineeringDashboardPage = lazy(() => import("@/pages/engineering-dashboard"));
const EngineeringTasksPage = lazy(() => import("@/pages/engineering-tasks"));
const EngineeringAuditPage = lazy(() => import("@/pages/engineering-audit"));
const RoleSettingsPage = lazy(() => import("@/pages/role-settings"));
const LifecycleBoardPage = lazy(() => import("@/pages/lifecycle-board"));
const ExecutionBoardPage = lazy(() => import("@/pages/execution-board"));
const SmartImportPage = lazy(() => import("@/pages/smart-import"));
const SharePointIntakePage = lazy(() => import("@/pages/SharePointIntakePage"));
const InvoicePatternsPage = lazy(() => import("@/pages/invoice-patterns"));
const SubcontractorDashboardPage = lazy(() => import("@/pages/subcontractor-dashboard"));
const CounterpartiesPage = lazy(() => import("@/pages/counterparties"));
const SystemActivityLogPage = lazy(() => import("@/pages/system-activity-log"));
const WeeklyReviewsPage = lazy(() => import("@/pages/weekly-reviews"));
const AdminRolesPage = lazy(() => import("@/pages/admin-roles"));
const LeaderboardPage = lazy(() => import("@/pages/leaderboard"));
const FeedbackPage = lazy(() => import("@/pages/feedback"));
const EeInfoPage = lazy(() => import("@/pages/ee-info"));
const TrainingPage = lazy(() => import("@/pages/training"));
const PMDashboard = lazy(() => import("@/pages/pm-dashboard"));
const PortfoliosPage = lazy(() => import("@/pages/portfolios"));
const PortfolioDetailPage = lazy(() => import("@/pages/portfolio-detail"));
const PdDashboardPage = lazy(() => import("@/pages/pd-dashboard"));
const PdTicketsPage = lazy(() => import("@/pages/pd-tickets"));
const PdTicketCreatePage = lazy(() => import("@/pages/pd-ticket-create"));
const PdTicketDetailPage = lazy(() => import("@/pages/pd-ticket-detail"));
const TeamsChatsPage = lazy(() => import("@/pages/teams-chats"));
const CollaborationPage = lazy(() => import("@/pages/collaboration"));
const CollabEmailPage = lazy(() => import("@/pages/collab-email"));
const CollabTeamsPage = lazy(() => import("@/pages/collab-teams"));
const FinancialLinkingPage = lazy(() => import("@/pages/financial-linking"));
const PMOnTheGoHome = lazy(() => import("@/pages/pm-on-the-go-home"));
const PMOnTheGoProject = lazy(() => import("@/pages/pm-on-the-go-project"));
const MyWorkHomePage = lazy(() => import("@/pages/my-work-home"));
const MyWorkTasksPage = lazy(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazy(() => import("@/pages/my-work-calendar"));
const ApprovalsPage = lazy(() => import("@/pages/admin-approvals"));
const PMDeliverablesPage = lazy(() => import("@/pages/pm-deliverables"));
const DatabaseMigrationPage = lazy(() => import("@/pages/database-migration"));
const ClientsPage = lazy(() => import("@/pages/clients"));
const ImportControlTowerPage = lazy(() => import("@/pages/import-control-tower"));
const ProgrammeReportsPage = lazy(() => import("@/pages/programme-reports"));
const KpiTraceabilityPage = lazy(() => import("@/pages/kpi-traceability"));
const AdminRecoveryPage = lazy(() => import("@/pages/admin-recovery"));
const AdminControlCenterPage = lazy(() => import("@/pages/admin-control-center"));
const ActionLaunchpadPage = lazy(() => import("@/pages/action-launchpad"));
const PdPmHandoverPage = lazy(() => import("@/pages/pd-pm-handover"));
const PmHandoverReviewPage = lazy(() => import("@/pages/pm-handover-review"));
const HandoverControlPage = lazy(() => import("@/pages/handover-control"));
const FyeRevenueTrackingPage = lazy(() => import("@/pages/fye-revenue-tracking"));
const TaskManagementPage = lazy(() => import("@/pages/task-management"));
const StandupsPage = lazy(() => import("@/pages/standups"));
const ExceptionsPage = lazy(() => import("@/pages/exceptions"));
const PhaseTemplatesPage = lazy(() => import("@/pages/phase-templates"));
const ProjectCreatePage = lazy(() => import("@/pages/project-create"));
const DepartmentScoresPage = lazy(() => import("@/pages/department-scores"));
const EngTemplateAdminPage = lazy(() => import("@/pages/eng-template-admin"));
const PrioritiesPage = lazy(() => import("@/pages/priorities"));
const PriorityDetailPage = lazy(() => import("@/pages/priority-detail"));
const PmMonthlyReportPage = lazy(() => import("@/pages/pm-monthly-report"));
const PmMonthlyReportHistoryPage = lazy(() => import("@/pages/pm-monthly-report-history"));
const PmMonthlyReportComparePage = lazy(() => import("@/pages/pm-monthly-report-compare"));
const PmMonthlyReportProjectPage = lazy(() => import("@/pages/pm-monthly-report-project"));
const EngMonthlyReportPage = lazy(() => import("@/pages/engineering-monthly-report"));
const EngMonthlyReportHistoryPage = lazy(() => import("@/pages/engineering-monthly-report-history"));
const EngMonthlyReportComparePage = lazy(() => import("@/pages/engineering-monthly-report-compare"));
const EngMonthlyReportProjectPage = lazy(() => import("@/pages/engineering-monthly-report-project"));

const EPM_ALLOWED_PATHS = ["/", "/project-lifecycle", "/project-lifecycle/stage-gates", "/project-lifecycle/latest-updates", "/project-lifecycle/client-overview", "/lifecycle-board", "/clients", "/handover-control", "/engineering", "/engineering/tasks", "/quality", "/projects", "/feedback", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams", "/tasks", "/standups"];
const PM_ALLOWED_PATHS = ["/", "/dashboard", "/project-lifecycle", "/project-lifecycle/stage-gates", "/project-lifecycle/latest-updates", "/project-lifecycle/client-overview", "/lifecycle-board", "/clients", "/handover-control", "/pm-dashboard", "/pm/approvals", "/pm/deliverables", "/pm/on-the-go", "/pm/handover-review", "/projects", "/execution-board", "/execution-board/program", "/execution-board/construction", "/execution-board/finance", "/weekly-reviews", "/portfolios", "/engineering", "/engineering/tasks", "/quality", "/cashflow", "/cos", "/gp-tracker", "/revenue-tracker", "/feedback", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams", "/tasks", "/standups"];
const QM_ALLOWED_PATHS = ["/", "/project-lifecycle", "/project-lifecycle/stage-gates", "/project-lifecycle/latest-updates", "/project-lifecycle/client-overview", "/lifecycle-board", "/clients", "/handover-control", "/quality", "/projects", "/feedback", "/collaboration", "/collaboration/email", "/collaboration/teams", "/teams/chats", "/my-work", "/my-work/calendar", "/my-work/tasks", "/my-work/approvals", "/my-work/meetings", "/my-work/email", "/my-work/teams"];

type RouteConfig = { path: string; component?: React.ComponentType<any>; redirectTo?: string };

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

const ROUTE_COMPONENTS: Record<string, React.ComponentType<any>> = {
  Dashboard,
  ProjectLifecyclePage,
  ProjectsSummary,
  FinancialLinkingPage,
  ProjectDetailPage,
  CashflowPage,
  CostTracker,
  RevenueTrackerPage,
  GpTrackerPage,
  MyToolPrioritiesPage,
  MyToolAdminSettingsPage,
  QmDashboardPage,
  EngineeringDashboardPage,
  EngineeringTasksPage,
  EngineeringAuditPage,
  LifecycleBoardPage,
  ExecutionBoardPage,
  MyToolMeetingsPage,
  RoleSettingsPage,
  SmartImportPage,
  SharePointIntakePage,
  InvoicePatternsPage,
  SubcontractorDashboardPage,
  CounterpartiesPage,
  SystemActivityLogPage,
  WeeklyReviewsPage,
  AdminRolesPage,
  LeaderboardPage,
  FeedbackPage,
  EeInfoPage,
  TrainingPage,
  PMDashboard,
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
  PMDeliverablesPage,
  DatabaseMigrationPage,
  KpiTraceabilityPage,
  ImportControlTowerPage,
  ProgrammeReportsPage,
  AdminRecoveryPage,
  AdminControlCenterPage,
  ClientsPage,
  ActionLaunchpadPage,
  PdPmHandoverPage,
  PmHandoverReviewPage,
  HandoverControlPage,
  FyeRevenueTrackingPage,
  TaskManagementPage,
  StandupsPage,
  ExceptionsPage,
  PhaseTemplatesPage,
  ProjectCreatePage,
  DepartmentScoresPage,
  EngTemplateAdminPage,
  PrioritiesPage,
  PriorityDetailPage,
  PmMonthlyReportPage,
  PmMonthlyReportHistoryPage,
  PmMonthlyReportComparePage,
  PmMonthlyReportProjectPage,
  EngMonthlyReportPage,
  EngMonthlyReportHistoryPage,
  EngMonthlyReportComparePage,
  EngMonthlyReportProjectPage,
};

function resolveHomePath(userRole?: string | null, companyRole?: string | null) {
  const effectiveRole = normalizeRoleForPermissions(userRole || companyRole);
  return ROLE_LANDING_PAGE[effectiveRole] || "/execution-board";
}

function HomeRedirect() {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  return <Redirect to={resolveHomePath(user?.role, companyRole)} />;
}

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
      return <Redirect to="/execution-board" />;
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
    const allowed = QM_ALLOWED_PATHS.some(p =>
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
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

function usePageTitle(location: string) {
  useEffect(() => {
    const page = PAGE_REGISTRY.find((p) => p.path === location);
    const label = page?.label || "Dashboard";
    document.title = `${label} — Emergent Energy`;
  }, [location]);
}

function ProtectedPages() {
  const [location] = useLocation();
  useScrollRestoration(location);
  usePageTitle(location);

  return (
    <RoleGuard>
    <AppLayout>
      <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <div key={location} className="page-enter">
        <Switch>
          <Route path="/" component={HomePage} />
          {APP_ROUTES.map((route) => {
            if (route.redirectTo) {
              return <Route key={route.path} path={route.path}>{() => <Redirect to={route.redirectTo!} />}</Route>;
            }
            return <Route key={route.path} path={route.path} component={route.component!} />;
          })}
          <Route component={NotFound} />
        </Switch>
      </div>
      </Suspense>
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
          <NetworkStatus />
          <Router />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
