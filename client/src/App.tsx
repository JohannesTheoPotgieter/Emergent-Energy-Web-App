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
import { Suspense, useEffect, useState } from "react";
import { useVersionCheck } from "@/hooks/use-version-check";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";

// Lazy-loaded pages (code-split into separate chunks)
const CompanyOverviewPage = lazyWithRetry(() => import("@/pages/company-overview"));
const Dashboard = lazyWithRetry(() => import("@/pages/dashboard"));
const ProjectLifecyclePage = lazyWithRetry(() => import("@/pages/project-lifecycle"));
const ProjectsSummary = lazyWithRetry(() => import("@/pages/projects"));
const CashflowPage = lazyWithRetry(() => import("@/pages/cashflow"));
const RevenueTrackerPage = lazyWithRetry(() => import("@/pages/revenue-tracker"));
const CostTracker = lazyWithRetry(() => import("@/pages/cos"));
const ProjectDetailPage = lazyWithRetry(() => import("@/pages/project-detail"));
const ProjectStageGatePage = lazyWithRetry(() => import("@/pages/project-stage-gate"));
const MyWorkAdminSettingsPage = lazyWithRetry(() => import("@/pages/my-work-admin-settings"));
const MyWorkPrioritiesPage = lazyWithRetry(() => import("@/pages/my-work-priorities"));
const MyWorkMeetingsPage = lazyWithRetry(() => import("@/pages/my-work-meetings"));
const MyWorkSettingsPage = lazyWithRetry(() => import("@/pages/my-work-settings"));
const QmDashboardPage = lazyWithRetry(() => import("@/pages/qm-dashboard"));
const EngineeringDashboardPage = lazyWithRetry(() => import("@/pages/engineering-dashboard"));
const EngineeringTasksPage = lazyWithRetry(() => import("@/pages/engineering-tasks"));
const EngineeringAuditPage = lazyWithRetry(() => import("@/pages/engineering-audit"));
const RoleSettingsPage = lazyWithRetry(() => import("@/pages/role-settings"));
const LifecycleBoardPage = lazyWithRetry(() => import("@/pages/lifecycle-board"));
const ExecutionBoardPage = lazyWithRetry(() => import("@/pages/execution-board"));
const SmartImportPage = lazyWithRetry(() => import("@/pages/smart-import"));
const SharePointIntakePage = lazyWithRetry(() => import("@/pages/SharePointIntakePage"));
const InvoicePatternsPage = lazyWithRetry(() => import("@/pages/invoice-patterns"));
const SubcontractorDashboardPage = lazyWithRetry(() => import("@/pages/subcontractor-dashboard"));
const CounterpartiesPage = lazyWithRetry(() => import("@/pages/counterparties"));
const SystemActivityLogPage = lazyWithRetry(() => import("@/pages/system-activity-log"));
const WeeklyReviewsPage = lazyWithRetry(() => import("@/pages/weekly-reviews"));
const AdminRolesPage = lazyWithRetry(() => import("@/pages/admin-roles"));
const AdminSettingsPage = lazyWithRetry(() => import("@/pages/admin-settings"));
const LeaderboardPage = lazyWithRetry(() => import("@/pages/leaderboard"));
const FeedbackPage = lazyWithRetry(() => import("@/pages/feedback"));
const EeInfoPage = lazyWithRetry(() => import("@/pages/ee-info"));
const TrainingPage = lazyWithRetry(() => import("@/pages/training"));
const PMDashboard = lazyWithRetry(() => import("@/pages/pm-dashboard"));
const PortfoliosPage = lazyWithRetry(() => import("@/pages/portfolios"));
const PortfolioDetailPage = lazyWithRetry(() => import("@/pages/portfolio-detail"));
const PdDashboardPage = lazyWithRetry(() => import("@/pages/pd-dashboard"));
const PdTicketsPage = lazyWithRetry(() => import("@/pages/pd-tickets"));
const PdTicketCreatePage = lazyWithRetry(() => import("@/pages/pd-ticket-create"));
const PdTicketDetailPage = lazyWithRetry(() => import("@/pages/pd-ticket-detail"));
const PdReportsPage = lazyWithRetry(() => import("@/pages/pd-reports"));
const TeamsChatsPage = lazyWithRetry(() => import("@/pages/teams-chats"));
const CollabEmailPage = lazyWithRetry(() => import("@/pages/collab-email"));
const FinancialLinkingPage = lazyWithRetry(() => import("@/pages/financial-linking"));
const PMOnTheGoHome = lazyWithRetry(() => import("@/pages/pm-on-the-go-home"));
const PMOnTheGoProject = lazyWithRetry(() => import("@/pages/pm-on-the-go-project"));
const MyWorkHomePage = lazyWithRetry(() => import("@/pages/my-work-home"));
const MyWorkTasksPage = lazyWithRetry(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazyWithRetry(() => import("@/pages/my-work-calendar"));
const InboxPage = lazyWithRetry(() => import("@/pages/inbox"));
const ApprovalsPage = lazyWithRetry(() => import("@/pages/admin-approvals"));
const DatabaseMigrationPage = lazyWithRetry(() => import("@/pages/database-migration"));
const ClientsPage = lazyWithRetry(() => import("@/pages/clients"));
const ClientDetailPage = lazyWithRetry(() => import("@/pages/client-detail"));
const ClientProjectDepartmentsPage = lazyWithRetry(() => import("@/pages/client-project-departments"));
const ImportControlTowerPage = lazyWithRetry(() => import("@/pages/import-control-tower"));
const ProgrammeReportsPage = lazyWithRetry(() => import("@/pages/programme-reports"));
const KpiTraceabilityPage = lazyWithRetry(() => import("@/pages/kpi-traceability"));
const AdminRecoveryPage = lazyWithRetry(() => import("@/pages/admin-recovery"));
const StageAdminPage = lazyWithRetry(() => import("@/components/stage-lifecycle/StageAdminPanel"));
const AdminControlCenterPage = lazyWithRetry(() => import("@/pages/admin-control-center"));
const ActionLaunchpadPage = lazyWithRetry(() => import("@/pages/action-launchpad"));
const PdPmHandoverPage = lazyWithRetry(() => import("@/pages/pd-pm-handover-v2"));
const PmHandoverReviewPage = lazyWithRetry(() => import("@/pages/pm-handover-review"));
const FinancialReviewQueuePage = lazyWithRetry(() => import("@/pages/financial-review-queue"));
const HandoverControlPage = lazyWithRetry(() => import("@/pages/handover-control"));
const ExceptionsPage = lazyWithRetry(() => import("@/pages/exceptions"));
const PhaseTemplatesPage = lazyWithRetry(() => import("@/pages/phase-templates"));
const ProjectCreatePage = lazyWithRetry(() => import("@/pages/project-create"));
const DepartmentScoresPage = lazyWithRetry(() => import("@/pages/department-scores"));
const EngTemplateAdminPage = lazyWithRetry(() => import("@/pages/eng-template-admin"));
const PrioritiesPage = lazyWithRetry(() => import("@/pages/priorities"));
const PriorityDetailPage = lazyWithRetry(() => import("@/pages/priority-detail"));
const PmMonthlyReportPage = lazyWithRetry(() => import("@/pages/pm-monthly-report"));
const PmMonthlyReportHistoryPage = lazyWithRetry(() => import("@/pages/pm-monthly-report-history"));
const PmMonthlyReportComparePage = lazyWithRetry(() => import("@/pages/pm-monthly-report-compare"));
const PmMonthlyReportProjectPage = lazyWithRetry(() => import("@/pages/pm-monthly-report-project"));
const EngMonthlyReportPage = lazyWithRetry(() => import("@/pages/engineering-monthly-report"));
const EngMonthlyReportHistoryPage = lazyWithRetry(() => import("@/pages/engineering-monthly-report-history"));
const EngMonthlyReportComparePage = lazyWithRetry(() => import("@/pages/engineering-monthly-report-compare"));
const EngMonthlyReportProjectPage = lazyWithRetry(() => import("@/pages/engineering-monthly-report-project"));
const ReportCenterPage = lazyWithRetry(() => import("@/pages/reports/report-center"));
const PerformancePage = lazyWithRetry(() => import("@/pages/reports/performance"));
const EngineeringStandupPage = lazyWithRetry(() => import("@/pages/engineering/standup"));
const POApprovalBoardPage = lazyWithRetry(() => import("@/pages/po-approval-board"));
const PaymentRequestBoardPage = lazyWithRetry(() => import("@/pages/payment-request-board"));
const PaymentBatchManagerPage = lazyWithRetry(() => import("@/pages/payment-batch-manager"));
const HseDashboardPage = lazyWithRetry(() => import("@/pages/hse-dashboard"));
const HandoverDashboardPage = lazyWithRetry(() => import("@/pages/handover-dashboard"));
const LessonsLearntPage = lazyWithRetry(() => import("@/pages/lessons-learnt"));
const SitesPage = lazyWithRetry(() => import("@/pages/sites"));
const OpportunitiesPage = lazyWithRetry(() => import("@/pages/opportunities"));
const AdminPipedrivePage = lazyWithRetry(() => import("@/pages/admin-pipedrive"));
const AdminQuickBooksPage = lazyWithRetry(() => import("@/pages/admin-quickbooks"));
const FinanceQuickBooksLinksPage = lazyWithRetry(() => import("@/pages/finance-quickbooks-links"));
const FinanceQuickBooksCustomerMappingPage = lazyWithRetry(
  () => import("@/pages/finance-quickbooks-customer-mapping"),
);
const FinanceQuickBooksThroughputPage = lazyWithRetry(
  () => import("@/pages/finance-quickbooks-throughput"),
);
const AdminBackfillPage = lazyWithRetry(() => import("@/pages/admin-backfill"));
const AdminWorkflowConfigPage = lazyWithRetry(() => import("@/pages/admin-workflow-config"));

// Commissioning Control Tower
const CommissioningDashboardPage = lazyWithRetry(() => import("@/pages/commissioning-dashboard"));

// Gates workspace (Prompt 2)
const MilestoneTrackerPage = lazyWithRetry(() => import("@/pages/milestone-tracker"));

const GatesPipelinePage = lazyWithRetry(() => import("@/pages/gates/gates-pipeline"));
const GatesBlockedPage = lazyWithRetry(() => import("@/pages/gates/gates-blocked"));
const GatesReadyPage = lazyWithRetry(() => import("@/pages/gates/gates-ready"));
const GatesExceptionsPage = lazyWithRetry(() => import("@/pages/gates/gates-exceptions"));
const GatesClientUpdatesPage = lazyWithRetry(() => import("@/pages/gates/gates-client-updates"));
const GatesHandoversPage = lazyWithRetry(() => import("@/pages/gates/gates-handovers"));
const GatesQueriesPage = lazyWithRetry(() => import("@/pages/gates/gates-queries"));
const GatesCommitmentsPage = lazyWithRetry(() => import("@/pages/gates/gates-commitments"));


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
  POApprovalBoardPage,
  PaymentRequestBoardPage,
  PaymentBatchManagerPage,
  HseDashboardPage,
  HandoverDashboardPage,
  LessonsLearntPage,
  SitesPage,
  OpportunitiesPage,
  AdminPipedrivePage,
  AdminQuickBooksPage,
  FinanceQuickBooksLinksPage,
  FinanceQuickBooksCustomerMappingPage,
  FinanceQuickBooksThroughputPage,
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
          {APP_ROUTES.map((route) => {
            if (route.redirectTo) {
              return <Route key={route.path} path={route.path}>{() => <Redirect to={route.redirectTo!} />}</Route>;
            }
            const PageComponent = route.component!;
            return <Route key={route.path} path={route.path}>{() => <ErrorBoundary><PageComponent /></ErrorBoundary>}</Route>;
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

/**
 * Prompt 0.12: proactive "new version available" banner.
 *
 * Renders above all page content when useVersionCheck detects that the
 * server's /api/version has moved on from the build the tab bootstrapped
 * with. The user clicks Reload to pick up the new bundle — we never
 * auto-reload. They can also dismiss the banner, in which case it stays
 * hidden until the next polling cycle detects yet another newer build.
 */
function VersionUpdateBanner() {
  const { hasUpdate, latestBuild } = useVersionCheck();
  const [dismissedBuild, setDismissedBuild] = useState<string | null>(null);
  // Prompt 0.12 follow-up: NetworkStatus's offline banner uses z-[100] and
  // also position: fixed top-0. If both rendered simultaneously the version
  // banner would be obscured. Suppress the version banner while the tab is
  // offline — the user can't reload the bundle over a dead connection, so
  // offering the action is actively misleading. It will reappear once the
  // tab reconnects and the next useVersionCheck poll confirms the update.
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!hasUpdate || !latestBuild || dismissedBuild === latestBuild || !isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[90] bg-blue-600 text-white shadow-md"
      role="status"
      aria-live="polite"
      data-testid="version-update-banner"
    >
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
        <Download className="h-4 w-4 shrink-0" />
        <p className="text-sm flex-1">
          A new version of Emergent Energy is available. Reload to pick up the latest updates.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => window.location.reload()}
          data-testid="button-version-reload"
        >
          Reload
        </Button>
        <button
          type="button"
          onClick={() => setDismissedBuild(latestBuild)}
          className="text-white/80 hover:text-white"
          aria-label="Dismiss update notification"
          data-testid="button-version-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <VersionUpdateBanner />
          <NetworkStatus />
          <Router />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
