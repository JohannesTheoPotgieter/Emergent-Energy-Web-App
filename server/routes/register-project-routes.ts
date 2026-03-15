import type { Express } from "express";

export async function registerProjectRoutes(app: Express, ensureSchema: boolean) {
  const { registerPmRoutes } = await import("../pm-routes");
  registerPmRoutes(app);
  const { registerPmOnTheGoRoutes } = await import("../pm-on-the-go-routes");
  registerPmOnTheGoRoutes(app);
  const { registerPoRoutes, ensurePoTables } = await import("../po-routes");
  if (ensureSchema) await ensurePoTables();
  registerPoRoutes(app);
  const { registerDeliverableCaptureRoutes, ensureDeliverableCaptureColumns } = await import("../deliverable-capture-routes");
  if (ensureSchema) await ensureDeliverableCaptureColumns();
  registerDeliverableCaptureRoutes(app);
  const { registerPortfolioRoutes } = await import("../portfolio-routes");
  registerPortfolioRoutes(app);
  const { registerPdRoutes } = await import("../pd-routes");
  registerPdRoutes(app);
}
