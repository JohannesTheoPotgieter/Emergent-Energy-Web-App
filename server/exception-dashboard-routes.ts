import { Express, NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";
import { getExceptionDashboard, summarizeExceptions } from "./services/exception-dashboard-service";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

export function registerExceptionDashboardRoutes(app: Express) {
  app.get("/api/exceptions", jwtAuth, requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as { id: number; role?: string };
      const projectId = req.query.projectId ? Number(req.query.projectId) : null;
      const result = await getExceptionDashboard({ userId: user.id, role: user.role, projectId: Number.isFinite(projectId) ? projectId : null });
      res.json({ ...result, summary: summarizeExceptions(result.items) });
    } catch (error: any) {
      res.status(500).json({ error: "exception_dashboard_failed", message: error?.message || "Unable to load exceptions" });
    }
  });

  app.get("/api/exceptions/summary", jwtAuth, requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as { id: number; role?: string };
      const result = await getExceptionDashboard({ userId: user.id, role: user.role });
      res.json(summarizeExceptions(result.items));
    } catch (error: any) {
      res.status(500).json({ error: "exception_summary_failed", message: error?.message || "Unable to load exception summary" });
    }
  });
}
