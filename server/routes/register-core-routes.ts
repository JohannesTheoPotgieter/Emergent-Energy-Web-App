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
}
