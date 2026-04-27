import { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import { listProjectEvents } from "./services/project-event-service";
import { parseIntParam } from "./lib/req-params";

export function registerProjectEventsRoutes(app: Express): void {
  app.get("/api/project-events/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[project-events] list error", message);
      res.status(500).json({ error: "Failed to load project events" });
    }
  });
}
