import type { ComponentType } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

const CompanyOverviewPage = lazyWithRetry(() => import("@/pages/company-overview"));
const Dashboard = lazyWithRetry(() => import("@/pages/dashboard"));
const CeoHomePage = lazyWithRetry(() => import("@/pages/ceo-home"));
const CooHomePage = lazyWithRetry(() => import("@/pages/coo-home"));
const SettingsHomePage = lazyWithRetry(() => import("@/pages/settings-home"));
const ProjectDocumentsPage = lazyWithRetry(() => import("@/pages/project-documents"));
// (removed) QuickBooksHomePage — orphaned surface, consolidated into FinanceQuickBooksThroughputPage in Task #30.
const AdminDocumentTypesPage = lazyWithRetry(() => import("@/pages/admin-document-types"));
const AdminEmailLinkerDevPage = lazyWithRetry(() => import("@/pages/admin-email-linker-dev"));
const HandoverLivePage = lazyWithRetry(() => import("@/pages/handover-live"));
const ProjectLifecyclePage = lazyWithRetry(() => import("@/pages/project-lifecycle"));
const ProjectsSummary = lazyWithRetry(() => import("@/pages/projects"));
const CashflowPage = lazyWithRetry(() => import("@/pages/cashflow"));
const RevenueTrackerPage = lazyWithRetry(() => import("@/pages/revenue-tracker"));
const CostTracker = lazyWithRetry(() => import("@/pages/cos"));
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
const AdminSettingsPage = lazyWithRetry(() => import("@/pages/admin-settings"));
const LeaderboardPage = lazyWithRetry(() => import("@/pages/leaderboard"));
const FeedbackPage = lazyWithRetry(() => import("@/pages/feedback"));
const EeInfoPage = lazyWithRetry(() => import("@/pages/ee-info"));
const TrainingPage = lazyWithRetry(() => import("@/pages/training"));
const PMDashboard = lazyWithRetry(() => import("@/pages/pm-dashboard"));
const PortfoliosPage = lazyWithRetry(() => import("@/pages/portfolios"));
const PortfolioDetailPage = lazyWithRetry(() => import("@/pages/portfolio-detail"));
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
const PdDashboardPage = lazyWithRetry(() => import("@/pages/pd-dashboard"));
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

const CommissioningDashboardPage = lazyWithRetry(() => import("@/pages/commissioning-dashboard"));

const MilestoneTrackerPage = lazyWithRetry(() => import("@/pages/milestone-tracker"));

const GatesPipelinePage = lazyWithRetry(() => import("@/pages/gates/gates-pipeline"));
const GatesBlockedPage = lazyWithRetry(() => import("@/pages/gates/gates-blocked"));
const GatesReadyPage = lazyWithRetry(() => import("@/pages/gates/gates-ready"));
const GatesExceptionsPage = lazyWithRetry(() => import("@/pages/gates/gates-exceptions"));
const GatesClientUpdatesPage = lazyWithRetry(() => import("@/pages/gates/gates-client-updates"));
const GatesHandoversPage = lazyWithRetry(() => import("@/pages/gates/gates-handovers"));
const GatesQueriesPage = lazyWithRetry(() => import("@/pages/gates/gates-queries"));
const GatesCommitmentsPage = lazyWithRetry(() => import("@/pages/gates/gates-commitments"));

/**
 * Maps PageRegistryEntry.routeComponentKey → the lazy-loaded page component.
 * Used by the router to mount each route; extracted from App.tsx so the
 * registry↔router parity can be asserted in unit tests without pulling in
 * the full App tree.
 */
export const ROUTE_COMPONENTS: Record<string, ComponentType<any>> = {
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
  PdDashboardPage,
  AdminPipedrivePage,
  AdminQuickBooksPage,
  FinanceQuickBooksLinksPage,
  FinanceQuickBooksCustomerMappingPage,
  FinanceQuickBooksThroughputPage,
  AdminBackfillPage,
  AdminWorkflowConfigPage,
  MilestoneTrackerPage,
  GatesPipelinePage,
  GatesBlockedPage,
  GatesReadyPage,
  GatesExceptionsPage,
  GatesClientUpdatesPage,
  GatesHandoversPage,
  GatesQueriesPage,
  GatesCommitmentsPage,
  CommissioningDashboardPage,
  CeoHomePage,
  CooHomePage,
  SettingsHomePage,
  ProjectDocumentsPage,
  AdminDocumentTypesPage,
  AdminEmailLinkerDevPage,
  HandoverLivePage,
};

export const ROUTE_COMPONENT_KEYS: ReadonlySet<string> = new Set(Object.keys(ROUTE_COMPONENTS));
