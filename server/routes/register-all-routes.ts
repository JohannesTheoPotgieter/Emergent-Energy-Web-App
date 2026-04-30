import type { Express } from "express";
import type { Server } from "http";
import { registerRoutes } from "../routes";
import { registerCoreRoutes } from "./register-core-routes";
import { registerProjectRoutes } from "./register-project-routes";
import { registerDepartmentRoutes } from "./register-department-routes";
import { registerAdminSupportRoutes } from "./register-admin-routes";
import { registerIntegrationRoutes } from "./register-integration-routes";
import { registerInfoRoutes } from "./register-info-routes";
import { registerSupportRoutes } from "./register-support-routes";
import { registerExtractedRoutes } from "./route-registry";
import { applyLegacyUrlAliases } from "../middleware/legacy-url-aliases";
import { registerTrackerReplicaRoutes } from "./tracker-replica.routes";

export async function registerAllRoutes(options: {
  app: Express;
  httpServer: Server;
  log: (message: string, source?: string) => void;
}) {
  const { app, httpServer, log } = options;

  // Task #61: alias /api/engineering-tickets/* -> /api/pd/tickets/* and
  // /api/engineering-pm-handover/* -> /api/pd-pm-handover/* before any
  // route handler runs, and log deprecation when legacy URLs are used.
  applyLegacyUrlAliases(app);

  await registerCoreRoutes(app);
  await registerIntegrationRoutes(app);
  await registerInfoRoutes(app);
  await registerProjectRoutes(app);
  await registerSupportRoutes(app);
  await registerDepartmentRoutes(app);
  await registerAdminSupportRoutes(app);
  await registerExtractedRoutes(app);
  // Tracker replica read-only endpoints feeding the per-project replica
  // screens. Wired here directly because server/routes/index.ts is an
  // orphan file (not invoked by the bootstrap), which would silently
  // 404 these routes — see "Pre-existing orphan registry" note in the
  // PR description.
  registerTrackerReplicaRoutes(app);
  await registerRoutes(httpServer, app);

  log("All route groups registered", "Startup:Routes");
}
