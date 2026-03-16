import { Express, NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";
import { listProjectEvents } from "./services/project-event-service";

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
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

export function registerProjectEventsRoutes(app: Express) {
  app.get("/api/project-events/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (Number.isNaN(projectId)) {
        return res.status(400).json({ error: "Invalid projectId" });
      }

      const eventTypes = req.query.eventTypes
        ? String(req.query.eventTypes)
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;

      const actorUserId = req.query.actorUserId ? parseInt(String(req.query.actorUserId), 10) : undefined;
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;
      const order = req.query.order === "asc" ? "asc" : "desc";
      const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10), 1000) : 250;

      const events = await listProjectEvents({ projectId, eventTypes, actorUserId, from, to, order, limit });
      res.json({ events });
    } catch (error: any) {
      console.error("[project-events] list error", error?.message || error);
      res.status(500).json({ error: "Failed to load project events" });
    }
  });
}
