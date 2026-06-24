import type { ComponentType } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

const CompanyOverviewPage = lazyWithRetry(() => import("@/pages/company-overview"));
const CompanyTeamPage = lazyWithRetry(() => import("@/pages/company-team"));
const Dashboard = lazyWithRetry(() => import("@/pages/dashboard"));
const CeoHomePage = lazyWithRetry(() => import("@/pages/ceo-home"));
const CooHomePage = lazyWithRetry(() => import("@/pages/coo-home"));
const SettingsHomePage = lazyWithRetry(() => import("@/pages/settings-home"));
const ProjectDocumentsPage = lazyWithRetry(() => import("@/pages/project-documents"));
const DocumentsPage = lazyWithRetry(() => import("@/pages/documents"));
// (removed) QuickBooksHomePage — orphaned surface, consolidated into FinanceQuickBooksThroughputPage in Task #30.
const AdminDocumentManagementPage = lazyWithRetry(() => import("@/pages/admin-document-management"));
const AdminImportMappingsPage = lazyWithRetry(() => import("@/pages/admin-import-mappings"));
const AdminEmailLinkerDevPage = lazyWithRetry(() => import("@/pages/admin-email-linker-dev"));
const AdminPriorityTemplatesPage = lazyWithRetry(() => import("@/pages/admin-priority-templates"));
const HandoverLivePage = lazyWithRetry(() => import("@/pages/handover-live"));
const ProjectLifecyclePage = lazyWithRetry(() => import("@/pages/project-lifecycle"));
// "All Projects" (/projects) retired — its features were migrated into the
// Execution board. The route now redirects there (see projects-redirect.tsx).
const ProjectsSummary = lazyWithRetry(() => import("@/pages/projects-redirect"));
const CashflowPage = lazyWithRetry(() => import("@/pages/cashflow"));
const CashflowAnalysisPage = lazyWithRetry(() => import("@/pages/cashflow-analysis"));
const RevenueTrackerPage = lazyWithRetry(() => import("@/pages/revenue-tracker"));
const FyeRevenueTrackingPage = lazyWithRetry(() => import("@/pages/fye-revenue-tracking"));
const RevenueTrackingReplicaPage = lazyWithRetry(() => import("@/pages/revenue-tracking"));
const ExpenditureBreakdownReplicaPage = lazyWithRetry(() => import("@/pages/expenditure-breakdown"));
const ProgramPlanReplicaPage = lazyWithRetry(() => import("@/pages/program-plan"));
const ManualOverridesPage = lazyWithRetry(() => import("@/pages/manual-overrides"));
const CostTracker = lazyWithRetry(() => import("@/pages/cos"));
const CosAnalysisPage = lazyWithRetry(() => import("@/pages/cos-analysis"));
const ProjectDetailPage = lazyWithRetry(() => import("@/pages/project-detail"));
const ProjectStageGatePage = lazyWithRetry(() => import("@/pages/project-stage-gate"));
const MyWorkAdminSettingsPage = lazyWithRetry(() => import("@/pages/my-work-admin-settings"));
const MyWorkMeetingsPage = lazyWithRetry(() => import("@/pages/my-work-meetings"));
const MyWorkSettingsPage = lazyWithRetry(() => import("@/pages/my-work-settings"));
const QmDashboardPage = lazyWithRetry(() => import("@/pages/qm-dashboard"));
const EngineeringHomePage = lazyWithRetry(() => import("@/pages/engineering/EngineeringHomePage"));
const EngineeringTasksPage = lazyWithRetry(() => import("@/pages/engineering/EngineeringTaskManagerPage"));
const EngineeringAuditPage = lazyWithRetry(() => import("@/pages/engineering-audit"));
const RoleSettingsPage = lazyWithRetry(() => import("@/pages/role-settings"));
const LifecycleBoardPage = lazyWithRetry(() => import("@/pages/lifecycle-board"));
// Execution control tower — replaces the legacy /execution-board surface.
const ExecutionReviewBoardPage = lazyWithRetry(() => import("@/pages/execution-review"));
const ExecutionReviewDetailPage = lazyWithRetry(() => import("@/pages/execution-review-detail"));
const ExecutionMilestonesPage = lazyWithRetry(() => import("@/pages/milestone-tracker"));
const ExecutionDeliveriesPage = lazyWithRetry(() => import("@/pages/execution-deliveries"));
const ExecutionAllocationsPage = lazyWithRetry(() => import("@/pages/execution-allocations"));
const NowPage = lazyWithRetry(() => import("@/pages/now"));
// PR-C redesign (2026-05-27) — /my-queue consolidates POs + payment
// requests + change requests + stage exceptions into one screen.
const MyQueuePage = lazyWithRetry(() => import("@/pages/my-queue"));
// PR-D redesign (2026-05-27) — /portfolio is the 6-column lens-aware
// replacement for the 50-column /projects table. Legacy stays.
const PortfolioPage = lazyWithRetry(() => import("@/pages/portfolio"));
const SmartImportPage = lazyWithRetry(() => import("@/pages/smart-import"));
const SharePointIntakePage = lazyWithRetry(() => import("@/pages/SharePointIntakePage"));
const InvoicePatternsPage = lazyWithRetry(() => import("@/pages/invoice-patterns"));
const SubcontractorDashboardPage = lazyWithRetry(() => import("@/pages/subcontractor-dashboard"));
const CounterpartiesPage = lazyWithRetry(() => import("@/pages/counterparties"));
const SystemActivityLogPage = lazyWithRetry(() => import("@/pages/system-activity-log"));
const WeeklyReviewsPage = lazyWithRetry(() => import("@/pages/weekly-reviews"));
// Task #107: AdminRolesPage is the new single-screen rail + right-panel layout
// (no tabs). Retired the tabbed admin-roles-shell.tsx and the 2638-line
// admin-roles.tsx — both deleted in this task.
const AdminRolesPage = lazyWithRetry(() => import("@/pages/admin-roles/index"));
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
const PriorityLineagePage = lazyWithRetry(() => import("@/pages/priority-lineage"));
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
const POApprovalBoardPage = lazyWithRetry(() => import("@/pages/po-approval-board"));
const PaymentRequestBoardPage = lazyWithRetry(() => import("@/pages/payment-request-board"));
const PaymentBatchManagerPage = lazyWithRetry(() => import("@/pages/payment-batch-manager"));
const HseDashboardPage = lazyWithRetry(() => import("@/pages/hse-dashboard"));
const HandoverDashboardPage = lazyWithRetry(() => import("@/pages/handover-dashboard"));
const SsegSubmissionsPage = lazyWithRetry(() => import("@/pages/sseg-submissions"));
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
const AdminBackfillPage = lazyWithRetry(() => import("@/pages/admin-backfill"));
const AdminWorkItemLinkagePage = lazyWithRetry(() => import("@/pages/admin-work-item-linkage"));
const AdminWorkflowConfigPage = lazyWithRetry(() => import("@/pages/admin-workflow-config"));

