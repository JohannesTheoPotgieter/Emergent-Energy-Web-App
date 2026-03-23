import type { Express, Request, Response } from "express";
import { db } from "./db";
import { notifications } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export function registerNotificationRoutes(app: Express) {
  // Get user's notifications (recent + unread)
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const limit = parseInt(req.query.limit as string) || 30;
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

      const unreadCount = rows.filter(r => !r.isRead).length;

      res.json({ notifications: rows, unreadCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark single notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid notification ID" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark all notifications as read
  app.patch("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
