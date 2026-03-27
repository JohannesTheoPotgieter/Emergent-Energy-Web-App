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
import { registerCashflow2026Routes } from "./register-cashflow-2026-routes";
// Extracted route modules (registered via registerRoutes in ../routes.ts):
// - ./working-plan-routes.ts
// - ./operational-tasks-routes.ts
// - ./cos-control-routes.ts
// - ./planning-tasks-routes.ts
// - ./dashboard-routes.ts
// - ./register-cashflow-2026-routes.ts

export async function registerAllRoutes(options: {
  app: Express;
  httpServer: Server;
  log: (message: string, source?: string) => void;
}) {
  const { app, httpServer, log } = options;

  await registerCoreRoutes(app);
  await registerIntegrationRoutes(app);
  await registerInfoRoutes(app);
  await registerProjectRoutes(app);
  await registerSupportRoutes(app);
  await registerDepartmentRoutes(app);
  await registerAdminSupportRoutes(app);
  registerCashflow2026Routes(app);
  await registerRoutes(httpServer, app);

  log("All route groups registered", "Startup:Routes");
}
