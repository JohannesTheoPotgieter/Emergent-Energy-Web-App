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
import { lazy, Suspense, useEffect, ComponentType } from "react";

/**
 * Retry wrapper for dynamic imports — handles ChunkLoadError on deployment
 * race conditions or CDN failures. Retries up to 3 times with cache-busting
 * query parameter before giving up.
 */
function lazyWithRetry(importFn: () => Promise<{ default: ComponentType<any> }>, retries = 3): ReturnType<typeof lazy> {
  return lazy(() =>
    importFn().catch((error: Error) => {
      // Detect ChunkLoadError (stale deployment, CDN cache miss)
      const isChunkError = error.name === "ChunkLoadError" ||
        error.message?.includes("Failed to fetch dynamically imported module") ||
        error.message?.includes("Loading chunk") ||
        error.message?.includes("Loading CSS chunk");

      if (isChunkError && retries > 0) {
        return new Promise<{ default: ComponentType<any> }>((resolve) =>
          setTimeout(resolve, 1000)
        ).then(() => lazyWithRetry(importFn, retries - 1) as unknown as Promise<{ default: ComponentType<any> }>);
      }

      // After retries exhausted for chunk errors, force a full page reload
      // so the browser fetches fresh HTML with updated chunk hashes.
      if (isChunkError) {
        const reloadKey = `chunk-reload-${window.location.pathname}`;
        if (!sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, "1");
          window.location.reload();
        }
      }

      throw error;
    })
  );
}

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";

// Lazy-loaded pages (code-split into separate chunks)
const CompanyOverviewPage = lazyWithRetry(() => import("@/pages/company-overview"));

const ProjectLifecyclePage = lazyWithRetry(() => import("@/pages/project-lifecycle"));
const ProjectsSummary = lazyWithRetry(() => import("@/pages/projects"));
const CashflowPage = lazyWithRetry(() => import("@/pages/cashflow"));
const RevenueTrackerPage = lazyWithRetry(() => import("@/pages/revenue-tracker"));
const CostTracker = lazyWithRetry(() => import("@/pages/cos"));
const GpTrackerPage = lazyWithRetry(() => import("@/pages/gp-tracker"));
const ProjectDetailPage = lazyWithRetry(() => import("@/pages/project-detail"));
const ProjectStageGatePage = lazyWithRetry(() => import("@/pages/project-stage-gate"));
const MyWorkAdminSettingsPage = lazyWithRetry(() => import("@/pages/my-work-admin-settings"));
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
const PartiesRegistryPage = lazyWithRetry(() => import("@/pages/parties-registry"));
const AdminMigrationControlPage = lazyWithRetry(() => import("@/pages/admin-migration-control"));
const PmWorkboardPage = lazyWithRetry(() => import("@/pages/pm-workboard"));
const GovernedProcessesPage = lazyWithRetry(() => import("@/pages/governed-processes"));
const EngineeringDeliverablesV2Page = lazyWithRetry(() => import("@/pages/engineering-deliverables-v2"));
const ApprovalsBoardV2Page = lazyWithRetry(() => import("@/pages/approvals-board-v2"));
const FinanceWorkspacePage = lazyWithRetry(() => import("@/pages/finance-workspace"));
const FinanceRecordsPage = lazyWithRetry(() => import("@/pages/finance-records"));
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
const FyeRevenueTrackingPage = lazyWithRetry(() => import("@/pages/fye-revenue-tracking"));
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
  ProjectLifecyclePage,
  ProjectsSummary,
  FinancialLinkingPage,
  ProjectDetailPage,
  ProjectStageGatePage,
  CashflowPage,
  CostTracker,
  RevenueTrackerPage,
  GpTrackerPage,
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
  AdminMigrationControlPage,
  PmWorkboardPage,
  GovernedProcessesPage,
  EngineeringDeliverablesV2Page,
  ApprovalsBoardV2Page,
  FinanceWorkspacePage,
  FinanceRecordsPage,
};

function resolveHomePath(userRole?: string | null, companyRole?: string | null) {
  const effectiveRole = normalizeRoleForPermissions(userRole || companyRole);
  // Fallback to "/" (home) instead of "/dashboard" (→ /gates) since /gates requires
  // lifecycle view permission that not all roles have (ENGINEER, ACCOUNTANT).
  return ROLE_LANDING_PAGE[effectiveRole] || "/";
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

/** Redirect that preserves query parameters from the current URL */
function RedirectPreserveQuery({ to }: { to: string }) {
  const targetHasQuery = to.includes("?");
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  // If target already has query params, append current ones with &; otherwise use ?
  const dest = currentSearch && !targetHasQuery
    ? `${to}${currentSearch}`
    : currentSearch && targetHasQuery
      ? `${to}${currentSearch.replace("?", "&")}`
      : to;
  return <Redirect to={dest} />;
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
              return <Route key={route.path} path={route.path}>{() => <RedirectPreserveQuery to={route.redirectTo!} />}</Route>;
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
