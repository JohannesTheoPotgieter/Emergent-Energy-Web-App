// @ts-nocheck
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { workItemDependencies, workItems, projectInfo, insertWorkItemDependencySchema } from "@shared/schema";
import { verifyToken } from "./jwt";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";

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
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

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

export function registerDependencyRoutes(app: Express) {
  app.use("/api/dependencies", jwtAuth);

  app.get("/api/work-items", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "projectId query param required" });

      const items = await db.select({ id: workItems.id, title: workItems.title })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), sql`${workItems.deletedAt} IS NULL`));

      res.json(items);
    } catch (err: any) {
      console.error("[WorkItems] GET error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/dependencies/project/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string);
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
        .where(inArray(workItemDependencies.predecessorId, taskIds));

      res.json({ dependencies: deps });
    } catch (err: any) {
      console.error("[Dependencies] GET error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/dependencies/project-name/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
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
          sql`(${workItemDependencies.predecessorId} = ANY(${taskIds}) OR ${workItemDependencies.successorId} = ANY(${taskIds}))`
        );

      res.json({ dependencies: deps });
    } catch (err: any) {
      console.error("[Dependencies] GET by project name error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/dependencies", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const parsed = insertWorkItemDependencySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      }

      const { predecessorId, successorId, depType, lagDays } = parsed.data;

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
    } catch (err: any) {
      console.error("[Dependencies] POST error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/dependencies/:id", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const depId = parseInt(req.params.id as string);
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
    } catch (err: any) {
      console.error("[Dependencies] PATCH error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/dependencies/:id", requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const depId = parseInt(req.params.id as string);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });

      const [existing] = await db.select().from(workItemDependencies).where(eq(workItemDependencies.id, depId));
      if (!existing) return res.status(404).json({ error: "Dependency not found" });

      await db.delete(workItemDependencies).where(eq(workItemDependencies.id, depId));

      logAuditFromReq(req, {
        entityType: "work_item_dependency",
        entityId: String(depId),
        action: "dependency.deleted",
        changesJson: { predecessorId: existing.predecessorId, successorId: existing.successorId, depType: existing.depType },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[Dependencies] DELETE error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
