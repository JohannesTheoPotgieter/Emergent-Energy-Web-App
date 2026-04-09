import type { Express, Request, Response } from "express";
import { db } from "./db";
import { notifications } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "./auth-context";

export function registerNotificationRoutes(app: Express) {
  // Get user's notifications (recent + unread)
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const limit = parseInt(req.query.limit as string, 10) || 30;
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

      const unreadCount = rows.filter((r: any) => !r.isRead).length;

      res.json({ notifications: rows, unreadCount });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // Unread count — lightweight endpoint used by NotificationBell polling
  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));

      res.json({ count: Number(result[0]?.count ?? 0) });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // Mark single notification as read (POST — matches frontend engPost calls)
  app.post("/api/notifications/mark-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.body?.notificationId as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid notification ID" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // Mark all notifications as read (POST — matches frontend engPost calls)
  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // Legacy PATCH routes — kept for backward compatibility
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid notification ID" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  app.patch("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });
}
