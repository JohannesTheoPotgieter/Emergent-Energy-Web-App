/**
 * LEGACY ROUTE SHELL — All handlers have been extracted.
 *
 * This file exists only as a thin registry that calls already-extracted
 * sub-route registration functions. It is imported by server/routes/index.ts
 * as registerLegacyRoutes.
 *
 * Handler history: 167 → 0 (fully extracted across Phases 1–9b).
 * New routes MUST go in server/routes/ or server/departments/ domain files.
 */
// @ts-nocheck
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { registerAuthRoutes } from "./routes/auth-routes";
import { registerWorkingPlanRoutes } from "./routes/working-plan-routes";
import { registerOperationalTasksRoutes } from "./routes/operational-tasks-routes";
import { registerCosControlRoutes } from "./routes/cos-control-routes";
import { registerPlanningTasksRoutes } from "./routes/planning-tasks-routes";
import { registerDashboardRoutes } from "./routes/dashboard-routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await registerAuthRoutes(app);
  registerDashboardRoutes(app);
  registerWorkingPlanRoutes(app);
  registerCosControlRoutes(app);
  registerOperationalTasksRoutes(app);
  registerPlanningTasksRoutes(app);

  return httpServer;
}
