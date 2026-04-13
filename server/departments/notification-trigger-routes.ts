/**
 * C5: Notification trigger admin routes
 * Provides status, force-run, and rules listing for the notification trigger system.
 */
import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { checkAllNotificationTriggers } from "../services/notification-triggers";
import { getSchedulerStatus } from "../services/notification-trigger-scheduler";

const TRIGGER_RULES = [
  { name: "snag_overdue", description: "Snag past due date — notify assigned user", active: true },
  { name: "approval_overdue", description: "Approval pending > 3 days — notify approver", active: true },
  { name: "inspection_due", description: "Inspection scheduled within 2 days — notify inspector", active: true },
  { name: "procurement_delivery_late", description: "Delivery past expected date — notify PM", active: true },
  { name: "handover_stalled", description: "Handover pack unchanged for >7 days — notify PM", active: true },
];

export function registerNotificationTriggerRoutes(app: Express) {
  // GET /api/notification-triggers/status — scheduler status (any authenticated user)
  app.get(
    "/api/notification-triggers/status",
    jwtAuth,
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        const status = getSchedulerStatus();
        res.json(status);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch scheduler status" });
      }
    }
  );

  // POST /api/notification-triggers/run-now — force immediate check (admin only)
  app.post(
    "/api/notification-triggers/run-now",
    jwtAuth,
    requireAuth,
    requirePermission("admin", "edit"),
    async (_req: Request, res: Response) => {
      try {
        const results = await checkAllNotificationTriggers();
        const totalNotified = results.reduce((sum, r) => sum + r.notified, 0);
        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
        res.json({ results, totalNotified, totalErrors });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "Trigger run failed", message: msg });
      }
    }
  );

  // GET /api/notification-triggers/rules — list active trigger types (any authenticated user)
  app.get(
    "/api/notification-triggers/rules",
    jwtAuth,
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        res.json({ rules: TRIGGER_RULES });
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch trigger rules" });
      }
    }
  );
}
