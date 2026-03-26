/**
 * C5: Notification trigger check endpoint.
 * Admin can manually trigger checks; also used by scheduled jobs.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { checkAllNotificationTriggers } from "../services/notification-triggers";

const router = Router();

router.post("/api/admin/check-notification-triggers", requireAuth, async (_req: Request, res: Response) => {
  try {
    const results = await checkAllNotificationTriggers();
    res.json({ results, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Notifications] Trigger check failed:", err);
    res.status(500).json({ error: "Trigger check failed" });
  }
});

router.get("/api/admin/notification-trigger-status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const results = await checkAllNotificationTriggers();
    const summary = {
      totalTriggers: results.length,
      totalItems: results.reduce((sum, r) => sum + r.count, 0),
      triggers: results,
      checkedAt: new Date().toISOString(),
    };
    res.json(summary);
  } catch (err) {
    console.error("[Notifications] Trigger status failed:", err);
    res.status(500).json({ error: "Failed to check trigger status" });
  }
});

export function registerNotificationTriggerRoutes(app: Express) {
  app.use(router);
}
