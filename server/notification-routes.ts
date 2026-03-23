import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { notifications } from "@shared/schema";

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

function getUser(req: Request): { id: number; name?: string; role?: string } {
  const u = (req as any).user;
  if (u) return u;
  const sess = req.user as any;
  return { id: sess?.id ?? 0, name: sess?.username, role: sess?.role };
}

export function registerNotificationRoutes(app: Express) {

  /** GET unread count for current user */
  app.get("/api/notifications/unread-count", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));
      res.json({ count: row?.count ?? 0 });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  /** GET notifications for current user (paginated) */
  app.get("/api/notifications", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const unreadOnly = req.query.unreadOnly === "true";

      const conditions = [eq(notifications.recipientUserId, user.id)];
      if (unreadOnly) conditions.push(eq(notifications.isRead, false));

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ notifications: rows });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  /** POST mark single notification as read */
  app.post("/api/notifications/mark-read", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { notificationId } = req.body;
      if (!notificationId) return res.status(400).json({ error: "notificationId required" });

      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to mark as read" });
    }
  });

  /** POST mark all notifications as read */
  app.post("/api/notifications/mark-all-read", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.recipientUserId, user.id), eq(notifications.isRead, false)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to mark all as read" });
    }
  });

  /** POST confirm a notification that requires confirmation */
  app.post("/api/notifications/:id/confirm", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      await db.update(notifications)
        .set({ confirmedByUserId: user.id, confirmedAt: new Date(), isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, user.id)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to confirm notification" });
    }
  });
}
