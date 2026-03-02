import type { Express, Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import { z } from "zod";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import {
  mytoolTasks, operationalTasks, trItems, deliverables,
  projectEngApprovals, projectEngStages, engStageTemplates,
  qcItemInstance, qcChecklist, qcTemplateItem,
  projectInfo, users,
} from "@shared/schema";
import {
  tagToProject,
  untagFromProject,
  getProjectLinkedItems,
  getUserMsObjects,
  convertToTask,
} from "./project-linking-service";
import { syncAllForUser, syncUserCalendar, syncUserEmail, syncUserTeams, getSyncStatus } from "./ms-sync-service";

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

const tagSchema = z.object({
  projectId: z.number(),
  note: z.string().optional(),
});

export function registerMsSyncRoutes(app: Express) {
  app.post("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const parsed = tagSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const result = await tagToProject(msObjectId, parsed.data.projectId, userId, parsed.data.note);
      res.json(result);
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      await untagFromProject(msObjectId, userId);
      res.json({ success: true });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get("/api/ms-objects/mine", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : undefined;
      const actionRequired = String(req.query.action_required) === "true";

      let items = await getUserMsObjects(userId, type, limit);

      if (actionRequired) {
        items = items.filter((item: any) => item.actionRequired === true);
      }

      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-objects/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const items = await getProjectLinkedItems(projectId, userId);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-objects/:id/convert-to-task", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const result = await convertToTask(msObjectId, userId);
      res.json(result);
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : err.message?.includes("only") ? 403 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get("/api/ms-sync/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });
      const status = await getSyncStatus(userId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  app.post("/api/ms-sync/trigger", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const { type } = req.body;
      let results;
      if (type === "calendar") {
        results = [await syncUserCalendar(userId)];
      } else if (type === "email") {
        results = [await syncUserEmail(userId)];
      } else if (type === "teams") {
        results = [await syncUserTeams(userId)];
      } else {
        results = await syncAllForUser(userId);
      }
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ error: "Sync failed: " + err.message });
    }
  });

  app.get("/api/my-work/all-tasks", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).user;
      const userId = currentUser?.id;
      const userName = currentUser?.name || "";
      const userRole = currentUser?.role || "";
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const ADMIN_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN"];
      const isAdmin = ADMIN_ROLES.includes(userRole);

      const [personalTasks, opTasks, trRegisterItems, approvalData, deliverableItems] = await Promise.all([
        db.select().from(mytoolTasks).where(eq(mytoolTasks.ownerUserId, userId)).orderBy(desc(mytoolTasks.createdAt)),

        db.select().from(operationalTasks).where(
          sql`(${operationalTasks.ownerUserId} = ${userId} OR ${userName} = ANY(${operationalTasks.assignees}))`
        ).orderBy(asc(operationalTasks.sortOrder)),

        db.select().from(trItems).where(sql`${userName} = ANY(${trItems.owners})`).orderBy(desc(trItems.createdAt)),

        (async () => {
          const engApprovals = await db.select({
            id: projectEngApprovals.id,
            status: projectEngApprovals.status,
            approverRole: projectEngApprovals.approverRole,
            createdAt: projectEngApprovals.createdAt,
            stageName: engStageTemplates.name,
            projectName: projectInfo.projectName,
            approverUserId: projectEngApprovals.approverUserId,
          })
            .from(projectEngApprovals)
            .innerJoin(projectEngStages, eq(projectEngApprovals.projectEngStageId, projectEngStages.id))
            .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
            .innerJoin(projectInfo, eq(projectEngStages.projectId, projectInfo.id))
            .where(eq(projectEngApprovals.status, "pending"));

          const APPROVAL_ROLE_TO_USER_ROLES: Record<string, string[]> = {
            QA_REVIEW: ["QUALITY_MANAGER"],
            TECHNICAL_SIGNOFF: ["ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
            "Engineering Manager": ["ENGINEERING_MANAGER"],
            "Quality Manager": ["QUALITY_MANAGER"],
            "COO": ["COO_ADMIN"],
          };
          let filtered = engApprovals;
          if (!isAdmin) {
            filtered = engApprovals.filter(a => {
              if (a.approverUserId && a.approverUserId === userId) return true;
              if (a.approverRole) {
                const allowedRoles = APPROVAL_ROLE_TO_USER_ROLES[a.approverRole];
                if (allowedRoles && allowedRoles.includes(userRole)) return true;
              }
              return false;
            });
          }

          const qcItems = await db.select({
            id: qcItemInstance.id,
            itemName: qcTemplateItem.itemName,
            projectName: qcChecklist.projectName,
            lastUpdatedAt: qcItemInstance.lastUpdatedAt,
          })
            .from(qcItemInstance)
            .innerJoin(qcChecklist, eq(qcItemInstance.checklistId, qcChecklist.id))
            .innerJoin(qcTemplateItem, eq(qcItemInstance.templateItemId, qcTemplateItem.id))
            .where(and(eq(qcItemInstance.qmStatus, "review"), eq(qcItemInstance.approved, false)));

          let filteredQc = (userRole === "QUALITY_MANAGER" || userRole === "quality_manager" || isAdmin) ? qcItems : [];

          return { engApprovals: filtered, qcItems: filteredQc };
        })(),

        db.select().from(deliverables).where(
          sql`(${deliverables.ownerUserId} = ${userId} OR ${deliverables.reviewerUserId} = ${userId})`
        ).orderBy(desc(deliverables.updatedAt)),
      ]);

      const subtaskParentIds = opTasks.filter(t => t.parentTaskId === null || t.parentTaskId === undefined).map(t => t.id);
      let subtaskCounts: Record<number, number> = {};
      if (subtaskParentIds.length > 0) {
        const counts = await db.select({
          parentTaskId: operationalTasks.parentTaskId,
          count: sql<number>`count(*)`,
        }).from(operationalTasks).where(inArray(operationalTasks.parentTaskId, subtaskParentIds)).groupBy(operationalTasks.parentTaskId);
        for (const c of counts) {
          if (c.parentTaskId) subtaskCounts[c.parentTaskId] = Number(c.count);
        }
      }

      res.json({
        personal: personalTasks,
        operational: opTasks.map(t => ({ ...t, subtaskCount: subtaskCounts[t.id] || 0 })),
        trRegister: trRegisterItems,
        approvals: {
          engineering: approvalData.engApprovals.map(a => ({
            id: a.id,
            title: `${a.stageName} — ${a.approverRole}`,
            projectName: a.projectName,
            status: a.status,
            createdAt: a.createdAt,
            type: "engineering" as const,
          })),
          quality: approvalData.qcItems.map(q => ({
            id: q.id,
            title: q.itemName,
            projectName: q.projectName,
            status: "review",
            createdAt: q.lastUpdatedAt,
            type: "quality" as const,
          })),
        },
        deliverables: deliverableItems,
      });
    } catch (err: any) {
      console.error("[MyWork AllTasks] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/webhooks/graph", async (req: Request, res: Response) => {
    if (req.query.validationToken) {
      return res.status(200).contentType("text/plain").send(req.query.validationToken as string);
    }
    try {
      const notifications = req.body?.value || [];
      for (const notification of notifications) {
        console.log("[Graph Webhook] Received:", notification.changeType, notification.resource);
      }
      res.status(202).json({ status: "accepted" });
    } catch (err: any) {
      console.error("[Graph Webhook] Error:", err);
      res.status(202).json({ status: "accepted" });
    }
  });
}
