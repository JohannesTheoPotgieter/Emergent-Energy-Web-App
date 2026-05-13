import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import {
  isQualityTaskRecord,
  parseQualityTaskQuery,
} from "../lib/quality-task-filters";

export { isQualityTaskRecord, parseQualityTaskQuery };

export function registerQualityTasksRoutes(app: Express) {
  app.get(
    "/api/quality/tasks",
    requireAuth,
    requirePermission("quality", "view"),
    async (req: Request, res: Response) => {
      try {
        const filters = parseQualityTaskQuery(req.query as Record<string, unknown>);
        const { listQualityTasks } = await import("../repositories/quality-tasks-repository");
        const result = await listQualityTasks(filters);
        res.json(result);
      } catch (err) {
        console.error("[QualityTasks] Failed to fetch quality tasks:", err);
        res.status(500).json({ error: "Failed to fetch quality tasks" });
      }
    },
  );
}
