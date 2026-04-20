import { Express, NextFunction, Request, Response } from "express";
import { getExceptionDashboard, summarizeExceptions } from "./services/exception-dashboard-service";
import { jwtAuth, requireAuth } from "./auth-context";

export function registerExceptionDashboardRoutes(app: Express) {
  app.get("/api/exceptions", jwtAuth, requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as { id: number; role?: string };
      const projectId = req.query.projectId ? Number(req.query.projectId) : null;
      const result = await getExceptionDashboard({ userId: user.id, role: user.role, projectId: Number.isFinite(projectId) ? projectId : null });
      res.json({ ...result, summary: summarizeExceptions(result.items) });
    } catch (error: any) {
      res.status(500).json({ error: "exception_dashboard_failed" });
    }
  });

  app.get("/api/exceptions/summary", jwtAuth, requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as { id: number; role?: string };
      const result = await getExceptionDashboard({ userId: user.id, role: user.role });
      res.json(summarizeExceptions(result.items));
    } catch (error: any) {
      res.status(500).json({ error: "exception_summary_failed" });
    }
  });
}
