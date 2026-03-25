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
}
