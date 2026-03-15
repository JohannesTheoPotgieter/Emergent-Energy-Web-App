import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { raidItems, insertRaidItemSchema, projectInfo, users } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { verifyToken } from "./jwt";

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

export function registerRaidRoutes(app: Express) {
  app.use("/api/raid", jwtAuth);

  app.get("/api/raid/project/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const conditions: any[] = [eq(raidItems.projectId, projectId)];

      const typeFilter = req.query.type as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const priorityFilter = req.query.priority as string | undefined;
      if (typeFilter) {
        conditions.push(eq(raidItems.type, typeFilter as any));
      }
      if (statusFilter) {
        conditions.push(eq(raidItems.status, statusFilter as any));
      }
      if (priorityFilter) {
        conditions.push(eq(raidItems.priority, priorityFilter as any));
      }

      const items = await db.select().from(raidItems)
        .where(and(...conditions))
        .orderBy(desc(raidItems.createdAt));

      res.json(items);
    } catch (err: any) {
      console.error("[RAID] GET project items error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/raid/cross-project", requireAuth, async (req: Request, res: Response) => {
    try {
      const rows: any[] = await db.execute(sql.raw(`
        SELECT r.type, r.status, r.priority, p.project_name, p.id as project_id, COUNT(*)::int as count
        FROM raid_items r
        JOIN project_info p ON r.project_id = p.id
        GROUP BY r.type, r.status, r.priority, p.project_name, p.id
        ORDER BY r.type, p.project_name
      `)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const rollup: Record<string, { total: number; byStatus: Record<string, number>; byPriority: Record<string, number>; projects: Record<string, number> }> = {};

      for (const row of rows) {
        const t = row.type;
        if (!rollup[t]) {
          rollup[t] = { total: 0, byStatus: {}, byPriority: {}, projects: {} };
        }
        rollup[t].total += row.count;
        rollup[t].byStatus[row.status] = (rollup[t].byStatus[row.status] || 0) + row.count;
        rollup[t].byPriority[row.priority] = (rollup[t].byPriority[row.priority] || 0) + row.count;
        rollup[t].projects[row.project_name] = (rollup[t].projects[row.project_name] || 0) + row.count;
      }

      res.json(rollup);
    } catch (err: any) {
      console.error("[RAID] GET cross-project error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/raid/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [item] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!item) return res.status(404).json({ error: "RAID item not found" });

      res.json(item);
    } catch (err: any) {
      console.error("[RAID] GET item error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/raid", requireAuth, requirePermission('projects', 'edit'), async (req: Request, res: Response) => {
    try {
      const parsed = insertRaidItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      }

      const userId = (req as any).user?.id;
      const values = { ...parsed.data, createdByUserId: userId };

      const [created] = await db.insert(raidItems).values(values).returning();

      logAuditFromReq(req, {
        entityType: "raid_item",
        entityId: String(created.id),
        action: "raid.created",
        changesJson: { type: created.type, title: created.title, projectId: created.projectId },
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error("[RAID] POST create error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/raid/:id", requireAuth, requirePermission('projects', 'edit'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [existing] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!existing) return res.status(404).json({ error: "RAID item not found" });

      const allowedFields = ["type", "title", "description", "ownerUserId", "status", "priority", "dueDate", "mitigationResponse", "linkedTaskId", "projectId"];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updates.updatedAt = new Date();

      if (updates.status === "closed" || updates.status === "resolved") {
        updates.closedAt = new Date();
      }

      const [updated] = await db.update(raidItems).set(updates).where(eq(raidItems.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "raid_item",
        entityId: String(id),
        action: "raid.updated",
        changesJson: { before: existing, after: updated },
      });

      res.json(updated);
    } catch (err: any) {
      console.error("[RAID] PATCH update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/raid/:id", requireAuth, requirePermission('projects', 'delete'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [existing] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!existing) return res.status(404).json({ error: "RAID item not found" });

      const hardDelete = req.query.hard === "true";

      if (hardDelete) {
        await db.delete(raidItems).where(eq(raidItems.id, id));
      } else {
        await db.update(raidItems).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(raidItems.id, id));
      }

      logAuditFromReq(req, {
        entityType: "raid_item",
        entityId: String(id),
        action: hardDelete ? "raid.hard_deleted" : "raid.soft_deleted",
        changesJson: { title: existing.title, type: existing.type, projectId: existing.projectId },
      });

      res.json({ success: true, action: hardDelete ? "hard_deleted" : "soft_deleted" });
    } catch (err: any) {
      console.error("[RAID] DELETE error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

