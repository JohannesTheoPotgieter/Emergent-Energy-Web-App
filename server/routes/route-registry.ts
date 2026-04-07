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

  // Future phases will add more domain modules here.
}