const CommissioningDashboardPage = lazyWithRetry(() => import("@/pages/commissioning-dashboard"));

// "Milestone Tracker" (/milestone-tracker, Revenue Milestones) retired — the
// route now redirects to the Execution board (see milestone-tracker-redirect.tsx).
const MilestoneTrackerPage = lazyWithRetry(() => import("@/pages/milestone-tracker-redirect"));
const DeliveryMilestonesPage = lazyWithRetry(() => import("@/pages/delivery-milestones"));

const GatesPipelinePage = lazyWithRetry(() => import("@/pages/gates/gates-pipeline"));
const GatesBlockedPage = lazyWithRetry(() => import("@/pages/gates/gates-blocked"));
const GatesReadyPage = lazyWithRetry(() => import("@/pages/gates/gates-ready"));
const GatesExceptionsPage = lazyWithRetry(() => import("@/pages/gates/gates-exceptions"));
const GatesClientUpdatesPage = lazyWithRetry(() => import("@/pages/gates/gates-client-updates"));
const GatesHandoversPage = lazyWithRetry(() => import("@/pages/gates/gates-handovers"));
const GatesQueriesPage = lazyWithRetry(() => import("@/pages/gates/gates-queries"));
const GatesCommitmentsPage = lazyWithRetry(() => import("@/pages/gates/gates-commitments"));
const PendingApprovalsPage = lazyWithRetry(() => import("@/pages/pending-approvals"));
const NcrLegacyRedirect = lazyWithRetry(() => import("@/pages/ncr-legacy-redirect"));
const FinanceGpPage = lazyWithRetry(() => import("@/pages/finance-gp"));
const FinanceGpCompanyPage = lazyWithRetry(() => import("@/pages/finance-gp-company"));
const FinanceAuditPrepPage = lazyWithRetry(() => import("@/pages/finance-audit-prep"));
const FinanceQbReconciliationPage = lazyWithRetry(() => import("@/pages/finance-qb-reconciliation"));
const FinanceHomePage = lazyWithRetry(() => import("@/pages/finance-home"));
const FinanceHealthPage = lazyWithRetry(() => import("@/pages/finance-health"));
const FinanceProjectDetailPage = lazyWithRetry(() => import("@/pages/finance-project-detail"));
const FinanceWeeklyClosePage = lazyWithRetry(() => import("@/pages/finance-weekly-close"));
// Phase-1 new pages — Engineering Doc Mgmt, Quality Task Board + Doc Mgmt,
// Functionality Control, Integration Statuses.
const EngineeringDocumentsPage = lazyWithRetry(() => import("@/pages/engineering/documents"));
const QualityTasksPage = lazyWithRetry(() => import("@/pages/quality/tasks"));
const QualityDocumentsPage = lazyWithRetry(() => import("@/pages/quality/documents"));
const AdminFunctionalityPage = lazyWithRetry(() => import("@/pages/admin-functionality"));
const AdminIntegrationsPage = lazyWithRetry(() => import("@/pages/admin-integrations"));

