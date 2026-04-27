import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, sql, inArray, isNull, or } from "drizzle-orm";
import { workItemDependencies, workItems, insertWorkItemDependencySchema } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth } from "./auth-context";
import { parseIntParam } from "./lib/req-params";

async function detectCircular(predecessorId: number, successorId: number): Promise<boolean> {
  const allDeps = await db.select({
    predecessorId: workItemDependencies.predecessorId,
    successorId: workItemDependencies.successorId,
  }).from(workItemDependencies);

  const adj = new Map<number, number[]>();
  for (const dep of allDeps) {
    if (!adj.has(dep.predecessorId)) adj.set(dep.predecessorId, []);
    adj.get(dep.predecessorId)!.push(dep.successorId);
  }

  const visited = new Set<number>();
  const stack = [successorId];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === predecessorId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    const neighbors = adj.get(node);
    if (neighbors) {
      for (const n of neighbors) stack.push(n);
    }
  }
  return false;
}

export function registerDependencyRoutes(app: Express): void {
  app.use("/api/dependencies", jwtAuth);

  app.get("/api/work-items", jwtAuth, requireAuth, requirePermission("work_items", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "projectId query param required" });

      const items = await db.select({ id: workItems.id, title: workItems.title })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), sql`${workItems.deletedAt} IS NULL`));

      res.json(items);
    } catch (err: unknown) {
      console.error("[WorkItems] GET error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Task-level dependency fetch: returns all dependencies where the given
  // task is either the predecessor or the successor. Used by the
  // DependenciesTab in the engineering task detail drawer.
  app.get("/api/dependencies/task/:taskId", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = parseIntParam(req.params.taskId);
      if (isNaN(taskId)) return res.status(400).json({ error: "Invalid task ID" });

      const deps = await db.select({
        id: workItemDependencies.id,
        predecessorId: workItemDependencies.predecessorId,
        successorId: workItemDependencies.successorId,
        depType: workItemDependencies.depType,
        lagDays: workItemDependencies.lagDays,
      })
        .from(workItemDependencies)
        .where(
          and(
            or(
              eq(workItemDependencies.predecessorId, taskId),
              eq(workItemDependencies.successorId, taskId),
            ),
            isNull(workItemDependencies.deletedAt),
          )
        );

      // Collect all linked task IDs to fetch titles in a single query
      const linkedIds = new Set<number>();
      for (const d of deps) {
        linkedIds.add(d.predecessorId);
        linkedIds.add(d.successorId);
      }
      linkedIds.delete(taskId);

      const titleMap = new Map<number, { title: string; status: string }>();
      if (linkedIds.size > 0) {
        const rows = await db.select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
        })
          .from(workItems)
          .where(inArray(workItems.id, [...linkedIds]));
        for (const r of rows) {
          titleMap.set(r.id, { title: r.title, status: r.status || "not_started" });
        }
      }

      const result = deps.map((d: any) => {
        const isBlocking = d.predecessorId === taskId;
        const linkedTaskId = isBlocking ? d.successorId : d.predecessorId;
        const linked = titleMap.get(linkedTaskId);
        return {
          id: d.id,
          type: isBlocking ? "blocks" : "blocked_by",
          depType: d.depType,
          lagDays: d.lagDays,
          linkedTaskId,
          linkedTaskTitle: linked?.title ?? `Task #${linkedTaskId}`,
          linkedTaskStatus: linked?.status ?? "not_started",
        };
      });

      res.json({ dependencies: result });
    } catch (err: unknown) {
      console.error("[Dependencies] GET task deps error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/dependencies/project/:projectId", requireAuth, requirePermission("projects", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const projectTasks = await db.select({ id: workItems.id })
        .from(workItems)
        .where(eq(workItems.projectId, projectId));

      if (projectTasks.length === 0) {
        return res.json({ dependencies: [] });
      }

      const taskIds = projectTasks.map((t: { id: number }) => t.id);

      const predecessorTask = db.select({
        id: workItems.id,
        title: workItems.title,
      }).from(workItems).as("predecessor");

      const successorTask = db.select({
        id: workItems.id,
        title: workItems.title,
      }).from(workItems).as("successor");

      const deps = await db.select({
        id: workItemDependencies.id,
        predecessorId: workItemDependencies.predecessorId,
        successorId: workItemDependencies.successorId,
        depType: workItemDependencies.depType,
        lagDays: workItemDependencies.lagDays,
        predecessorTitle: predecessorTask.title,
        successorTitle: successorTask.title,
      })
        .from(workItemDependencies)
        .innerJoin(predecessorTask, eq(workItemDependencies.predecessorId, predecessorTask.id))
        .innerJoin(successorTask, eq(workItemDependencies.successorId, successorTask.id))
        .where(and(inArray(workItemDependencies.predecessorId, taskIds), isNull(workItemDependencies.deletedAt)));

      res.json({ dependencies: deps });
    } catch (err: unknown) {
      console.error("[Dependencies] GET error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/dependencies/project-name/:projectName", requireAuth, requirePermission("projects", "view"), async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const projectTasks = await db.select({ id: workItems.id })
        .from(workItems)
        .where(and(
          sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`,
          sql`${workItems.deletedAt} IS NULL`
        ));

      if (projectTasks.length === 0) {
        return res.json({ dependencies: [] });
      }

      const taskIds = projectTasks.map((t: { id: number }) => t.id);

      const deps = await db.select({
        id: workItemDependencies.id,
        predecessorId: workItemDependencies.predecessorId,
        successorId: workItemDependencies.successorId,
        depType: workItemDependencies.depType,
        lagDays: workItemDependencies.lagDays,
      })
        .from(workItemDependencies)
        .where(
          and(
            or(
              inArray(workItemDependencies.predecessorId, taskIds),
              inArray(workItemDependencies.successorId, taskIds),
            ),
            isNull(workItemDependencies.deletedAt),
          )
        );

      res.json({ dependencies: deps });
    } catch (err: unknown) {
      console.error("[Dependencies] GET by project name error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/dependencies", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const parsed = insertWorkItemDependencySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      }

      const { predecessorId, successorId, depType, lagDays } = parsed.data as any;

      if (predecessorId === successorId) {
        return res.status(400).json({ error: "A task cannot depend on itself" });
      }

      const [predecessor] = await db.select({ id: workItems.id, projectId: workItems.projectId, title: workItems.title })
        .from(workItems).where(eq(workItems.id, predecessorId));
      const [successor] = await db.select({ id: workItems.id, projectId: workItems.projectId, title: workItems.title })
        .from(workItems).where(eq(workItems.id, successorId));

      if (!predecessor || !successor) {
        return res.status(404).json({ error: "One or both tasks not found" });
      }

      if (predecessor.projectId !== successor.projectId) {
        return res.status(400).json({ error: "Tasks must belong to the same project" });
      }

      const isCircular = await detectCircular(predecessorId, successorId);
      if (isCircular) {
        return res.status(400).json({ error: "Circular dependency detected" });
      }

      const [created] = await db.insert(workItemDependencies).values({
        predecessorId,
        successorId,
        depType: depType || "FS",
        lagDays: lagDays ?? 0,
      }).returning();

      logAuditFromReq(req, {
        entityType: "work_item_dependency",
        entityId: String(created.id),
        action: "dependency.created",
        projectName: undefined,
        changesJson: { predecessorId, successorId, depType: depType || "FS", lagDays: lagDays ?? 0 },
      });

      res.status(201).json(created);
    } catch (err: unknown) {
      console.error("[Dependencies] POST error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/dependencies/:id", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const depId = parseIntParam(req.params.id);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });

      const [existing] = await db.select().from(workItemDependencies).where(eq(workItemDependencies.id, depId));
      if (!existing) return res.status(404).json({ error: "Dependency not found" });

      const updates: Partial<{ depType: "FS" | "SS" | "FF" | "SF"; lagDays: number }> = {};
      if (req.body.depType !== undefined) {
        if (!["FS", "SS", "FF", "SF"].includes(req.body.depType)) {
          return res.status(400).json({ error: "Invalid depType. Must be FS, SS, FF, or SF" });
        }
        updates.depType = req.body.depType;
      }
      if (req.body.lagDays !== undefined) {
        updates.lagDays = parseInt(req.body.lagDays);
        if (isNaN(updates.lagDays)) return res.status(400).json({ error: "lagDays must be a number" });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const [updated] = await db.update(workItemDependencies)
        .set(updates)
        .where(eq(workItemDependencies.id, depId))
        .returning();

      logAuditFromReq(req, {
        entityType: "work_item_dependency",
        entityId: String(depId),
        action: "dependency.updated",
        changesJson: { before: { depType: existing.depType, lagDays: existing.lagDays }, after: updates },
      });

      res.json(updated);
    } catch (err: unknown) {
      console.error("[Dependencies] PATCH error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/dependencies/:id", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const depId = parseIntParam(req.params.id);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });

      const [existing] = await db.select().from(workItemDependencies).where(eq(workItemDependencies.id, depId));
      if (!existing) return res.status(404).json({ error: "Dependency not found" });

      await db.update(workItemDependencies).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(workItemDependencies.id, depId)).returning();

      logAuditFromReq(req, {
        entityType: "work_item_dependency",
        entityId: String(depId),
        action: "dependency.deleted",
        changesJson: { predecessorId: existing.predecessorId, successorId: existing.successorId, depType: existing.depType },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("[Dependencies] DELETE error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
