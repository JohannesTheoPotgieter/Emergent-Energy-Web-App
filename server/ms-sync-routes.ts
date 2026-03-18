import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { eq, and, or, desc, asc, sql, inArray, isNull, ne } from "drizzle-orm";
import {
  mytoolTasks, operationalTasks, trItems, deliverables,
  projectEngApprovals, projectEngStages, engStageTemplates,
  qcItemInstance, qcChecklist, qcTemplateItem,
  projectInfo, users, normalizedPlanTasks, engineeringTasks, approvals,
  msAccounts, msObjects, communicationFollowUps, projectCommunicationTimelineEvents, workItemAssignments,
  workItems,
} from "@shared/schema";
import {
  tagToProject,
  untagFromProject,
  getProjectLinkedItems,
  getUserMsObjects,
  convertToTask,
  createFollowUpTaskFromCommunication,
  createProjectTimelineEvent,
} from "./project-linking-service";
import { syncAllForUser, syncUserCalendar, syncUserEmail, syncUserTeams, getSyncStatus } from "./ms-sync-service";
import { buildUserMap, mergeResolvedWithTextNames, type ResolvedUser } from "./user-resolver";
import { logAuditFromReq } from "./audit-logger";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import {
  listAssignableDirectory,
  listAssignableDirectoryForTaskSource,
  getAssignmentsForEntity,
  mapTaskSourceToEntityType,
  setEntityAssignment,
} from "./services/assignment-service";
import { buildMyWorkSourceLinks } from "./lib/my-work-source-links";
import {
  filterMicrosoftItemsForRequest,
  requireMicrosoftObjectSurfaceAccess,
  requireMicrosoftSurfaceFromRequest,
  requireMicrosoftSyncSurfaceAccess,
} from "./lib/microsoft-route-access";

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

import { normalizeStatus as canonicalNormalizeStatus } from "./lib/canonical-task-engine";

function normalizeTaskStatus(status: string | null | undefined): string {
  return canonicalNormalizeStatus(status);
}

