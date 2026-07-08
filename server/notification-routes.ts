import type { Express, Request, Response } from "express";
import { db } from "./db";
import { notifications } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "./auth-context";
import { parseIntParam } from "./lib/req-params";

export function registerNotificationRoutes(app: Express) {
  // Get user's notifications (recent + unread)
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

      // Surface the entity reference the client's "View" link reads. createNotification
      // packs it into changeDetails as {entityType, entityId}; without hoisting it to
      // top-level fields the client always sees undefined and the link never renders.
      const enriched = rows.map((r: any) => {
        let entityType: string | null = null;
        let entityId: number | null = null;
        if (r.changeDetails) {
          try {
            const parsed = JSON.parse(r.changeDetails);
            if (parsed && typeof parsed === "object") {
              if (typeof parsed.entityType === "string") entityType = parsed.entityType;
              if (typeof parsed.entityId === "number") entityId = parsed.entityId;
            }
          } catch {
            // Malformed/legacy changeDetails — leave the entity ref unset.
          }
        }
        return { ...r, entityType, entityId };
      });

      // Authoritative unread count for the whole inbox, not just the fetched window
      // (a user with more unread than `limit` would otherwise see an undercount that
      // disagrees with the bell badge).
      const unreadResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));
      const unreadCount = Number(unreadResult[0]?.count ?? 0);

      res.json({ notifications: enriched, unreadCount });
    } catch (err: unknown) {
      throw err;
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
      throw err;
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
      throw err;
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
      throw err;
    }
  });

  // Legacy PATCH routes — kept for backward compatibility
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid notification ID" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: unknown) {
      throw err;
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
      throw err;
    }
  });
}
