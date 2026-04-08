/**
 * Route Registry — Single entry point for all extracted route modules.
 *
 * As routes are extracted from server/routes.ts into domain-specific files,
 * they are registered here. This file will eventually replace server/routes.ts
 * as the sole route registration point.
 *
 * Usage: called from register-all-routes.ts
 */

import type { Express } from "express";

export async function registerExtractedRoutes(app: Express) {
  // Phase 1: MyTool routes (34 handlers, extracted from routes.ts)
  const { registerMytoolRoutes } = await import("./mytool-routes");
  registerMytoolRoutes(app);

  // Phase 2: MS Integration routes (23 handlers, extracted from routes.ts)
  const { registerMsIntegrationRoutes } = await import("./ms-integration-extracted-routes");
  await registerMsIntegrationRoutes(app);

  // Phase 3a: Support routes (29 handlers + error handler, extracted from routes.ts)
  const { registerSupportExtractedRoutes } = await import("./support-extracted-routes");
  await registerSupportExtractedRoutes(app);

  // Phase 3b: Clients routes (2 handlers, extracted from routes.ts)
  const { registerClientsExtractedRoutes } = await import("./clients-extracted-routes");
  registerClientsExtractedRoutes(app);

  // Phase 4a: Work Items routes (7 handlers, extracted from routes.ts)
  const { registerWorkItemsExtractedRoutes } = await import("./work-items-extracted-routes");
  registerWorkItemsExtractedRoutes(app);

  // Phase 4b: Planning routes (7 handlers, extracted from routes.ts)
  const { registerPlanningExtractedRoutes } = await import("./planning-extracted-routes");
  registerPlanningExtractedRoutes(app);

  // Phase 4c: Project Info routes (12 handlers, extracted from routes.ts)
  const { registerProjectInfoExtractedRoutes } = await import("./project-info-extracted-routes");
  registerProjectInfoExtractedRoutes(app);

  // Phase 5: Misc read routes (2 handlers, extracted from routes.ts)
  const { registerMiscExtractedRoutes } = await import("./misc-extracted-routes");
  registerMiscExtractedRoutes(app);

  // Phase 7: Home / Reporting routes (5 handlers, extracted from routes.ts)
  const { registerHomeExtractedRoutes } = await import("./home-extracted-routes");
  registerHomeExtractedRoutes(app);

  // Future phases will add more domain modules here.
}