export function registerMsSyncRoutes(app: Express) {
  const assignmentPayloadSchema = z
    .object({
      taskId: z.coerce.number().finite().int().positive(),
      taskSource: z.string().min(1),
      assigneeType: z.enum(["internal_user", "external_counterparty", "external_contact"]).nullable().optional(),
      assigneeId: z.coerce.number().finite().int().positive().nullable().optional(),
      userId: z.coerce.number().finite().int().positive().nullable().optional(), // legacy shape
    })
    .superRefine((data, ctx) => {
      const effectiveAssigneeType = data.assigneeType ?? (data.userId != null ? "internal_user" : null);
      const effectiveAssigneeId = data.assigneeId ?? data.userId ?? null;
      if (effectiveAssigneeType === null && effectiveAssigneeId !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "assigneeId requires assigneeType" });
      }
      if (effectiveAssigneeType !== null && effectiveAssigneeId === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "assigneeId is required when assigneeType is set" });
      }
    });

  app.post("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftObjectSurfaceAccess(), async (req: Request, res: Response) => {
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

  app.delete("/api/ms-objects/:id/tag-project", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftObjectSurfaceAccess(), async (req: Request, res: Response) => {
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

  app.get("/api/ms-objects/mine", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftSurfaceFromRequest(), async (req: Request, res: Response) => {
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

      const visibleItems = await filterMicrosoftItemsForRequest(req, items);
      res.json(visibleItems);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-objects/project/:projectId", jwtAuth, requireAuth, requirePermission("projects", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const items = await getProjectLinkedItems(projectId, userId);
      const visibleItems = await filterMicrosoftItemsForRequest(req, items);
      res.json(visibleItems);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-objects/:id/convert-to-task", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftObjectSurfaceAccess(), async (req: Request, res: Response) => {
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



  app.post("/api/ms-objects/:id/create-follow-up", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftObjectSurfaceAccess(), async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const result = await createFollowUpTaskFromCommunication({
        msObjectId,
        userId,
        title: req.body?.title,
        dueAt: req.body?.dueAt,
        notes: req.body?.notes,
      });

      res.json(result);
    } catch (err: any) {
      const msg = err.message || "Failed to create follow-up";
      const status = msg.includes("not found") ? 404 : msg.includes("only") ? 403 : msg.includes("already exists") ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.get("/api/ms-objects/follow-ups/overdue", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftSurfaceFromRequest(), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const now = new Date();
      const rows = await db
        .select({
          id: communicationFollowUps.id,
          msObjectId: communicationFollowUps.msObjectId,
          projectId: communicationFollowUps.projectId,
          dueAt: communicationFollowUps.dueAt,
          taskId: communicationFollowUps.taskId,
          taskType: communicationFollowUps.taskType,
          status: communicationFollowUps.status,
          reminderSentAt: communicationFollowUps.reminderSentAt,
          createdAt: communicationFollowUps.createdAt,
          subjectOrTitle: msObjects.subjectOrTitle,
          type: msObjects.type,
          webLink: msObjects.webLink,
        })
        .from(communicationFollowUps)
        .leftJoin(msObjects, eq(msObjects.id, communicationFollowUps.msObjectId))
        .where(and(
          eq(msObjects.userId, userId),
          eq(communicationFollowUps.status, "pending"),
          sql`${communicationFollowUps.dueAt} is not null and ${communicationFollowUps.dueAt} < ${now}`
        ))
        .orderBy(asc(communicationFollowUps.dueAt));

      const visibleRows = await filterMicrosoftItemsForRequest(req, rows);
      res.json(visibleRows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/projects/:projectId/communication-timeline", jwtAuth, requireAuth, requirePermission("projects", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const items = await db
        .select()
        .from(projectCommunicationTimelineEvents)
        .where(eq(projectCommunicationTimelineEvents.projectId, projectId))
        .orderBy(desc(projectCommunicationTimelineEvents.createdAt))
        .limit(100);

      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/ms-objects/:id/dismiss", jwtAuth, requireAuth, requireMicrosoftObjectSurfaceAccess(), async (req: Request, res: Response) => {
    try {
      const msObjectId = parseInt(String(req.params.id));
      if (isNaN(msObjectId)) return res.status(400).json({ error: "Invalid ms object id" });
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });
      await db.update(msObjects).set({ dismissed: true }).where(and(eq(msObjects.id, msObjectId), eq(msObjects.userId, userId)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-sync/status", jwtAuth, requireAuth, requireMicrosoftSyncSurfaceAccess(), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });
      const status = await getSyncStatus(userId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  app.post("/api/ms-sync/trigger", jwtAuth, requireAuth, requireMicrosoftSyncSurfaceAccess(), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const existingAccount = await db.select().from(msAccounts).where(eq(msAccounts.userId, userId)).limit(1);
      if (existingAccount.length === 0 || !existingAccount[0].ssoAccessToken) {
        return res.json({
          success: false,
          error: "ms_sso_required",
          message: "Please sign in with Microsoft to sync your calendar, email, and teams data.",
          results: [],
        });
      }

      if (existingAccount[0].status !== "active") {
        await db.update(msAccounts).set({ status: "active" }).where(eq(msAccounts.userId, userId));
      }

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
      console.error("[MS Sync] Trigger error:", err.message);
      res.status(500).json({ error: "Sync failed: " + err.message });
    }
  });

  app.get("/api/users/assignable", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const assignable = await listAssignableDirectory(search);
      const internal = assignable
        .filter((entry) => entry.assigneeType === "internal_user")
        .map((entry) => ({
          id: entry.assigneeId,
          name: entry.displayLabel,
          username: entry.displayLabel,
          role: entry.roleTags[0] || "",
          email: entry.secondaryLabel || undefined,
        }));
      res.json(internal);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/assignables", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const taskSource = typeof req.query.taskSource === "string" ? req.query.taskSource : undefined;
      const assignable = taskSource
        ? await listAssignableDirectoryForTaskSource(taskSource, search)
        : await listAssignableDirectory(search);
      res.json(assignable);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/tasks/reassign", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = assignmentPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        console.error("[Reassign] Zod validation failed:", parsed.error.issues, "body:", req.body);
        return res.status(400).json({ error: "Invalid assignment payload", details: parsed.error.issues });
      }

      const { taskId, taskSource } = parsed.data;
      if (!Number.isFinite(taskId) || taskId <= 0) {
        console.error("[Reassign] Invalid taskId after Zod parse:", taskId, "body:", req.body);
        return res.status(400).json({ error: `Invalid task ID: ${taskId}` });
      }
      const assigneeType = parsed.data.assigneeType ?? (parsed.data.userId != null ? "internal_user" : null);
      const rawAssigneeId = parsed.data.assigneeId ?? parsed.data.userId ?? null;
      const assigneeId = rawAssigneeId != null ? Number(rawAssigneeId) : null;
      if (assigneeId != null && (!Number.isFinite(assigneeId) || assigneeId <= 0)) {
        return res.status(400).json({ error: `Invalid assignee ID: ${rawAssigneeId}` });
      }
      const actorId = getEffectiveUser(req)?.id;
      if (!actorId || !Number.isFinite(actorId)) {
        return res.status(401).json({ error: "Valid user session required" });
      }
      console.log("[Reassign] Processing:", { taskId, taskSource, assigneeType, assigneeId, actorId, body: JSON.stringify(req.body) });

      if (taskSource === "plan_viewer" || taskSource === "remove_viewer") {
        const viewerUserId = assigneeType === "internal_user" ? assigneeId : parsed.data.userId ?? null;
        if (!viewerUserId) {
          if (taskSource === "plan_viewer") {
            await db.delete(workItemAssignments).where(and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.role, "VIEWER")));
            logAuditFromReq(req, {
              entityType: "work_item_assignment",
              entityId: String(taskId),
              action: "remove_all_viewers",
              changesJson: { workItemId: taskId, description: "All viewers removed from work item" },
            });
            return res.json({ success: true, assignment: null });
          }
          return res.status(400).json({ error: "userId required for viewer updates" });
        }

        if (taskSource === "remove_viewer") {
          await db.delete(workItemAssignments).where(and(
            eq(workItemAssignments.workItemId, taskId),
            eq(workItemAssignments.userId, viewerUserId),
            eq(workItemAssignments.role, "VIEWER"),
          ));
          logAuditFromReq(req, {
            entityType: "work_item_assignment",
            entityId: String(taskId),
            action: "remove_viewer",
            changesJson: { workItemId: taskId, viewerUserId },
          });
          return res.json({ success: true, assignment: null });
        }

        const existing = await db.select({ id: workItemAssignments.id })
          .from(workItemAssignments)
          .where(and(
            eq(workItemAssignments.workItemId, taskId),
            eq(workItemAssignments.userId, viewerUserId),
            eq(workItemAssignments.role, "VIEWER"),
          ))
          .limit(1);
        if (existing.length === 0) {
          await db.insert(workItemAssignments).values({
            workItemId: taskId,
            userId: viewerUserId,
            role: "VIEWER",
            allocationPct: null,
          });
        }
        logAuditFromReq(req, {
          entityType: "work_item_assignment",
          entityId: String(taskId),
          action: "add_viewer",
          changesJson: { workItemId: taskId, viewerUserId },
        });
        return res.json({ success: true, assignment: { assigneeType: "internal_user", assigneeId: viewerUserId } });
      }

      const entityType = mapTaskSourceToEntityType(taskSource);
      if (!entityType) {
        return res.status(400).json({ error: `Unknown task source: ${taskSource}` });
      }

      const mode = ["operational", "tr_register", "plan"].includes(taskSource) && assigneeType ? "append" : "replace";
      const assignmentRole = taskSource === "tr_register" ? "OWNER" : "ASSIGNEE";
      const assignments = await setEntityAssignment(req, {
        entityType,
        entityId: taskId,
        assignmentRole,
        assigneeType,
        assigneeId,
        mode: assigneeType ? mode : "clear",
      });
      console.log("[Reassign] Assignment saved to DB:", { entityType, taskId, assignmentRole, mode, resultCount: assignments.length });

      if (entityType === "work_item") {
        try {
          const internalAssigneeIds = assignments
            .filter((a) => a.active && a.assigneeType === "internal_user" && Number.isFinite(a.assigneeId))
            .map((a) => a.assigneeId);
          const internalNames = assignments
            .filter((a) => a.active && a.assigneeType === "internal_user")
            .map((a) => a.displayLabel)
            .filter(Boolean);
          const primaryOwner = internalAssigneeIds[0] || null;
          await db.update(workItems).set({
            ownerUserId: primaryOwner,
            assigneeUserIds: internalAssigneeIds.length > 0 ? internalAssigneeIds : null,
            assignees: internalNames.length > 0 ? internalNames : null,
            updatedAt: new Date(),
          }).where(eq(workItems.id, taskId));
          console.log("[Reassign] Synced back to work_items:", { taskId, primaryOwner, internalAssigneeIds, internalNames });
        } catch (syncErr: any) {
          console.error("[Reassign] Sync-back to work_items failed (non-fatal):", syncErr.message);
        }
      }

      const current = assignments.find((assignment) =>
        assigneeType != null &&
        assignment.assignmentRole === assignmentRole &&
        assignment.assigneeType === assigneeType &&
        assignment.assigneeId === assigneeId,
      ) || assignments[0] || null;

      res.json({
        success: true,
        assignment: current ? {
          assigneeType: current.assigneeType,
          assigneeId: current.assigneeId,
          displayName: current.displayLabel,
          email: current.secondaryLabel,
          avatar: null,
          source: current.assigneeType === "internal_user" ? "internal" : "external",
        } : null,
        assignments,
      });
    } catch (err: any) {
      console.error("[Reassign] Assignment update failed", err?.message, err?.stack?.split("\n").slice(0, 8).join("\n"));
      const status = err?.message?.toLowerCase().includes("permission") ? 403 : err?.message?.toLowerCase().includes("not found") ? 404 : err?.message?.toLowerCase().includes("required") ? 400 : 500;
      res.status(status).json({ error: err.message || "Assignment update failed", _debug: { body: req.body, stack: err?.stack?.split("\n").slice(0, 8) } });
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

      const userEmail = currentUser?.email || currentUser?.username || "";

      const [personalTasks, opTasks, trRegisterItems, approvalData, deliverableItems, planTasks, engTasks, qualityTasks, microsoftItems] = await Promise.all([
        db.select().from(mytoolTasks).where(eq(mytoolTasks.ownerUserId, userId)).orderBy(desc(mytoolTasks.createdAt)),

        db.select().from(operationalTasks).where(
          sql`(${operationalTasks.ownerUserId} = ${userId} OR ${userName} = ANY(${operationalTasks.assignees}) OR ${userId} = ANY(${operationalTasks.assigneeUserIds}))`
        ).orderBy(asc(operationalTasks.sortOrder)),

        db.select().from(trItems).where(
            sql`(${userName} = ANY(${trItems.owners}) OR ${userId} = ANY(${trItems.ownerUserIds}))`
          ).orderBy(desc(trItems.createdAt)),

        (async () => {
          const engApprovals = await db.select({
            id: projectEngApprovals.id,
            status: projectEngApprovals.status,
            approverRole: projectEngApprovals.approverRole,
            createdAt: projectEngApprovals.createdAt,
            stageName: engStageTemplates.name,
            projectName: projectInfo.projectName,
            projectId: projectInfo.id,
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
            projectId: qcChecklist.projectId,
            lastUpdatedAt: qcItemInstance.lastUpdatedAt,
          })
            .from(qcItemInstance)
            .innerJoin(qcChecklist, eq(qcItemInstance.checklistId, qcChecklist.id))
            .innerJoin(qcTemplateItem, eq(qcItemInstance.templateItemId, qcTemplateItem.id))
            .where(and(eq(qcItemInstance.qmStatus, "review"), eq(qcItemInstance.approved, false)));

          let filteredQc = (userRole === "QUALITY_MANAGER" || userRole === "quality_manager" || isAdmin) ? qcItems : [];

          const generalApprovals = await db.select({
            id: approvals.id,
            title: approvals.title,
            status: approvals.status,
            projectId: approvals.projectId,
            projectName: projectInfo.projectName,
            requestedAt: approvals.requestedAt,
            approvalCategory: approvals.approvalCategory,
            assignedApprover: approvals.assignedApprover,
            relatedEntityType: approvals.relatedEntityType,
            relatedEntityId: approvals.relatedEntityId,
          })
            .from(approvals)
            .leftJoin(projectInfo, eq(approvals.projectId, projectInfo.id))
            .where(eq(approvals.status, "pending"))
            .orderBy(desc(approvals.requestedAt));

          const generalAssignmentEntries = await Promise.all(
            generalApprovals.map(async (approval) => [approval.id, await getAssignmentsForEntity("approval", approval.id, "APPROVER")] as const),
          );
          const generalAssignmentsById = new Map(generalAssignmentEntries);

          let filteredGeneral = generalApprovals;
          if (!isAdmin) {
            filteredGeneral = generalApprovals.filter((approval) => {
              if (approval.assignedApprover === userId) return true;
              const assignments = (generalAssignmentsById.get(approval.id) || []) as Awaited<ReturnType<typeof getAssignmentsForEntity>>;
              return assignments.some(
                (assignment) => assignment.assigneeType === "internal_user" && assignment.assigneeId === userId,
              );
            });
          }

          return {
            engApprovals: filtered,
            qcItems: filteredQc,
            generalApprovals: filteredGeneral.map((approval) => ({
              ...approval,
              assignments: generalAssignmentsById.get(approval.id) || [],
            })),
          };
        })(),

        db.select().from(deliverables).where(
          sql`(${deliverables.ownerUserId} = ${userId} OR ${deliverables.reviewerUserId} = ${userId})`
        ).orderBy(desc(deliverables.updatedAt)),

        db.execute(
          sql`
              SELECT wi.id, wi.title as task_name, wi.wbs_code as task_no, wi.status,
                     wi.percent_complete as pct_complete, wi.start_date, wi.end_date,
                     wi.duration as duration_days, wi.actual_start as actual_start_date,
                     wi.actual_end as actual_end_date, wi.actual_duration as actual_duration_days,
                     wi.owner_user_id as assignee_user_id, wi.description as comment,
                     CASE WHEN wi.type = 'milestone' THEN true ELSE false END as is_milestone,
                     wi.project_id as project_id,
                     pi.project_name as project_name,
                     wi.legacy_id as import_run_id,
                     wi.external_ref,
                     wi.wbs_code as parent_task_no,
                     wi.workstream,
                     (SELECT wia.role::text FROM work_item_assignments wia
                      WHERE wia.work_item_id = wi.id AND wia.user_id = ${userId}
                      LIMIT 1) as assignment_role
              FROM work_items wi
              LEFT JOIN project_info pi ON wi.project_id = pi.id
              WHERE wi.deleted_at IS NULL
                AND (wi.owner_user_id = ${userId}
                     OR EXISTS (SELECT 1 FROM work_item_assignments wia
                                WHERE wia.work_item_id = wi.id AND wia.user_id = ${userId}))
            `
        ).then((r: any) => Array.isArray(r) ? r : (r.rows || [])),

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

        db.select({
          id: msObjects.id,
          type: msObjects.type,
          subjectOrTitle: msObjects.subjectOrTitle,
          preview: msObjects.preview,
          webLink: msObjects.webLink,
          senderOrOrganizer: msObjects.senderOrOrganizer,
          receivedOrStartDatetime: msObjects.receivedOrStartDatetime,
          actionRequired: msObjects.actionRequired,
          linkedProjectId: msObjects.linkedProjectId,
          linkedTaskId: msObjects.linkedTaskId,
          linkedQualityItemInstanceId: operationalTasks.linkedQualityItemInstanceId,
          linkedProjectName: projectInfo.projectName,
        })
          .from(msObjects)
          .leftJoin(projectInfo, eq(msObjects.linkedProjectId, projectInfo.id))
          .leftJoin(operationalTasks, eq(msObjects.linkedTaskId, operationalTasks.id))
          .where(and(
            eq(msObjects.userId, userId),
            eq(msObjects.actionRequired, true),
            ne(msObjects.dismissed, true),
          ))
          .orderBy(desc(msObjects.receivedOrStartDatetime)),
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

      const resolveTextNameToUser = (name: string | null | undefined): ResolvedUser | null => {
        if (!name || !name.trim()) return null;
        const n = name.trim().toLowerCase();
        const allU = [...userMap.values()];
        let found = allU.find(u => u.name.toLowerCase() === n || u.username.toLowerCase() === n);
        if (!found) found = allU.find(u => u.name.split(" ")[0].toLowerCase() === n);
        if (!found && n.length >= 4) found = allU.find(u => u.name.toLowerCase().startsWith(n) || n.startsWith(u.name.toLowerCase()));
        return found || null;
      };

      const withSourceLinks = (
        source: "personal" | "operational" | "plan" | "engineering_task" | "quality_task" | "approvals" | "deliverables" | "tr_register" | "microsoft",
        payload: Record<string, any>,
        options: {
          itemKey?: string | null;
          rawId?: number | string | null;
          projectName?: string | null;
          sourceType?: string | null;
          linkedTaskId?: number | null;
          linkedTaskType?: "personal" | "operational" | null;
          linkedQualityItemInstanceId?: number | null;
          webLink?: string | null;
        } = {},
      ) => ({
        ...payload,
        itemKey: options.itemKey || null,
        ...buildMyWorkSourceLinks({
          source,
          rawId: options.rawId ?? null,
          itemKey: options.itemKey || null,
          projectName: options.projectName ?? null,
          sourceType: options.sourceType ?? null,
          linkedTaskId: options.linkedTaskId ?? null,
          linkedTaskType: options.linkedTaskType ?? null,
          linkedQualityItemInstanceId: options.linkedQualityItemInstanceId ?? null,
          webLink: options.webLink ?? null,
        }),
      });

      const visibleMicrosoftItems = await filterMicrosoftItemsForRequest(req, microsoftItems);

      res.json({
        personal: personalTasks.map(t => withSourceLinks("personal", {
          ...t,
          resolvedOwner: resolveUserId(t.ownerUserId),
        }, {
          itemKey: `personal-${t.id}`,
          rawId: t.id,
          projectName: t.projectName,
        })),
        operational: opTasks.map(t => {
          const isOwnerOrAssignee = t.ownerUserId === userId || (t.assignees || []).includes(userName);
          const isCreator = t.createdBy === userId;
          const trackingRole = isOwnerOrAssignee && isCreator ? "both" : isOwnerOrAssignee ? "assignee" : "creator";
          return withSourceLinks("operational", {
            ...t,
            status: normalizeTaskStatus(t.status),
            subtaskCount: subtaskCounts[t.id] || 0,
            resolvedAssignees: mergeResolvedWithTextNames(resolveUserIds(t.assigneeUserIds), t.assignees, userMap),
            resolvedOwner: resolveUserId(t.ownerUserId),
            trackingRole,
          }, {
            itemKey: `op-${t.id}`,
            rawId: t.id,
            projectName: t.projectName,
          });
        }),
        trRegister: trRegisterItems.map(t => {
          const isOwner = (t.owners || []).includes(userName);
          const isCreatorByEmail = t.createdBy === userEmail || t.createdBy === userName || t.createdBy === username;
          const trackingRole = isOwner && isCreatorByEmail ? "both" : isOwner ? "assignee" : "creator";
          return withSourceLinks("tr_register", {
            ...t,
            resolvedOwners: mergeResolvedWithTextNames(resolveUserIds(t.ownerUserIds), t.owners, userMap),
            trackingRole,
          }, {
            itemKey: `tr-${t.id}`,
            rawId: t.id,
          });
        }),
        approvals: {
          engineering: approvalData.engApprovals.map((a: any) => withSourceLinks("approvals", {
            id: a.id,
            projectId: a.projectId,
            title: `${a.stageName} — ${a.approverRole}`,
            projectName: a.projectName,
            status: a.status,
            createdAt: a.createdAt,
            type: "engineering" as const,
          }, {
            itemKey: `approval-eng-${a.id}`,
            rawId: a.id,
            projectName: a.projectName,
            sourceType: "engineering",
          })),
          quality: approvalData.qcItems.map((q: any) => withSourceLinks("approvals", {
            id: q.id,
            projectId: q.projectId,
            title: q.itemName,
            projectName: q.projectName,
            status: "review",
            createdAt: q.lastUpdatedAt,
            type: "quality" as const,
          }, {
            itemKey: `approval-qc-${q.id}`,
            rawId: q.id,
            projectName: q.projectName,
            sourceType: "quality",
          })),
          general: (approvalData.generalApprovals || []).map((approval: any) => {
            const primaryAssignment = approval.assignments?.[0] || null;
            return withSourceLinks("approvals", {
              id: approval.id,
              title: approval.title,
              projectId: approval.projectId,
              projectName: approval.projectName,
              status: approval.status,
              createdAt: approval.requestedAt,
              type: "general" as const,
              approvalCategory: approval.approvalCategory,
              relatedEntityType: approval.relatedEntityType,
              relatedEntityId: approval.relatedEntityId,
              assignments: approval.assignments || [],
              assigneeDisplay: primaryAssignment?.displayLabel || (approval.assignedApprover ? resolveUserId(approval.assignedApprover)?.name || null : null),
            }, {
              itemKey: `approval-gen-${approval.id}`,
              rawId: approval.id,
              projectName: approval.projectName,
              sourceType: "general",
            });
          }),
        },
        deliverables: deliverableItems.map((d: any) => withSourceLinks("deliverables", {
          ...d,
          resolvedOwner: resolveUserId(d.ownerUserId),
          resolvedReviewer: resolveUserId(d.reviewerUserId),
          resolvedQcReviewer: resolveUserId(d.qcReviewerUserId),
        }, {
          itemKey: `del-${d.id}`,
          rawId: d.id,
          projectName: d.projectName,
        })),
        planTasks: (planTasks as any[]).map((t: any) => {
          const isOwner = t.assignee_user_id === userId;
          const role = t.assignment_role;
          const isViewer = role === 'VIEWER';
          const isAdminOverview = !role && !isOwner && isAdmin;
          const trackingRole = isViewer ? "viewer" : isAdminOverview ? "admin_overview" : isOwner ? "assignee" : role ? "assignee" : "assignee";
          return withSourceLinks("plan", {
            id: t.id,
            title: t.task_name,
            status: normalizeTaskStatus(t.status),
            projectId: t.project_id,
            projectName: t.project_name,
            owner: t.owner,
            phase: t.phase,
            startDate: t.start_date,
            endDate: t.end_date,
            pctComplete: t.pct_complete,
            assigneeUserId: t.assignee_user_id,
            resolvedAssignee: resolveUserId(t.assignee_user_id) || resolveTextNameToUser(t.owner),
            scheduledDate: t.scheduled_date || null,
            scheduledStartTime: t.scheduled_start_time || null,
            scheduledEndTime: t.scheduled_end_time || null,
            workstream: t.workstream || "PM",
            trackingRole,
            _source: "plan",
          }, {
            itemKey: `plan-${t.id}`,
            rawId: t.id,
            projectName: t.project_name,
          });
        }),
        engineeringTasks: engTasks.map((t: any) => withSourceLinks("engineering_task", {
          id: t.id,
          title: t.title,
          status: normalizeTaskStatus(t.status),
          projectId: t.projectId ?? null,
          projectName: t.projectName,
          lifecyclePhase: t.lifecyclePhaseTag,
          assigneeUserId: t.assigneeUserId,
          assigneeName: t.assigneeName,
          resolvedAssignee: resolveUserId(t.assigneeUserId) || resolveTextNameToUser(t.assigneeName),
          scheduledDate: t.scheduledDate || null,
          scheduledStartTime: t.scheduledStartTime || null,
          scheduledEndTime: t.scheduledEndTime || null,
          _source: "engineering_task",
        }, {
          itemKey: `eng-${t.id}`,
          rawId: t.id,
          projectName: t.projectName,
        })),
        qualityTasks: (qualityTasks as any[]).map((t: any) => withSourceLinks("quality_task", {
          id: t.id,
          title: t.item_name,
          status: normalizeTaskStatus(t.qm_status || "not_started"),
          projectId: t.project_id,
          projectName: t.project_name,
          startDate: t.start_date,
          endDate: t.end_date,
          assigneeUserId: t.assignee_user_id,
          resolvedAssignee: resolveUserId(t.assignee_user_id),
          scheduledDate: t.scheduled_date || null,
          scheduledStartTime: t.scheduled_start_time || null,
          scheduledEndTime: t.scheduled_end_time || null,
          _source: "quality_task",
        }, {
          itemKey: `qc-${t.id}`,
          rawId: t.id,
          projectName: t.project_name,
        })),
        microsoftItems: visibleMicrosoftItems.map((item: any) => {
          const linkedTaskType = item.linkedTaskId ? (item.linkedProjectId ? "operational" : "personal") : null;
          return withSourceLinks("microsoft", {
            ...item,
            linkedTaskType,
          }, {
            itemKey: `ms-${item.id}`,
            rawId: item.id,
            projectName: item.linkedProjectName,
            sourceType: item.type,
            linkedTaskId: item.linkedTaskId,
            linkedTaskType,
            linkedQualityItemInstanceId: item.linkedQualityItemInstanceId,
            webLink: item.webLink,
          });
        }),
        userMap: Object.fromEntries(userMap),
      });
    } catch (err: any) {
      console.error("[MyWork AllTasks] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/project-chat/:projectId", jwtAuth, requireAuth, requirePermission("teams_chat", "view"), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "auth_required" });

      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      const [project] = await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const [msAccount] = await db.select({ id: msAccounts.id }).from(msAccounts).where(eq(msAccounts.userId, userId));
      if (!msAccount) {
        return res.json({ found: false, ssoRequired: true, message: "Sign in with Microsoft to link Teams chats" });
      }

      const linkedChat = await db.select().from(msObjects).where(
        and(eq(msObjects.linkedProjectId, projectId), eq(msObjects.type, "teams"))
      ).limit(1);

      if (linkedChat.length > 0) {
        const chat = linkedChat[0];
        const meta = chat.metadata as any;
        return res.json({
          found: true,
          chat: {
            id: chat.id,
            msId: chat.msId,
            title: chat.subjectOrTitle || "Teams Chat",
            webLink: chat.webLink,
            memberCount: meta?.memberCount || null,
            lastUpdated: chat.receivedOrStartDatetime,
            chatType: meta?.chatType || "group",
            preview: chat.preview,
          },
        });
      }

      const pName = project.projectName || "";
      const normalizedName = pName.replace(/_/g, " ").replace(/Tracker.*$/i, "").trim().toLowerCase();
      const words = normalizedName.split(/\s+/).filter(w => w.length > 2);

      const userTeamsChats = await db.select().from(msObjects).where(
        and(eq(msObjects.userId, userId), eq(msObjects.type, "teams"))
      ).orderBy(desc(msObjects.receivedOrStartDatetime));

      let autoMatch = null;
      if (words.length > 0) {
        for (const chat of userTeamsChats) {
          const chatTitle = (chat.subjectOrTitle || "").toLowerCase();
          const matchCount = words.filter(w => chatTitle.includes(w)).length;
          if (matchCount >= Math.ceil(words.length * 0.6)) {
            autoMatch = chat;
            break;
          }
        }
      }

      if (autoMatch) {
        const meta = autoMatch.metadata as any;
        return res.json({
          found: true,
          autoMatched: true,
          chat: {
            id: autoMatch.id,
            msId: autoMatch.msId,
            title: autoMatch.subjectOrTitle || "Teams Chat",
            webLink: autoMatch.webLink,
            memberCount: meta?.memberCount || null,
            lastUpdated: autoMatch.receivedOrStartDatetime,
            chatType: meta?.chatType || "group",
            preview: autoMatch.preview,
          },
          allChats: userTeamsChats.map(c => {
            const m = c.metadata as any;
            return {
              id: c.id,
              title: c.subjectOrTitle || "Unnamed Chat",
              memberCount: m?.memberCount || null,
              chatType: m?.chatType || "unknown",
              preview: c.preview,
              webLink: c.webLink,
              lastUpdated: c.receivedOrStartDatetime,
            };
          }),
        });
      }

      return res.json({
        found: false,
        allChats: userTeamsChats.map(c => {
          const m = c.metadata as any;
          return {
            id: c.id,
            title: c.subjectOrTitle || "Unnamed Chat",
            memberCount: m?.memberCount || null,
            chatType: m?.chatType || "unknown",
            preview: c.preview,
            webLink: c.webLink,
            lastUpdated: c.receivedOrStartDatetime,
          };
        }),
      });
    } catch (err: any) {
      console.error("[MS Teams Project Chat] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/ms-teams/project-chat/:projectId/unlink", jwtAuth, requireAuth, requirePermission("teams_chat", "delete"), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role || "";
      if (!["admin", "COO_ADMIN", "CEO_ADMIN"].includes(userRole)) {
        return res.status(403).json({ error: "Only admin/COO can unlink Teams chats" });
      }

      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

      await db.update(msObjects)
        .set({ linkedProjectId: null })
        .where(and(eq(msObjects.linkedProjectId, projectId), eq(msObjects.type, "teams")));

      res.json({ success: true });
    } catch (err: any) {
      console.error("[MS Teams Unlink] Error:", err);
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
