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
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { normalizeRoleForPermissions } from "@shared/schema";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { PAGE_REGISTRY, LEGACY_REDIRECTS, ROLE_LANDING_PAGE } from "@/config/page-registry";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { LensProvider } from "@/hooks/use-lens-context";
import { lazy, Suspense, useEffect } from "react";

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";

// Lazy-loaded pages (code-split into separate chunks)
const CompanyOverviewPage = lazy(() => import("@/pages/company-overview"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const ProjectLifecyclePage = lazy(() => import("@/pages/project-lifecycle"));
const ProjectsSummary = lazy(() => import("@/pages/projects"));
const CashflowPage = lazy(() => import("@/pages/cashflow"));
const RevenueTrackerPage = lazy(() => import("@/pages/revenue-tracker"));
const CostTracker = lazy(() => import("@/pages/cos"));
const GpTrackerPage = lazy(() => import("@/pages/gp-tracker"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const ProjectStageGatePage = lazy(() => import("@/pages/project-stage-gate"));
const MyWorkAdminSettingsPage = lazy(() => import("@/pages/my-work-admin-settings"));
const MyWorkPrioritiesPage = lazy(() => import("@/pages/my-work-priorities"));
const MyWorkMeetingsPage = lazy(() => import("@/pages/my-work-meetings"));
const MyWorkSettingsPage = lazy(() => import("@/pages/my-work-settings"));
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
const AdminSettingsPage = lazy(() => import("@/pages/admin-settings"));
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
const PdReportsPage = lazy(() => import("@/pages/pd-reports"));
const TeamsChatsPage = lazy(() => import("@/pages/teams-chats"));
const CollabEmailPage = lazy(() => import("@/pages/collab-email"));
const FinancialLinkingPage = lazy(() => import("@/pages/financial-linking"));
const PMOnTheGoHome = lazy(() => import("@/pages/pm-on-the-go-home"));
const PMOnTheGoProject = lazy(() => import("@/pages/pm-on-the-go-project"));
const MyWorkHomePage = lazy(() => import("@/pages/my-work-home"));
const MyWorkTasksPage = lazy(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazy(() => import("@/pages/my-work-calendar"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const ApprovalsPage = lazy(() => import("@/pages/admin-approvals"));
const DatabaseMigrationPage = lazy(() => import("@/pages/database-migration"));
const PartiesRegistryPage = lazy(() => import("@/pages/parties-registry"));
const ClientsPage = lazy(() => import("@/pages/clients"));
const ClientDetailPage = lazy(() => import("@/pages/client-detail"));
const ClientProjectDepartmentsPage = lazy(() => import("@/pages/client-project-departments"));
const ImportControlTowerPage = lazy(() => import("@/pages/import-control-tower"));
const ProgrammeReportsPage = lazy(() => import("@/pages/programme-reports"));
const KpiTraceabilityPage = lazy(() => import("@/pages/kpi-traceability"));
const AdminRecoveryPage = lazy(() => import("@/pages/admin-recovery"));
const StageAdminPage = lazy(() => import("@/components/stage-lifecycle/StageAdminPanel"));
const AdminControlCenterPage = lazy(() => import("@/pages/admin-control-center"));
const ActionLaunchpadPage = lazy(() => import("@/pages/action-launchpad"));
const PdPmHandoverPage = lazy(() => import("@/pages/pd-pm-handover-v2"));
const PmHandoverReviewPage = lazy(() => import("@/pages/pm-handover-review"));
const FinancialReviewQueuePage = lazy(() => import("@/pages/financial-review-queue"));
const HandoverControlPage = lazy(() => import("@/pages/handover-control"));
const FyeRevenueTrackingPage = lazy(() => import("@/pages/fye-revenue-tracking"));
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
const ReportCenterPage = lazy(() => import("@/pages/reports/report-center"));
const PerformancePage = lazy(() => import("@/pages/reports/performance"));
const EngineeringStandupPage = lazy(() => import("@/pages/engineering/standup"));
const ConstructionDashboardPage = lazy(() => import("@/pages/construction-dashboard"));
const POApprovalBoardPage = lazy(() => import("@/pages/po-approval-board"));
const PaymentRequestBoardPage = lazy(() => import("@/pages/payment-request-board"));
const PaymentBatchManagerPage = lazy(() => import("@/pages/payment-batch-manager"));
const HseDashboardPage = lazy(() => import("@/pages/hse-dashboard"));
const HandoverDashboardPage = lazy(() => import("@/pages/handover-dashboard"));
const LessonsLearntPage = lazy(() => import("@/pages/lessons-learnt"));
const SitesPage = lazy(() => import("@/pages/sites"));
const OpportunitiesPage = lazy(() => import("@/pages/opportunities"));
const AdminPipedrivePage = lazy(() => import("@/pages/admin-pipedrive"));
const AdminBackfillPage = lazy(() => import("@/pages/admin-backfill"));
const AdminWorkflowConfigPage = lazy(() => import("@/pages/admin-workflow-config"));

// Commissioning Control Tower
const CommissioningDashboardPage = lazy(() => import("@/pages/commissioning-dashboard"));

// Gates workspace (Prompt 2)
const MilestoneTrackerPage = lazy(() => import("@/pages/milestone-tracker"));

const GatesPipelinePage = lazy(() => import("@/pages/gates/gates-pipeline"));
const GatesBlockedPage = lazy(() => import("@/pages/gates/gates-blocked"));
const GatesReadyPage = lazy(() => import("@/pages/gates/gates-ready"));
const GatesExceptionsPage = lazy(() => import("@/pages/gates/gates-exceptions"));
const GatesClientUpdatesPage = lazy(() => import("@/pages/gates/gates-client-updates"));
const GatesHandoversPage = lazy(() => import("@/pages/gates/gates-handovers"));
const GatesQueriesPage = lazy(() => import("@/pages/gates/gates-queries"));
const GatesCommitmentsPage = lazy(() => import("@/pages/gates/gates-commitments"));


type RouteConfig = { path: string; component?: React.ComponentType<any>; redirectTo?: string };

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

const ROUTE_COMPONENTS: Record<string, React.ComponentType<any>> = {
  CompanyOverviewPage,
  Dashboard,
  ProjectLifecyclePage,
  ProjectsSummary,
  FinancialLinkingPage,
  ProjectDetailPage,
  ProjectStageGatePage,
  CashflowPage,
  CostTracker,
  RevenueTrackerPage,
  GpTrackerPage,
  MyWorkPrioritiesPage,
  MyWorkAdminSettingsPage,
  QmDashboardPage,
  EngineeringDashboardPage,
  EngineeringTasksPage,
  EngineeringAuditPage,
  LifecycleBoardPage,
  ExecutionBoardPage,
  MyWorkMeetingsPage,
  MyWorkSettingsPage,
  RoleSettingsPage,
  SmartImportPage,
  SharePointIntakePage,
  InvoicePatternsPage,
  SubcontractorDashboardPage,
  CounterpartiesPage,
  SystemActivityLogPage,
  WeeklyReviewsPage,
  AdminRolesPage,
  AdminSettingsPage,
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
  PdReportsPage,
  TeamsChatsPage,
  CollabEmailPage,
  PMOnTheGoHome,
  PMOnTheGoProject,
  MyWorkHomePage,
  MyWorkCalendarPage,
  MyWorkTasksPage,
  InboxPage,
  ApprovalsPage,
  DatabaseMigrationPage,
  KpiTraceabilityPage,
  ImportControlTowerPage,
  ProgrammeReportsPage,
  AdminRecoveryPage,
  StageAdminPage,
  AdminControlCenterPage,
  ClientsPage,
  ClientDetailPage,
  ClientProjectDepartmentsPage,
  ActionLaunchpadPage,
  PdPmHandoverPage,
  PmHandoverReviewPage,
  FinancialReviewQueuePage,
  HandoverControlPage,
  FyeRevenueTrackingPage,
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
  ReportCenterPage,
  PerformancePage,
  EngineeringStandupPage,
  ConstructionDashboardPage,
  POApprovalBoardPage,
  PaymentRequestBoardPage,
  PaymentBatchManagerPage,
  HseDashboardPage,
  HandoverDashboardPage,
  LessonsLearntPage,
  SitesPage,
  OpportunitiesPage,
  AdminPipedrivePage,
  AdminBackfillPage,
  AdminWorkflowConfigPage,
  MilestoneTrackerPage,
  // Gates workspace (Prompt 2)
  GatesPipelinePage,
  GatesBlockedPage,
  GatesReadyPage,
  GatesExceptionsPage,
  GatesClientUpdatesPage,
  GatesHandoversPage,
  GatesQueriesPage,
  GatesCommitmentsPage,
  CommissioningDashboardPage,
  PartiesRegistryPage,
};

function resolveHomePath(userRole?: string | null, companyRole?: string | null) {
  const effectiveRole = normalizeRoleForPermissions(userRole || companyRole);
  return ROLE_LANDING_PAGE[effectiveRole] || "/dashboard";
}

function HomeRedirect() {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  return <Redirect to={resolveHomePath(user?.role, companyRole)} />;
}

const APP_ROUTES: RouteConfig[] = [
  // Legacy redirects (old bookmarks / deep links)
  ...LEGACY_REDIRECTS.map((r) => ({ path: r.path, redirectTo: r.redirectTo })),
  // Active pages + registry-level redirects
  ...PAGE_REGISTRY.filter((page) => page.routeComponentKey || page.redirectTo).flatMap((page) => {
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
  }),
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
  const effectiveRole = normalizeRoleForPermissions(user?.role || companyRole);

  if (process.env.NODE_ENV !== "production") {
    (window as any).__navMode = navMode;
  }

  const { canViewPath } = useAccessMatrix();

  if (effectiveRole && !canViewPath(location)) {
    return <AccessDenied />;
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
    <LensProvider>
    <RoleGuard>
    <AppLayout>
      <ErrorBoundary>
      <Suspense fallback={<div className="space-y-6 p-6"><LoadingState variant="skeleton-card" cards={4} /><LoadingState variant="skeleton-table" rows={6} /></div>}>
      <div className="page-enter">
        <Switch>
          <Route path="/" component={HomePage} />
          {/* Explicit selector route — canonical parameterized path is in PAGE_REGISTRY */}
          <Route path="/commissioning-dashboard" component={CommissioningDashboardPage} />
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
      </ErrorBoundary>
    </AppLayout>
    </RoleGuard>
    </LensProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={LoginPage} />
      <Route path="/login">{() => <Redirect to="/auth/login" />}</Route>
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
