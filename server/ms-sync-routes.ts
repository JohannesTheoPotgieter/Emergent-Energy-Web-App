import type { Express, Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import { z } from "zod";
import {
  tagToProject,
  untagFromProject,
  getProjectLinkedItems,
  getUserMsObjects,
  convertToTask,
} from "./project-linking-service";
import { syncAllForUser, syncUserCalendar, syncUserEmail, syncUserTeams, getSyncStatus } from "./ms-sync-service";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
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

const tagSchema = z.object({
  projectId: z.number(),
  note: z.string().optional(),
});

export function registerMsSyncRoutes(app: Express) {
  app.post("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const parsed = tagSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const result = await tagToProject(msObjectId, parsed.data.projectId, userId, parsed.data.note);
      res.json(result);
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      await untagFromProject(msObjectId, userId);
      res.json({ success: true });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get("/api/ms-objects/mine", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : undefined;
      const actionRequired = String(req.query.action_required) === "true";

      let items = await getUserMsObjects(userId, type, limit);

      if (actionRequired) {
        items = items.filter((item: any) => item.actionRequired === true);
      }

      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-objects/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const items = await getProjectLinkedItems(projectId, userId);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-objects/:id/convert-to-task", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const result = await convertToTask(msObjectId, userId);
      res.json(result);
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get("/api/ms-sync/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });
      const status = await getSyncStatus(userId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  app.post("/api/ms-sync/trigger", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const { type } = req.body;
      let results;
      if (type === "calendar") {
        results = [await syncUserCalendar(userId)];
      } else if (type === "email") {
        results = [await syncUserEmail(userId)];
      } else if (type === "teams") {
        results = [await syncUserTeams(userId)];
      } else {
        results = await syncAllForUser(userId);
      }
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ error: "Sync failed: " + err.message });
    }
  });

  app.post("/api/webhooks/graph", async (req: Request, res: Response) => {
    if (req.query.validationToken) {
      return res.status(200).contentType("text/plain").send(req.query.validationToken as string);
    }
    try {
      const notifications = req.body?.value || [];
      for (const notification of notifications) {
        console.log("[Graph Webhook] Received:", notification.changeType, notification.resource);
      }
      res.status(202).json({ status: "accepted" });
    } catch (err: any) {
      console.error("[Graph Webhook] Error:", err);
      res.status(202).json({ status: "accepted" });
    }
  });
}
