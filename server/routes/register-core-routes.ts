import type { Express } from "express";

export async function registerCoreRoutes(app: Express) {
  const { registerQualityRoutes } = await import("../quality-routes");
  registerQualityRoutes(app);
  const { registerEngineeringRoutes } = await import("../engineering-routes");
  registerEngineeringRoutes(app);
  const { registerEngStageRoutes } = await import("../eng-stage-routes");
  registerEngStageRoutes(app);
  const { registerLifecycleRoutes } = await import("../lifecycle-routes");
  registerLifecycleRoutes(app);
  const { registerReportRoutes } = await import("../report-routes");
  registerReportRoutes(app);
  const { registerTemplateRoutes } = await import("../template-routes");
  registerTemplateRoutes(app);
  const { registerApiV2Routes } = await import("../api/v2/routes/v2-routes");
  registerApiV2Routes(app);
}
