import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { raidItems, insertRaidItemSchema } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser, type AuthenticatedUser } from "./auth-context";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { parseIntParam } from "./lib/req-params";

export function registerRaidRoutes(app: Express): void {
  app.use("/api/raid", jwtAuth);

  app.get("/api/raid/project/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const conditions: ReturnType<typeof eq>[] = [eq(raidItems.projectId, projectId), isNull(raidItems.deletedAt) as any];

      const typeFilter = req.query.type as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const priorityFilter = req.query.priority as string | undefined;
      if (typeFilter) {
        conditions.push(eq(raidItems.type, typeFilter as typeof raidItems.type.enumValues[number]));
      }
      if (statusFilter) {
        conditions.push(eq(raidItems.status, statusFilter as typeof raidItems.status.enumValues[number]));
      }
      if (priorityFilter) {
        conditions.push(eq(raidItems.priority, priorityFilter as typeof raidItems.priority.enumValues[number]));
      }

      const items = await db.select().from(raidItems)
        .where(and(...conditions))
        .orderBy(desc(raidItems.createdAt));

      res.json(items);
    } catch (err: unknown) {
      console.error("[RAID] GET project items error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/raid/cross-project", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawResult = await db.execute(sql.raw(`
        SELECT r.type, r.status, r.priority, p.project_name, p.id as project_id, COUNT(*)::int as count
        FROM raid_items r
        JOIN project_info p ON r.project_id = p.id
        GROUP BY r.type, r.status, r.priority, p.project_name, p.id
        ORDER BY r.type, p.project_name
      `));
      const rows = Array.isArray(rawResult) ? rawResult : ((rawResult as Record<string, unknown>).rows as Record<string, unknown>[]) || [];

      const rollup: Record<string, { total: number; byStatus: Record<string, number>; byPriority: Record<string, number>; projects: Record<string, number> }> = {};

      for (const row of rows) {
        const t = row.type as string;
        if (!rollup[t]) {
          rollup[t] = { total: 0, byStatus: {}, byPriority: {}, projects: {} };
        }
        const count = row.count as number;
        rollup[t].total += count;
        rollup[t].byStatus[row.status as string] = (rollup[t].byStatus[row.status as string] || 0) + count;
        rollup[t].byPriority[row.priority as string] = (rollup[t].byPriority[row.priority as string] || 0) + count;
        rollup[t].projects[row.project_name as string] = (rollup[t].projects[row.project_name as string] || 0) + count;
      }

      res.json(rollup);
    } catch (err: unknown) {
      console.error("[RAID] GET cross-project error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/raid/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [item] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!item) return res.status(404).json({ error: "RAID item not found" });

      res.json(item);
    } catch (err: unknown) {
      console.error("[RAID] GET item error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/raid", requireAuth, requirePermission('projects', 'edit'), async (req: Request, res: Response) => {
    try {
      const parsed = insertRaidItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      }

      const user = getEffectiveUser(req);
      const userId = user?.id;
      const values = { ...parsed.data, createdByUserId: userId };

      const [created] = await db.insert(raidItems).values(values).returning();

      logAuditFromReq(req, {
        entityType: "raid_item",
        entityId: String(created.id),
        action: "raid.created",
        changesJson: { type: created.type, title: created.title, projectId: created.projectId },
      });

      const actor = actorFromReq(req);
      await createProjectEvent({
        projectId: created.projectId,
        eventType: "raid.created",
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        sourceEntityType: "raid_items",
        sourceEntityId: String(created.id),
        summary: `RAID ${created.type} created: ${created.title}`,
        details: { type: created.type, status: created.status, priority: created.priority },
        idempotencyKey: `raid-created:${created.id}`,
      });
      res.status(201).json(created);
    } catch (err: unknown) {
      console.error("[RAID] POST create error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/raid/:id", requireAuth, requirePermission('projects', 'edit'), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [existing] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!existing) return res.status(404).json({ error: "RAID item not found" });

      const allowedFields = ["type", "title", "description", "ownerUserId", "status", "priority", "dueDate", "mitigationResponse", "linkedTaskId", "projectId"];
      const updates: Record<string, unknown> = {};
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

      if (updates.status && updates.status !== existing.status) {
        const actor = actorFromReq(req);
        await createProjectEvent({
          projectId: existing.projectId,
          eventType: "raid.status_changed",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "raid_items",
          sourceEntityId: String(id),
          summary: `RAID status changed: ${existing.status} → ${updates.status}`,
          details: { fromStatus: existing.status, toStatus: updates.status, type: existing.type, title: existing.title },
          idempotencyKey: `raid-status:${id}:${existing.status}:${updates.status}`,
        });
      }
      res.json(updated);
    } catch (err: unknown) {
      console.error("[RAID] PATCH update error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/raid/:id", requireAuth, requirePermission('projects', 'edit'), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [existing] = await db.select().from(raidItems).where(eq(raidItems.id, id));
      if (!existing) return res.status(404).json({ error: "RAID item not found" });

      const hardDelete = req.query.hard === "true";

      if (hardDelete) {
        const [deleted] = await db.update(raidItems).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(raidItems.id, id)).returning();
        logAuditFromReq(req, {
          entityType: "raid_item",
          entityId: String(id),
          action: "raid.hard_deleted",
          changesJson: { title: existing.title, type: existing.type, projectId: existing.projectId },
        });
        res.json({ success: true, action: "hard_deleted", record: deleted });
        return;
      } else {
        await db.update(raidItems).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(raidItems.id, id));
      }

      logAuditFromReq(req, {
        entityType: "raid_item",
        entityId: String(id),
        action: "raid.soft_deleted",
        changesJson: { title: existing.title, type: existing.type, projectId: existing.projectId },
      });

      res.json({ success: true, action: "soft_deleted" });
    } catch (err: unknown) {
      console.error("[RAID] DELETE error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