/**
 * Maps PageRegistryEntry.routeComponentKey → the lazy-loaded page component.
 * Used by the router to mount each route; extracted from App.tsx so the
 * registry↔router parity can be asserted in unit tests without pulling in
 * the full App tree.
 */
export const ROUTE_COMPONENTS: Record<string, ComponentType<any>> = {
  CompanyOverviewPage,
  CompanyTeamPage,
  Dashboard,
  ProjectLifecyclePage,
  ProjectsSummary,
  FinancialLinkingPage,
  ProjectDetailPage,
  ProjectStageGatePage,
  CashflowPage,
  CashflowAnalysisPage,
  CostTracker,
  CosAnalysisPage,
  RevenueTrackerPage,
  FyeRevenueTrackingPage,
  RevenueTrackingReplicaPage,
  ExpenditureBreakdownReplicaPage,
  ProgramPlanReplicaPage,
  ManualOverridesPage,
  MyWorkAdminSettingsPage,
  QmDashboardPage,
  EngineeringHomePage,
  EngineeringTasksPage,
  EngineeringAuditPage,
  LifecycleBoardPage,
  ExecutionReviewBoardPage,
  ExecutionReviewDetailPage,
  ExecutionMilestonesPage,
  ExecutionDeliveriesPage,
  ExecutionAllocationsPage,
  NowPage,
  MyQueuePage,
  PortfolioPage,
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
  PriorityLineagePage,
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
  POApprovalBoardPage,
  PaymentRequestBoardPage,
  PaymentBatchManagerPage,
  HseDashboardPage,
  HandoverDashboardPage,
  SsegSubmissionsPage,
  LessonsLearntPage,
  SitesPage,
  OpportunitiesPage,
  PdDashboardPage,
  AdminPipedrivePage,
  AdminQuickBooksPage,
  FinanceQuickBooksLinksPage,
  FinanceQuickBooksCustomerMappingPage,
  FinanceGpPage,
  FinanceGpCompanyPage,
  FinanceAuditPrepPage,
  FinanceQbReconciliationPage,
  FinanceHomePage,
  FinanceHealthPage,
  FinanceProjectDetailPage,
  FinanceWeeklyClosePage,
  AdminBackfillPage,
  AdminWorkItemLinkagePage,
  AdminWorkflowConfigPage,
  MilestoneTrackerPage,
  DeliveryMilestonesPage,
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
  DocumentsPage,
  AdminDocumentManagementPage,
  AdminImportMappingsPage,
  AdminEmailLinkerDevPage,
  AdminPriorityTemplatesPage,
  HandoverLivePage,
  PendingApprovalsPage,
  NcrLegacyRedirect,
  EngineeringDocumentsPage,
  QualityTasksPage,
  QualityDocumentsPage,
  AdminFunctionalityPage,
  AdminIntegrationsPage,
};

export const ROUTE_COMPONENT_KEYS: ReadonlySet<string> = new Set(Object.keys(ROUTE_COMPONENTS));
