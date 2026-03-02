import type { Express, Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import { z } from "zod";
import { db } from "./db";
import { eq, and, or, desc, asc, sql, inArray, isNull } from "drizzle-orm";
import {
  mytoolTasks, operationalTasks, trItems, deliverables,
  projectEngApprovals, projectEngStages, engStageTemplates,
  qcItemInstance, qcChecklist, qcTemplateItem,
  projectInfo, users, normalizedPlanTasks, engineeringTasks,
} from "@shared/schema";
import {
  tagToProject,
  untagFromProject,
  getProjectLinkedItems,
  getUserMsObjects,
  convertToTask,
} from "./project-linking-service";
import { syncAllForUser, syncUserCalendar, syncUserEmail, syncUserTeams, getSyncStatus } from "./ms-sync-service";
import { getAllUsers, resolveNameToUserId, buildUserMap, type ResolvedUser } from "./user-resolver";

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

async function requireUnifiedWorkFlag(_req: Request, res: Response, next: NextFunction) {
  try {
    const { getFeatureFlag } = await import("./lib/feature-flags");
    const enabled = await getFeatureFlag("unified_work_v1");
    if (!enabled) {
      return res.status(404).json({ error: "Unified Work feature is not enabled" });
    }
    next();
  } catch {
    next();
  }
}

export function registerMsSyncRoutes(app: Express) {
  app.post("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, requireUnifiedWorkFlag, async (req: Request, res: Response) => {
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

  app.delete("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, requireUnifiedWorkFlag, async (req: Request, res: Response) => {
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

  app.get("/api/ms-objects/mine", jwtAuth, requireAuth, requireUnifiedWorkFlag, async (req: Request, res: Response) => {
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

  app.post("/api/ms-objects/:id/convert-to-task", jwtAuth, requireAuth, requireUnifiedWorkFlag, async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const { projectId } = req.body || {};
      const result = await convertToTask(msObjectId, userId, projectId ? parseInt(String(projectId)) : undefined);
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

  app.get("/api/users/assignable", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const allUsers = await getAllUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/tasks/reassign", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const { taskId, taskSource, userId: assignUserId } = req.body;
      if (!taskId || !taskSource) return res.status(400).json({ error: "taskId and taskSource required" });

      const currentUser = (req as any).user;
      const currentUserId = currentUser?.id;
      const currentRole = currentUser?.role || "";
      const ADMIN_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "ENGINEERING_MANAGER"];
      const isPrivileged = ADMIN_ROLES.includes(currentRole);

      const userMap = await buildUserMap();
      const targetUser = assignUserId ? userMap.get(assignUserId) : null;

      const resolveIdsFromNames = (names: string[]): number[] => {
        const ids: number[] = [];
        for (const name of names) {
          const matched = [...userMap.values()].find(
            u => u.name.toLowerCase() === name.toLowerCase()
              || u.username.toLowerCase() === name.toLowerCase()
              || u.name.split(" ")[0].toLowerCase() === name.toLowerCase()
          );
          if (matched) ids.push(matched.id);
        }
        return ids;
      };

      switch (taskSource) {
        case "personal": {
          const [task] = await db.select().from(mytoolTasks).where(eq(mytoolTasks.id, taskId));
          if (!task) return res.status(404).json({ error: "Task not found" });
          if (!isPrivileged && task.ownerUserId !== currentUserId) {
            return res.status(403).json({ error: "You can only reassign your own personal tasks" });
          }
          if (assignUserId) {
            await db.execute(sql`UPDATE mytool_tasks SET owner_user_id = ${assignUserId} WHERE id = ${taskId}`);
          }
          break;
        }
        case "operational": {
          const [task] = await db.select().from(operationalTasks).where(eq(operationalTasks.id, taskId));
          if (!task) return res.status(404).json({ error: "Task not found" });
          if (!isPrivileged && task.ownerUserId !== currentUserId && !(task.assigneeUserIds || []).includes(currentUserId)) {
            return res.status(403).json({ error: "You don't have permission to reassign this task" });
          }
          if (assignUserId && targetUser) {
            const currentAssignees = task.assignees || [];
            const currentIds = (task.assigneeUserIds && task.assigneeUserIds.length > 0) ? task.assigneeUserIds : resolveIdsFromNames(currentAssignees);
            if (!currentIds.includes(assignUserId)) {
              const newAssignees = [...currentAssignees, targetUser.name];
              const newIds = [...currentIds, assignUserId];
              await db.execute(sql`UPDATE operational_tasks SET assignees = ${newAssignees}, assignee_user_ids = ${newIds} WHERE id = ${taskId}`);
            }
          } else {
            await db.execute(sql`UPDATE operational_tasks SET assignees = '{}', assignee_user_ids = '{}' WHERE id = ${taskId}`);
          }
          break;
        }
        case "plan": {
          if (!isPrivileged) {
            return res.status(403).json({ error: "Only managers can reassign plan tasks" });
          }
          await db.execute(sql`UPDATE normalized_plan_tasks SET assignee_user_id = ${assignUserId || null} WHERE id = ${taskId}`);
          if (targetUser) {
            await db.execute(sql`UPDATE normalized_plan_tasks SET owner = ${targetUser.name} WHERE id = ${taskId}`);
          }
          break;
        }
        case "engineering_task": {
          if (!isPrivileged) {
            return res.status(403).json({ error: "Only managers can reassign engineering tasks" });
          }
          await db.execute(sql`UPDATE engineering_tasks SET assignee_user_id = ${assignUserId || null}, assignee_name = ${targetUser?.name || null} WHERE id = ${taskId}`);
          break;
        }
        case "quality_task": {
          if (!isPrivileged) {
            return res.status(403).json({ error: "Only managers can reassign quality tasks" });
          }
          await db.execute(sql`UPDATE qc_item_instance SET assignee_user_id = ${assignUserId || null} WHERE id = ${taskId}`);
          break;
        }
        case "tr_register": {
          if (!isPrivileged) {
            return res.status(403).json({ error: "Only managers can reassign TR register items" });
          }
          if (assignUserId && targetUser) {
            const [item] = await db.select().from(trItems).where(eq(trItems.id, taskId));
            if (!item) return res.status(404).json({ error: "TR item not found" });
            const currentOwners = item.owners || [];
            const currentIds = (item.ownerUserIds && item.ownerUserIds.length > 0) ? item.ownerUserIds : resolveIdsFromNames(currentOwners);
            if (!currentIds.includes(assignUserId)) {
              const newOwners = [...currentOwners, targetUser.name];
              const newIds = [...currentIds, assignUserId];
              await db.execute(sql`UPDATE tr_items SET owners = ${newOwners}, owner_user_ids = ${newIds} WHERE id = ${taskId}`);
            }
          } else {
            await db.execute(sql`UPDATE tr_items SET owners = '{}', owner_user_ids = '{}' WHERE id = ${taskId}`);
          }
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown task source: ${taskSource}` });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Reassign] Error:", err);
      res.status(500).json({ error: err.message });
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

      const username = currentUser?.username || "";
      const userMap = await buildUserMap();

      const [personalTasks, opTasks, trRegisterItems, approvalData, deliverableItems, planTasks, engTasks, qualityTasks] = await Promise.all([
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

        db.execute(sql`
          SELECT * FROM normalized_plan_tasks
          WHERE assignee_user_id = ${userId}
             OR lower(owner) = lower(${username})
             OR lower(owner) = lower(${userName})
        `).then((r: any) => Array.isArray(r) ? r : (r.rows || [])),

        db.select().from(engineeringTasks).where(
          and(
            eq(engineeringTasks.assigneeUserId, userId),
            isNull(engineeringTasks.softDeletedAt)
          )
        ),

        db.execute(sql`
          SELECT qi.*, qc.project_name, qc.project_id, qti.item_name
          FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN qc_template_item qti ON qi.template_item_id = qti.id
          WHERE qi.assignee_user_id = ${userId}
            AND qi.is_applicable = true
        `).then((r: any) => Array.isArray(r) ? r : (r.rows || [])),
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

      const resolveUserIds = (ids: number[] | null): ResolvedUser[] => {
        if (!ids || ids.length === 0) return [];
        return ids.map(id => userMap.get(id)).filter(Boolean) as ResolvedUser[];
      };

      const resolveUserId = (id: number | null | undefined): ResolvedUser | null => {
        if (!id) return null;
        return userMap.get(id) || null;
      };

      res.json({
        personal: personalTasks.map(t => ({
          ...t,
          resolvedOwner: resolveUserId(t.ownerUserId),
        })),
        operational: opTasks.map(t => ({
          ...t,
          subtaskCount: subtaskCounts[t.id] || 0,
          resolvedAssignees: resolveUserIds(t.assigneeUserIds),
          resolvedOwner: resolveUserId(t.ownerUserId),
        })),
        trRegister: trRegisterItems.map(t => ({
          ...t,
          resolvedOwners: resolveUserIds(t.ownerUserIds),
        })),
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
        planTasks: (planTasks as any[]).map((t: any) => ({
          id: t.id,
          title: t.task_name,
          status: t.status || "active",
          projectName: t.project_name,
          owner: t.owner,
          phase: t.phase,
          startDate: t.start_date,
          endDate: t.end_date,
          pctComplete: t.pct_complete,
          assigneeUserId: t.assignee_user_id,
          resolvedAssignee: resolveUserId(t.assignee_user_id),
          _source: "plan",
        })),
        engineeringTasks: engTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          projectName: t.projectName,
          lifecyclePhase: t.lifecyclePhaseTag,
          assigneeUserId: t.assigneeUserId,
          assigneeName: t.assigneeName,
          resolvedAssignee: resolveUserId(t.assigneeUserId),
          _source: "engineering_task",
        })),
        qualityTasks: (qualityTasks as any[]).map((t: any) => ({
          id: t.id,
          title: t.item_name,
          status: t.qm_status || "not_started",
          projectName: t.project_name,
          startDate: t.start_date,
          endDate: t.end_date,
          assigneeUserId: t.assignee_user_id,
          resolvedAssignee: resolveUserId(t.assignee_user_id),
          _source: "quality_task",
        })),
        userMap: Object.fromEntries(userMap),
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
