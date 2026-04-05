import type { Express } from "express";

export async function registerCoreRoutes(app: Express) {
  const { registerPlatformRoutes } = await import("../platform-routes");
  registerPlatformRoutes(app);
  const { registerQualityRoutes } = await import("../quality-routes");
  registerQualityRoutes(app);
  const { registerEngineeringRoutes } = await import("../engineering-routes");
  registerEngineeringRoutes(app);
  const { registerEngStageRoutes } = await import("../eng-stage-routes");
  registerEngStageRoutes(app);
  const { registerEngineeringIntakeRoutes } = await import("../engineering-intake-routes");
  registerEngineeringIntakeRoutes(app);
  const { registerLifecycleRoutes } = await import("../lifecycle-routes");
  registerLifecycleRoutes(app);
  const { registerGatesRoutes } = await import("./gates-routes");
  registerGatesRoutes(app);
  const { registerApprovalsRoutes } = await import("./approvals-routes");
  registerApprovalsRoutes(app);
  const { registerGovernanceViewsRoutes } = await import("./governance-views-routes");
  registerGovernanceViewsRoutes(app);
  const { registerPerformanceRoutes } = await import("./performance-routes");
  registerPerformanceRoutes(app);
  const { registerStageAdminRoutes } = await import("./stage-admin-routes");
  registerStageAdminRoutes(app);
  const { registerProjectAccessRoutes } = await import("./project-access-routes");
  registerProjectAccessRoutes(app);
  const { registerReportRoutes } = await import("../report-routes");
  registerReportRoutes(app);
  const { registerTemplateRoutes } = await import("../template-routes");
  registerTemplateRoutes(app);
  const { registerApiV2Routes } = await import("../api/v2/routes/v2-routes");
  registerApiV2Routes(app);
  const { registerTaskManagementRoutes } = await import("../task-management-routes");
  registerTaskManagementRoutes(app);
  const { registerStandupRoutes } = await import("../standup-routes");
  registerStandupRoutes(app);
  // Role-based UX upgrade: lens config routes
  try {
    const { registerLensConfigRoutes } = await import("./lens-config-routes");
    registerLensConfigRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register lens config routes:", (err instanceof Error ? err.message : String(err)));
  }
  try {
    const { registerPmMonthlyReportRoutes } = await import("./pm-monthly-report-routes");
    registerPmMonthlyReportRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register PM monthly report routes:", (err instanceof Error ? err.message : String(err)));
  }
  try {
    const { registerEngineeringMonthlyReportRoutes } = await import("./engineering-monthly-report-routes");
    registerEngineeringMonthlyReportRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Engineering monthly report routes:", (err instanceof Error ? err.message : String(err)));
  }
  try {
    const { registerCompanyOverviewRoutes } = await import("./company-overview-routes");
    registerCompanyOverviewRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Company Overview routes:", (err instanceof Error ? err.message : String(err)));
  }

  // Wave 1: Parties registry (reads from core.parties)
  try {
    const { registerPartiesRoutes } = await import("./parties.routes");
    registerPartiesRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Parties routes:", (err instanceof Error ? err.message : String(err)));
  }

  // Wave 1: Home summary dashboard
  try {
    const { registerHomeSummaryRoutes } = await import("./home-summary.routes");
    registerHomeSummaryRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Home Summary routes:", (err instanceof Error ? err.message : String(err)));
  }

  // Wave 1: Admin migration status
  try {
    const { registerMigrationStatusRoutes } = await import("./migration-status.routes");
    registerMigrationStatusRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Migration Status routes:", (err instanceof Error ? err.message : String(err)));
  }

  // Wave 2: Work items v2 (promoted schema)
  try {
    const { registerWorkItemsV2Routes } = await import("./work-items-v2.routes");
    registerWorkItemsV2Routes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Work Items V2 routes:", (err instanceof Error ? err.message : String(err)));
  }

  // Wave 3: Governed processes (formal workflows)
  try {
    const { registerGovernedProcessRoutes } = await import("./governed-processes.routes");
    registerGovernedProcessRoutes(app);
  } catch (err: unknown) {
    console.error("[Startup:Routes] Failed to register Governed Process routes:", (err instanceof Error ? err.message : String(err)));
  }
}
