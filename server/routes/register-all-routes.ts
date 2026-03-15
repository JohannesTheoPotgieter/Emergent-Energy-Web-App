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

export async function registerAllRoutes(options: {
  app: Express;
  httpServer: Server;
  runtimeSchemaRepairEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { app, httpServer, runtimeSchemaRepairEnabled, log } = options;

  await registerCoreRoutes(app);
  await registerIntegrationRoutes(app);
  await registerInfoRoutes(app);
  await registerProjectRoutes(app, runtimeSchemaRepairEnabled);
  await registerSupportRoutes(app, runtimeSchemaRepairEnabled);
  await registerDepartmentRoutes(app);
  await registerAdminSupportRoutes(app);
  await registerRoutes(httpServer, app);

  log("All route groups registered", "Startup:Routes");
}
