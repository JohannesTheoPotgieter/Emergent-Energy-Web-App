import type { Express } from "express";
import type { Server } from "http";
// Switched from `../routes` (the legacy shell) to `./index` so the
// previously-orphaned route domain registry actually runs. routes/index.ts
// registers a dozen new-pattern domains (template-governance, quickbooks,
// finance-trust, pd-intake, controlled-documents, impact, email-links,
// admin-screen-settings, exception-dashboard, document-management,
// document-comments, tracker-replica) AND calls back to the legacy
// registerRoutes — so this swap is additive: nothing that worked before
// stops working, and the previously-dead endpoints come online.
import { registerRoutes } from "./index";
import { registerCoreRoutes } from "./register-core-routes";
import { registerProjectRoutes } from "./register-project-routes";
import { registerDepartmentRoutes } from "./register-department-routes";
import { registerAdminSupportRoutes } from "./register-admin-routes";
import { registerIntegrationRoutes } from "./register-integration-routes";
import { registerInfoRoutes } from "./register-info-routes";
import { registerSupportRoutes } from "./register-support-routes";
import { registerExtractedRoutes } from "./route-registry";
import { applyLegacyUrlAliases } from "../middleware/legacy-url-aliases";

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
  // Register the extracted (newer) routes BEFORE department routes — Express
  // resolves the first matching handler, so the older duplicate POST
  // /api/mytool/tasks in server/departments/exco-routes.ts must not win
  // over the newer one in server/routes/mytool-routes.ts (which has the
  // x-idempotency-key dedup).
  await registerExtractedRoutes(app);
  await registerDepartmentRoutes(app);
  await registerAdminSupportRoutes(app);
  // Calls the orphan-registry's registerRoutes which now activates
  // tracker-replica + 11 sibling domains, then chains to the legacy
  // shell.
  await registerRoutes(httpServer, app);

  log("All route groups registered", "Startup:Routes");
}
