import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, isNull, lt, gt, or, ne } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  operationalTasks, taskComments, taskActivityLog, taskWatchers,
  deliverables, deliverableVersions, deliverableFiles, deliverableEvents,
  notifications, notificationThrottle, spFilePointers,
  projectTeamMembers, projectPlan, qcWarning, qcWarningEvent,
  qcItemInstance, users, projectInfo, projectPhaseHistory,
  phaseTemplate as phaseTemplateTbl,
  uploadMetadata, refreshLogs, writebackAuditLog, phaseTemplateApplication,
  TASK_STATUSES, TASK_WORKSTREAMS, TASK_PRIORITIES, PROJECT_PHASES,
  DELIVERABLE_STATUSES, PROJECT_PHASE_LABELS,
  type ProjectPhase,
} from "@shared/schema";
import { applyTemplate } from "./template-routes";
import { generateEngStagesForProject } from "./eng-stage-routes";
import { PHASE_TO_ENG_STAGES } from "@shared/schema";

type AppUser = { id: number; email: string; name: string; role: string; };

function getUser(req: Request): AppUser {
  return req.user as any as AppUser;
}

function getUserRole(req: Request): string {
  return (req.user as any)?.role || "";
}

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
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
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdminOrEpm(req: Request, res: Response, next: NextFunction) {
  const role = getUserRole(req);
  const allowed = [
    "admin", "eng_program_manager",
    "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO",
    "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_FINANCE_MANAGER",
    "ENGINEERING_PROGRAM_MANAGER", "QUALITY_MANAGER", "HEAD_OF_DESIGN",
  ];
  if (allowed.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Admin or EPM access required" });
}

function requireEpmChallenge(req: Request, res: Response, next: NextFunction) {
  if (getUserRole(req) === "admin") return next();
  if ((req.session as any)?.epmChallengePassed) return next();
  res.status(403).json({ error: "epm_challenge_required", message: "EPM access code required", code: "EPM_CHALLENGE_REQUIRED" });
}

async function createNotification(recipientUserId: number, eventType: string, title: string, body: string | null, opts: {
  projectName?: string; linkedTaskId?: number; linkedDeliverableId?: number; linkedWarningId?: number; linkedPlanItemId?: number;
} = {}) {
  const throttleKey = `${eventType}:${opts.linkedTaskId || opts.linkedDeliverableId || opts.linkedWarningId || 0}`;
  const existing = await db.select().from(notificationThrottle)
    .where(and(
      eq(notificationThrottle.recipientUserId, recipientUserId),
      eq(notificationThrottle.eventType, eventType),
      eq(notificationThrottle.entityType, throttleKey.split(':')[0] || 'generic'),
      eq(notificationThrottle.entityId, opts.linkedTaskId || opts.linkedDeliverableId || opts.linkedWarningId || 0),
      gt(notificationThrottle.lastSentAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    ));

  if (existing.length > 0) return null;

  const [notif] = await db.insert(notifications).values({
    recipientUserId,
    eventType,
    title,
    body,
    projectName: opts.projectName || null,
    linkedTaskId: opts.linkedTaskId || null,
    linkedDeliverableId: opts.linkedDeliverableId || null,
    linkedWarningId: opts.linkedWarningId || null,
    linkedPlanItemId: opts.linkedPlanItemId || null,
  }).returning();

  await db.insert(notificationThrottle).values({
    recipientUserId,
    eventType,
    entityType: throttleKey.split(':')[0] || 'generic',
    entityId: opts.linkedTaskId || opts.linkedDeliverableId || opts.linkedWarningId || 0,
  }).onConflictDoNothing();

  return notif;
}

export function registerEngineeringRoutes(app: Express) {

  app.use("/api/eng", jwtAuth);
  app.use("/api/deliverables", jwtAuth);
  app.use("/api/notifications", jwtAuth);
  app.use("/api/project-team", jwtAuth);

  // ========== PROJECT TEAM MEMBERSHIP ==========

  app.get("/api/project-team/:projectName", requireAuth, async (req, res) => {
    try {
      const members = await db.select({
        id: projectTeamMembers.id,
        projectName: projectTeamMembers.projectName,
        userId: projectTeamMembers.userId,
        roleOnProject: projectTeamMembers.roleOnProject,
        createdAt: projectTeamMembers.createdAt,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(projectTeamMembers)
      .leftJoin(users, eq(projectTeamMembers.userId, users.id))
      .where(eq(projectTeamMembers.projectName, req.params.projectName));
      res.json(members);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/project-team", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const { projectName, userId, roleOnProject } = req.body;
      const [member] = await db.insert(projectTeamMembers).values({ projectName, userId, roleOnProject }).returning();
      res.json(member);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/project-team/:id", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      await db.delete(projectTeamMembers).where(eq(projectTeamMembers.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/team-members", requireAuth, async (_req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      }).from(users);
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/backfill-assignees", requireAuth, requireAdminOrEpm, async (_req, res) => {
    try {
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
      const allTasks = await db.select().from(operationalTasks);

      const nameMap: Record<string, { id: number; name: string }> = {};
      for (const u of allUsers) {
        nameMap[u.name.toLowerCase()] = { id: u.id, name: u.name };
        const first = u.name.split(/\s+/)[0].toLowerCase();
        if (!nameMap[first]) nameMap[first] = { id: u.id, name: u.name };
      }

      let updated = 0;
      let assigneesFixed = 0;

      for (const task of allTasks) {
        const assignees = (task.assignees as string[]) || [];
        if (assignees.length === 0) continue;

        let newAssignees = [...assignees];
        let ownerUserId = task.ownerUserId;
        let changed = false;

        for (let i = 0; i < newAssignees.length; i++) {
          const a = newAssignees[i];
          const lower = a.toLowerCase();
          const first = lower.split(/\s+/)[0];

          const match = nameMap[lower] || nameMap[first];
          if (match) {
            if (newAssignees[i] !== match.name) {
              newAssignees[i] = match.name;
              changed = true;
              assigneesFixed++;
            }
            if (i === 0 && !ownerUserId) {
              ownerUserId = match.id;
              changed = true;
            }
          }
        }

        if (changed) {
          await db.update(operationalTasks)
            .set({ assignees: newAssignees, ownerUserId })
            .where(eq(operationalTasks.id, task.id));
          updated++;
        }
      }

      res.json({ message: `Backfill complete: ${updated} tasks updated, ${assigneesFixed} assignee names normalized` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== ENHANCED TASK OPERATIONS ==========

  app.get("/api/eng/tasks", requireAuth, async (req, res) => {
    try {
      const { projectName, status, workstream, phase, ownerUserId } = req.query;
      let query = db.select().from(operationalTasks);
      const conditions: any[] = [];

      if (projectName) conditions.push(eq(operationalTasks.projectName, projectName as string));
      if (status) conditions.push(eq(operationalTasks.status, status as string));
      if (workstream) conditions.push(eq(operationalTasks.primaryWorkstream, workstream as string));
      if (phase) conditions.push(eq(operationalTasks.phase, phase as string));
      if (ownerUserId) conditions.push(eq(operationalTasks.ownerUserId, parseInt(ownerUserId as string)));

      const tasks = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(asc(operationalTasks.sortOrder))
        : await query.orderBy(asc(operationalTasks.sortOrder));

      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      if (!TASK_STATUSES.includes(data.status)) {
        data.status = "TO DO";
      }
      if (!data.ownerUserId && data.assignees?.length > 0) {
        const assigneeName = data.assignees[0];
        const [matchedUser] = await db.select({ id: users.id }).from(users)
          .where(sql`LOWER(${users.name}) = LOWER(${assigneeName})`).limit(1);
        if (matchedUser) data.ownerUserId = matchedUser.id;
      }
      const [task] = await db.insert(operationalTasks).values({
        ...data,
        createdBy: getUser(req).id,
      }).returning();

      await db.insert(taskActivityLog).values({
        taskId: task.id,
        actorId: getUser(req).id,
        actionType: "created",
        newValue: task.title,
      });

      if (task.ownerUserId && task.ownerUserId !== getUser(req).id) {
        await createNotification(task.ownerUserId, "task.assigned", `Task assigned: ${task.title}`, `You've been assigned task "${task.title}"`, {
          projectName: task.projectName, linkedTaskId: task.id,
        });
      }

      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/eng/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(operationalTasks).where(eq(operationalTasks.id, id));
      if (!existing) return res.status(404).json({ error: "Task not found" });

      const updates = { ...req.body, updatedAt: new Date() };

      if (updates.status && !TASK_STATUSES.includes(updates.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${TASK_STATUSES.join(", ")}` });
      }

      if (updates.status === "HOLD" && !updates.holdReason) {
        return res.status(400).json({ error: "Hold reason required when setting status to HOLD" });
      }
      if (updates.status && updates.status !== "HOLD" && existing.status === "HOLD" && !updates.holdReason) {
        updates.holdReason = null;
      }
      if (updates.status === "PROJECTS ASSISTANCE" && !updates.requesterUserId && !existing.requesterUserId) {
        return res.status(400).json({ error: "Requester required for PROJECTS ASSISTANCE status" });
      }
      if (updates.status === "NEEDS APPROVAL" && !updates.approverUserId && !existing.approverUserId) {
        return res.status(400).json({ error: "Approver required for NEEDS APPROVAL status" });
      }
      if (updates.status === "COMPLETE") {
        updates.completedAt = new Date();
      }
      if (updates.assignees && Array.isArray(updates.assignees) && updates.assignees.length > 0 && !updates.ownerUserId) {
        const [matchedUser] = await db.select({ id: users.id }).from(users)
          .where(sql`LOWER(${users.name}) = LOWER(${updates.assignees[0]})`).limit(1);
        if (matchedUser) updates.ownerUserId = matchedUser.id;
      }

      const [updated] = await db.update(operationalTasks).set(updates).where(eq(operationalTasks.id, id)).returning();

      for (const [key, val] of Object.entries(req.body)) {
        if (key === "updatedAt") continue;
        const oldVal = (existing as any)[key];
        if (String(oldVal) !== String(val)) {
          await db.insert(taskActivityLog).values({
            taskId: id,
            actorId: getUser(req).id,
            actionType: "field_changed",
            fieldName: key,
            oldValue: oldVal != null ? String(oldVal) : null,
            newValue: val != null ? String(val) : null,
          });
        }
      }

      if (updates.status && updates.status !== existing.status) {
        if (updated.ownerUserId) {
          await createNotification(updated.ownerUserId, "task.status_changed",
            `Task status: ${updated.title}`, `Status changed from "${existing.status}" to "${updates.status}"`,
            { projectName: updated.projectName, linkedTaskId: id });
        }
        if (updates.status === "NEEDS APPROVAL" && updated.approverUserId) {
          await createNotification(updated.approverUserId, "deliverable.submitted_for_approval",
            `Approval needed: ${updated.title}`, `Task "${updated.title}" needs your approval`,
            { projectName: updated.projectName, linkedTaskId: id });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks/bulk-update", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const { taskIds, updates } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return res.status(400).json({ error: "taskIds array required" });
      }
      if (updates.status === "HOLD" && !updates.holdReason) {
        return res.status(400).json({ error: "Hold reason required when setting status to HOLD" });
      }
      if (updates.status === "NEEDS APPROVAL" && !updates.approverUserId) {
        return res.status(400).json({ error: "Approver required for NEEDS APPROVAL status" });
      }

      const updatedTasks = [];
      for (const taskId of taskIds) {
        const bulkSet: Record<string, any> = { ...updates, updatedAt: new Date() };
        if (updates.status === "COMPLETE") bulkSet.completedAt = new Date();
        const [updated] = await db.update(operationalTasks)
          .set(bulkSet)
          .where(eq(operationalTasks.id, taskId))
          .returning();
        if (updated) {
          updatedTasks.push(updated);
          await db.insert(taskActivityLog).values({
            taskId, actorId: getUser(req).id,
            actionType: "bulk_updated",
            newValue: JSON.stringify(updates),
          });
        }
      }
      res.json({ updated: updatedTasks.length, tasks: updatedTasks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks/:id/link", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { linkedPlanItemId, linkedDeliverableId, linkedQualityItemInstanceId } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (linkedPlanItemId !== undefined) updates.linkedPlanItemId = linkedPlanItemId;
      if (linkedDeliverableId !== undefined) updates.linkedDeliverableId = linkedDeliverableId;
      if (linkedQualityItemInstanceId !== undefined) updates.linkedQualityItemInstanceId = linkedQualityItemInstanceId;

      const [updated] = await db.update(operationalTasks).set(updates).where(eq(operationalTasks.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Task not found" });

      await db.insert(taskActivityLog).values({
        taskId: id, actorId: getUser(req).id,
        actionType: "linked", newValue: JSON.stringify(req.body),
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/tasks/:id/watchers", requireAuth, async (req, res) => {
    try {
      const watchers = await db.select({
        id: taskWatchers.id, userId: taskWatchers.userId,
        userName: users.name, userEmail: users.email,
      })
      .from(taskWatchers)
      .leftJoin(users, eq(taskWatchers.userId, users.id))
      .where(eq(taskWatchers.taskId, parseInt(req.params.id)));
      res.json(watchers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks/:id/watchers", requireAuth, async (req, res) => {
    try {
      const [watcher] = await db.insert(taskWatchers).values({
        taskId: parseInt(req.params.id),
        userId: req.body.userId,
      }).returning();
      res.json(watcher);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/eng/tasks/:taskId/watchers/:userId", requireAuth, async (req, res) => {
    try {
      await db.delete(taskWatchers).where(
        and(eq(taskWatchers.taskId, parseInt(req.params.taskId)),
            eq(taskWatchers.userId, parseInt(req.params.userId)))
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== TASK DETAIL ENDPOINTS ==========

  app.get("/api/eng/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [task] = await db.select().from(operationalTasks).where(eq(operationalTasks.id, id));
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/tasks/:id/comments", requireAuth, async (req, res) => {
    try {
      const comments = await db.select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        authorId: taskComments.authorId,
        body: taskComments.body,
        createdAt: taskComments.createdAt,
        authorName: users.name,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.taskId, parseInt(req.params.id)))
      .orderBy(asc(taskComments.createdAt));
      res.json(comments);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks/:id/comments", requireAuth, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const { body } = req.body;
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Comment body is required" });
      }
      const [comment] = await db.insert(taskComments).values({
        taskId,
        authorId: getUser(req).id,
        body: body.trim(),
      }).returning();

      await db.insert(taskActivityLog).values({
        taskId,
        actorId: getUser(req).id,
        actionType: "comment_added",
        newValue: body.trim(),
      });

      res.json(comment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/tasks/:id/activity", requireAuth, async (req, res) => {
    try {
      const activity = await db.select({
        id: taskActivityLog.id,
        taskId: taskActivityLog.taskId,
        actorId: taskActivityLog.actorId,
        actionType: taskActivityLog.actionType,
        fieldName: taskActivityLog.fieldName,
        oldValue: taskActivityLog.oldValue,
        newValue: taskActivityLog.newValue,
        createdAt: taskActivityLog.createdAt,
        actorName: users.name,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .where(eq(taskActivityLog.taskId, parseInt(req.params.id)))
      .orderBy(desc(taskActivityLog.createdAt));
      res.json(activity);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/tasks/:id/subtasks", requireAuth, async (req, res) => {
    try {
      const subtasks = await db.select().from(operationalTasks)
        .where(eq(operationalTasks.parentTaskId, parseInt(req.params.id)))
        .orderBy(asc(operationalTasks.sortOrder));
      res.json(subtasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/tasks/:id/subtasks", requireAuth, async (req, res) => {
    try {
      const parentId = parseInt(req.params.id);
      const [parent] = await db.select().from(operationalTasks).where(eq(operationalTasks.id, parentId));
      if (!parent) return res.status(404).json({ error: "Parent task not found" });

      const data = req.body;
      if (!data.title) {
        return res.status(400).json({ error: "Subtask title is required" });
      }

      const [subtask] = await db.insert(operationalTasks).values({
        ...data,
        parentTaskId: parentId,
        projectName: data.projectName || parent.projectName,
        status: data.status || "TO DO",
        priority: data.priority || "Med",
        createdBy: getUser(req).id,
      }).returning();

      await db.insert(taskActivityLog).values({
        taskId: parentId,
        actorId: getUser(req).id,
        actionType: "subtask_created",
        newValue: subtask.title,
      });

      res.json(subtask);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== DELIVERABLES ==========

  app.get("/api/deliverables", requireAuth, async (req, res) => {
    try {
      const { projectName, status, phase } = req.query;
      const conditions: any[] = [];
      if (projectName) conditions.push(eq(deliverables.projectName, projectName as string));
      if (status) conditions.push(eq(deliverables.status, status as string));
      if (phase) conditions.push(eq(deliverables.phase, phase as string));

      const result = conditions.length > 0
        ? await db.select().from(deliverables).where(and(...conditions)).orderBy(desc(deliverables.updatedAt))
        : await db.select().from(deliverables).orderBy(desc(deliverables.updatedAt));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/deliverables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [del] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!del) return res.status(404).json({ error: "Deliverable not found" });

      const versions = await db.select().from(deliverableVersions)
        .where(eq(deliverableVersions.deliverableId, id))
        .orderBy(desc(deliverableVersions.versionNumber));

      const files = await db.select().from(deliverableFiles)
        .where(eq(deliverableFiles.deliverableId, id))
        .orderBy(desc(deliverableFiles.uploadedAt));

      const events = await db.select().from(deliverableEvents)
        .where(eq(deliverableEvents.deliverableId, id))
        .orderBy(desc(deliverableEvents.createdAt));

      res.json({ ...del, versions, files, events });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deliverables", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const [del] = await db.insert(deliverables).values({
        ...data,
        status: "TO DO",
        currentVersion: 1,
      }).returning();

      await db.insert(deliverableVersions).values({
        deliverableId: del.id,
        versionNumber: 1,
        status: "TO DO",
        createdByUserId: getUser(req).id,
      });

      await db.insert(deliverableEvents).values({
        deliverableId: del.id,
        eventType: "created",
        toStatus: "TO DO",
        actorUserId: getUser(req).id,
      });

      res.json(del);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/deliverables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!existing) return res.status(404).json({ error: "Deliverable not found" });

      const updates = { ...req.body, updatedAt: new Date() };
      const [updated] = await db.update(deliverables).set(updates).where(eq(deliverables.id, id)).returning();

      if (updates.status && updates.status !== existing.status) {
        await db.insert(deliverableEvents).values({
          deliverableId: id,
          eventType: "status_changed",
          fromStatus: existing.status,
          toStatus: updates.status,
          actorUserId: getUser(req).id,
        });

        if (updates.status === "NEEDS APPROVAL" && updated.reviewerUserId) {
          await createNotification(updated.reviewerUserId, "deliverable.submitted_for_approval",
            `Review needed: ${updated.title}`, `Deliverable "${updated.title}" v${updated.currentVersion} needs review`,
            { projectName: updated.projectName, linkedDeliverableId: id });
        }
        if (updates.status === "QC APPROVED" && updated.ownerUserId) {
          await createNotification(updated.ownerUserId, "deliverable.qc_approved",
            `QC Approved: ${updated.title}`, `Deliverable "${updated.title}" has been QC approved`,
            { projectName: updated.projectName, linkedDeliverableId: id });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deliverables/:id/feedback", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { feedbackText } = req.body;

      const [updated] = await db.update(deliverables)
        .set({ status: "PROVIDE FEEDBACK", updatedAt: new Date() })
        .where(eq(deliverables.id, id)).returning();

      await db.insert(deliverableEvents).values({
        deliverableId: id,
        eventType: "feedback_provided",
        fromStatus: "NEEDS APPROVAL",
        toStatus: "PROVIDE FEEDBACK",
        feedbackText,
        actorUserId: getUser(req).id,
      });

      if (updated?.ownerUserId) {
        await createNotification(updated.ownerUserId, "deliverable.feedback_requested",
          `Feedback on: ${updated.title}`, feedbackText,
          { projectName: updated.projectName, linkedDeliverableId: id });
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deliverables/:id/revise", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { changeReason, impactJson } = req.body;

      const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!existing) return res.status(404).json({ error: "Deliverable not found" });

      const newVersion = existing.currentVersion + 1;

      const [version] = await db.insert(deliverableVersions).values({
        deliverableId: id,
        versionNumber: newVersion,
        changeReason: changeReason || null,
        impactJson: impactJson || null,
        status: "IN PROGRESS",
        createdByUserId: getUser(req).id,
      }).returning();

      const [updated] = await db.update(deliverables)
        .set({ currentVersion: newVersion, status: "IN PROGRESS", updatedAt: new Date() })
        .where(eq(deliverables.id, id)).returning();

      await db.insert(deliverableEvents).values({
        deliverableId: id,
        eventType: "revised",
        fromStatus: existing.status,
        toStatus: "IN PROGRESS",
        feedbackText: changeReason,
        actorUserId: getUser(req).id,
      });

      res.json({ deliverable: updated, version });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deliverables/:id/files", requireAuth, async (req, res) => {
    try {
      const [file] = await db.insert(deliverableFiles).values({
        ...req.body,
        deliverableId: parseInt(req.params.id),
        uploadedByUserId: getUser(req).id,
      }).returning();
      res.json(file);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/deliverables/files/:fileId/approve", requireAuth, async (req, res) => {
    try {
      const [file] = await db.update(deliverableFiles)
        .set({ isApproved: true })
        .where(eq(deliverableFiles.id, parseInt(req.params.fileId)))
        .returning();
      res.json(file);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== NOTIFICATIONS ==========

  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const userId = getUser(req).id;
      const { unreadOnly } = req.query;
      const conditions = [eq(notifications.recipientUserId, userId)];
      if (unreadOnly === "true") conditions.push(eq(notifications.isRead, false));

      const result = await db.select().from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(100);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const userId = getUser(req).id;
      const [result] = await db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), eq(notifications.isRead, false)));
      res.json({ count: result?.count || 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/notifications/mark-read", requireAuth, async (req, res) => {
    try {
      const { notificationIds } = req.body;
      if (Array.isArray(notificationIds) && notificationIds.length > 0) {
        await db.update(notifications)
          .set({ isRead: true, readAt: new Date() })
          .where(and(
            inArray(notifications.id, notificationIds),
            eq(notifications.recipientUserId, getUser(req).id)
          ));
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
    try {
      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(
          eq(notifications.recipientUserId, getUser(req).id),
          eq(notifications.isRead, false)
        ));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== SHAREPOINT FILE POINTERS ==========

  app.get("/api/eng/file-pointers/:entityType/:entityId", requireAuth, async (req, res) => {
    try {
      const result = await db.select().from(spFilePointers)
        .where(and(
          eq(spFilePointers.entityType, req.params.entityType),
          eq(spFilePointers.entityId, parseInt(req.params.entityId))
        ))
        .orderBy(desc(spFilePointers.uploadedAt));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/file-pointers", requireAuth, async (req, res) => {
    try {
      const { entityType, entityId, spSiteId, spDriveId, spFileItemId, fileName, label, siteId, driveId, fileItemId, webUrl } = req.body;
      const [pointer] = await db.insert(spFilePointers).values({
        entityType,
        entityId,
        siteId: siteId || spSiteId,
        driveId: driveId || spDriveId,
        fileItemId: fileItemId || spFileItemId,
        fileName,
        webUrl: webUrl || null,
        uploadedByUserId: getUser(req).id,
      }).returning();
      res.json(pointer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/eng/file-pointers/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(spFilePointers).where(eq(spFilePointers.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== WARNING ENGINE - ENHANCED RULES ==========

  app.post("/api/eng/warnings/scan", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const { projectName } = req.body;
      const newWarnings: any[] = [];
      const today = new Date().toISOString().split('T')[0];

      const taskConditions: any[] = [ne(operationalTasks.status, "COMPLETE")];
      if (projectName) taskConditions.push(eq(operationalTasks.projectName, projectName));

      const allTasks = await db.select().from(operationalTasks).where(and(...taskConditions));

      for (const task of allTasks) {
        if (task.dueDate && task.dueDate < today && task.status !== "COMPLETE") {
          const isHighPhase = task.phase === "Commissioning" || task.phase === "Handover";
          newWarnings.push({
            projectName: task.projectName,
            severity: isHighPhase ? "HIGH" : "MED",
            warningType: "overdue_task",
            title: `Overdue task: ${task.title}`,
            description: `Due ${task.dueDate}, status: ${task.status}`,
            relatedPlanItemId: task.linkedPlanItemId,
          });
        }

        if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
          newWarnings.push({
            projectName: task.projectName,
            severity: "HIGH",
            warningType: "invalid_dates",
            title: `Invalid dates: ${task.title}`,
            description: `End date ${task.dueDate} is before start date ${task.startDate}`,
          });
        }

        if (!task.linkedPlanItemId && !task.linkedDeliverableId && !task.linkedQualityItemInstanceId) {
          const createdMore24h = task.createdAt && (Date.now() - new Date(task.createdAt).getTime()) > 24 * 60 * 60 * 1000;
          if (createdMore24h) {
            newWarnings.push({
              projectName: task.projectName,
              severity: "MED",
              warningType: "orphan_task",
              title: `Orphan task: ${task.title}`,
              description: `Task not linked to any plan item, deliverable, or quality checklist item`,
            });
          }
        }

        if (task.status === "NEEDS APPROVAL" && task.updatedAt) {
          const daysSinceUpdate = (Date.now() - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate > 2) {
            newWarnings.push({
              projectName: task.projectName,
              severity: "MED",
              warningType: "review_stuck",
              title: `Review stuck: ${task.title}`,
              description: `In NEEDS APPROVAL for ${Math.floor(daysSinceUpdate)} days`,
            });
          }
        }
      }

      const delConditions: any[] = [ne(deliverables.status, "COMPLETE")];
      if (projectName) delConditions.push(eq(deliverables.projectName, projectName));
      const allDeliverables = await db.select().from(deliverables).where(and(...delConditions));

      for (const del of allDeliverables) {
        if (del.status === "QC APPROVED" || del.status === "COMPLETE") {
          const approvedFiles = await db.select().from(deliverableFiles)
            .where(and(eq(deliverableFiles.deliverableId, del.id), eq(deliverableFiles.isApproved, true)));
          if (approvedFiles.length === 0) {
            newWarnings.push({
              projectName: del.projectName,
              severity: "HIGH",
              warningType: "missing_evidence",
              title: `Missing approved files: ${del.title}`,
              description: `Deliverable is ${del.status} but has no approved file pointers`,
            });
          }
        }
      }

      if (newWarnings.length > 0) {
        await db.insert(qcWarning).values(newWarnings);
      }

      res.json({ scanned: allTasks.length + allDeliverables.length, warningsCreated: newWarnings.length, warnings: newWarnings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/warnings", requireAuth, async (req, res) => {
    try {
      const { projectName, severity, status, warningType } = req.query;
      const conditions: any[] = [];
      if (projectName) conditions.push(eq(qcWarning.projectName, projectName as string));
      if (severity) conditions.push(eq(qcWarning.severity, severity as string));
      if (status) conditions.push(eq(qcWarning.status, status as string));
      if (warningType) conditions.push(eq(qcWarning.warningType, warningType as string));

      const result = conditions.length > 0
        ? await db.select().from(qcWarning).where(and(...conditions)).orderBy(desc(qcWarning.createdAt))
        : await db.select().from(qcWarning).orderBy(desc(qcWarning.createdAt));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/eng/warnings/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = { ...req.body, updatedAt: new Date() };
      const [updated] = await db.update(qcWarning).set(updates).where(eq(qcWarning.id, id)).returning();

      if (req.body.status) {
        await db.insert(qcWarningEvent).values({
          warningId: id,
          eventType: `status_changed_to_${req.body.status}`,
          note: req.body.note || null,
          actorUserId: getUser(req).id,
        });
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/eng/warnings/:id/acknowledge", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.insert(qcWarningEvent).values({
        warningId: id,
        eventType: "acknowledged",
        note: req.body.reason || "Acknowledged - proceeding anyway",
        actorUserId: getUser(req).id,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== ENGINEERING STANDUP DASHBOARD ==========

  app.get("/api/eng/dashboard/standup", requireAuth, async (req, res) => {
    try {
      const role = getUserRole(req);
      const managerRoles = ["admin", "eng_program_manager", "CEO_ADMIN", "COO_ADMIN", "CCO", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"];
      const isManager = managerRoles.includes(role);
      const userName = getUser(req).name || "";
      const userFirstName = userName.split(/\s+/)[0];
      let assigneeFilter: string | undefined;
      if (isManager) {
        assigneeFilter = req.query.assignee as string | undefined;
      } else {
        assigneeFilter = userFirstName || undefined;
      }
      const todayStr = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const sevenDaysOut = new Date();
      sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      const weekEndStr = sevenDaysOut.toISOString().split('T')[0];

      const [rawTasks, allProjectInfoRows] = await Promise.all([
        db.select().from(operationalTasks)
          .orderBy(asc(operationalTasks.projectName), asc(operationalTasks.sortOrder)),
        db.select({ projectName: projectInfo.projectName, phase: projectInfo.phase })
          .from(projectInfo),
      ]);

      const allTasks = assigneeFilter
        ? rawTasks.filter(t => {
            if (!t.assignees || !Array.isArray(t.assignees)) return false;
            const filterLower = assigneeFilter.toLowerCase();
            return t.assignees.some(a => a && a.toLowerCase().startsWith(filterLower));
          })
        : rawTasks;

      const normalizeKey = (n: string) => n.replace(/_Tracker.*$/i, "").replace(/_/g, " ").toLowerCase().trim();
      const phaseByNorm = new Map<string, string>();
      for (const pi of allProjectInfoRows) {
        if (pi.phase) phaseByNorm.set(normalizeKey(pi.projectName), pi.phase);
      }
      function lookupPhase(taskProjectName: string): string {
        const norm = normalizeKey(taskProjectName);
        if (phaseByNorm.has(norm)) return phaseByNorm.get(norm)!;
        const baseName = norm.replace(/\s*(phase\s*\d+|expansion|rev\d+|\+.*$)/gi, "").trim();
        if (baseName && phaseByNorm.has(baseName)) return phaseByNorm.get(baseName)!;
        for (const [key, phase] of phaseByNorm) {
          if (key.startsWith(baseName) || baseName.startsWith(key)) return phase;
        }
        return "P0_FIRST_ASSESSMENT";
      }

      const openStatuses = new Set(["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK", "PROJECTS ASSISTANCE"]);

      const recentlyCompleted = allTasks.filter(t =>
        t.status === "COMPLETE" && t.completedAt &&
        new Date(t.completedAt).toISOString().split('T')[0] >= yesterdayStr
      );

      const blockers = allTasks.filter(t =>
        t.status === "HOLD" || (t.status !== "COMPLETE" && t.dueDate && t.dueDate < todayStr)
      );

      const holdItems = blockers.filter(t => t.status === "HOLD");
      const overdueItems = blockers.filter(t => t.status !== "HOLD" && t.dueDate && t.dueDate < todayStr);

      const upcomingThisWeek = allTasks.filter(t =>
        openStatuses.has(t.status) && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr
      ).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

      const inProgress = allTasks.filter(t => t.status === "IN PROGRESS");
      const needsApproval = allTasks.filter(t => t.status === "NEEDS APPROVAL" || t.status === "PROVIDE FEEDBACK");

      const assigneeMap = new Map<string, { active: number; overdue: number; hold: number; dueThisWeek: number }>();
      for (const t of allTasks) {
        if (t.status === "COMPLETE") continue;
        const names = t.assignees && Array.isArray(t.assignees) ? t.assignees.filter(Boolean) : [];
        if (names.length === 0) names.push("Unassigned");
        for (const name of names) {
          if (!assigneeMap.has(name)) assigneeMap.set(name, { active: 0, overdue: 0, hold: 0, dueThisWeek: 0 });
          const w = assigneeMap.get(name)!;
          w.active++;
          if (t.dueDate && t.dueDate < todayStr) w.overdue++;
          if (t.status === "HOLD") w.hold++;
          if (t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr) w.dueThisWeek++;
        }
      }
      const workload = Array.from(assigneeMap.entries()).map(([name, w]) => ({ name, ...w }))
        .sort((a, b) => b.overdue - a.overdue || b.active - a.active);

      const projectMap = new Map<string, typeof allTasks>();
      for (const t of allTasks) {
        const key = t.projectName || "Unassigned";
        if (!projectMap.has(key)) projectMap.set(key, []);
        projectMap.get(key)!.push(t);
      }

      const projectHealth = Array.from(projectMap.entries()).map(([projectName, tasks]) => {
        const phase = lookupPhase(projectName);
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === "COMPLETE").length;
        const active = tasks.filter(t => openStatuses.has(t.status)).length;
        const hold = tasks.filter(t => t.status === "HOLD").length;
        const overdue = tasks.filter(t => t.status !== "COMPLETE" && t.dueDate && t.dueDate < todayStr).length;
        const dueThisWeek = tasks.filter(t => openStatuses.has(t.status) && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr).length;
        const completion = total > 0 ? Math.round((completed / total) * 100) : 0;

        let rag: "GREEN" | "AMBER" | "RED" = "GREEN";
        if (overdue > 0 || hold > 2) rag = "RED";
        else if (hold > 0 || dueThisWeek > 3) rag = "AMBER";

        return {
          projectName,
          displayName: projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          phase,
          phaseLabel: PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase,
          total, completed, active, hold, overdue, dueThisWeek, completion, rag,
        };
      }).sort((a, b) => {
        const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
        return (ragOrder[a.rag] - ragOrder[b.rag]) || (b.overdue - a.overdue);
      });

      const statusPipeline: Record<string, number> = {};
      for (const t of allTasks) {
        statusPipeline[t.status] = (statusPipeline[t.status] || 0) + 1;
      }

      const mapTask = (t: typeof allTasks[0]) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        assignees: t.assignees,
        trackingRag: t.trackingRag,
        projectName: t.projectName,
        holdReason: t.holdReason,
        blockerReason: t.blockerReason,
        completedAt: t.completedAt,
        taskTypeTag: t.taskTypeTag,
      });

      res.json({
        date: todayStr,
        summary: {
          totalProjects: projectMap.size,
          totalTasks: allTasks.length,
          activeTasks: allTasks.filter(t => openStatuses.has(t.status)).length,
          completedTasks: allTasks.filter(t => t.status === "COMPLETE").length,
          overdueTasks: overdueItems.length,
          holdTasks: holdItems.length,
          recentlyCompletedCount: recentlyCompleted.length,
          upcomingThisWeekCount: upcomingThisWeek.length,
          needsApprovalCount: needsApproval.length,
        },
        recentlyCompleted: recentlyCompleted.slice(0, 20).map(mapTask),
        blockers: {
          hold: holdItems.slice(0, 20).map(mapTask),
          overdue: overdueItems.slice(0, 20).map(mapTask),
        },
        upcomingThisWeek: upcomingThisWeek.slice(0, 30).map(mapTask),
        needsApproval: needsApproval.slice(0, 15).map(mapTask),
        inProgressHighlights: inProgress.slice(0, 15).map(mapTask),
        workload,
        projectHealth,
        statusPipeline,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== ENGINEERING DASHBOARD DATA ==========

  app.get("/api/eng/dashboard/projects", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const [allTasks, allProjectInfoRows] = await Promise.all([
        db.select().from(operationalTasks)
          .orderBy(asc(operationalTasks.projectName), asc(operationalTasks.sortOrder)),
        db.select({ projectName: projectInfo.projectName, phase: projectInfo.phase })
          .from(projectInfo),
      ]);

      const normalizeKey = (n: string) => n.replace(/_Tracker.*$/i, "").replace(/_/g, " ").toLowerCase().trim();

      const phaseByNorm = new Map<string, string>();
      for (const pi of allProjectInfoRows) {
        if (pi.phase) {
          phaseByNorm.set(normalizeKey(pi.projectName), pi.phase);
        }
      }

      function lookupPhase(taskProjectName: string): string {
        const norm = normalizeKey(taskProjectName);
        if (phaseByNorm.has(norm)) return phaseByNorm.get(norm)!;
        const baseName = norm.replace(/\s*(phase\s*\d+|expansion|rev\d+|\+.*$)/gi, "").trim();
        if (baseName && phaseByNorm.has(baseName)) return phaseByNorm.get(baseName)!;
        for (const [key, phase] of phaseByNorm) {
          if (key.startsWith(baseName) || baseName.startsWith(key)) return phase;
        }
        return "P0_FIRST_ASSESSMENT";
      }

      const projectMap = new Map<string, {
        projectName: string;
        phase: string;
        tasks: typeof allTasks;
      }>();

      for (const t of allTasks) {
        const key = t.projectName || "Unassigned";
        if (!projectMap.has(key)) {
          const phase = lookupPhase(key);
          projectMap.set(key, { projectName: key, phase, tasks: [] });
        }
        projectMap.get(key)!.tasks.push(t);
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const openStatuses = new Set(["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK", "PROJECTS ASSISTANCE"]);

      const result = Array.from(projectMap.values()).map(p => {
        const openTasks = p.tasks.filter(t => openStatuses.has(t.status));
        const holdTasks = p.tasks.filter(t => t.status === "HOLD");
        const completedTasks = p.tasks.filter(t => t.status === "COMPLETE");
        const allActive = p.tasks.filter(t => t.status !== "COMPLETE");
        const overdueTasks = allActive.filter(t => t.dueDate && t.dueDate < todayStr);

        return {
          projectName: p.projectName,
          displayName: p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          phase: p.phase,
          phaseLabel: PROJECT_PHASE_LABELS[p.phase as ProjectPhase] || p.phase,
          totalTasks: p.tasks.length,
          activeTasks: allActive.length,
          completedTasks: completedTasks.length,
          overdueTasks: overdueTasks.length,
          holdTasks: holdTasks.length,
          tasks: [...openTasks, ...holdTasks].map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate,
            assignees: t.assignees,
            trackingRag: t.trackingRag,
          })),
        };
      }).sort((a, b) => {
        if (a.overdueTasks !== b.overdueTasks) return b.overdueTasks - a.overdueTasks;
        return b.activeTasks - a.activeTasks;
      });

      res.json({
        projects: result,
        lifecyclePhases: PROJECT_PHASES,
        phaseLabels: PROJECT_PHASE_LABELS,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/dashboard/workload", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      const allTasks = await db.select().from(operationalTasks)
        .where(ne(operationalTasks.status, "COMPLETE"));

      const today = new Date().toISOString().split('T')[0];
      const endOfWeek = new Date();
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      const weekEnd = endOfWeek.toISOString().split('T')[0];

      const assigneeSet = new Set<string>();
      for (const t of allTasks) {
        if (t.assignees && Array.isArray(t.assignees)) {
          for (const a of t.assignees) if (a) assigneeSet.add(a);
        }
      }

      const workload: any[] = [];
      if (assigneeSet.size > 0) {
        for (const name of assigneeSet) {
          const userTasks = allTasks.filter(t => t.assignees && t.assignees.includes(name));
          workload.push({
            name,
            activeTasks: userTasks.length,
            dueThisWeek: userTasks.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).length,
            overdue: userTasks.filter(t => t.dueDate && t.dueDate < today).length,
            onHold: userTasks.filter(t => t.status === "HOLD").length,
            needsApproval: userTasks.filter(t => t.status === "NEEDS APPROVAL").length,
            provideFeedback: userTasks.filter(t => t.status === "PROVIDE FEEDBACK").length,
          });
        }
      } else {
        const userWorkload = allUsers.map(u => {
          const userTasks = allTasks.filter(t => t.ownerUserId === u.id);
          return {
            name: u.name,
            activeTasks: userTasks.length,
            dueThisWeek: userTasks.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).length,
            overdue: userTasks.filter(t => t.dueDate && t.dueDate < today).length,
            onHold: userTasks.filter(t => t.status === "HOLD").length,
            needsApproval: userTasks.filter(t => t.status === "NEEDS APPROVAL").length,
            provideFeedback: userTasks.filter(t => t.status === "PROVIDE FEEDBACK").length,
          };
        }).filter(w => w.activeTasks > 0);
        workload.push(...userWorkload);
      }
      workload.sort((a, b) => b.activeTasks - a.activeTasks);

      res.json(workload);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/dashboard/milestones-at-risk", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const twoWeeks = new Date();
      twoWeeks.setDate(twoWeeks.getDate() + 14);
      const twoWeeksStr = twoWeeks.toISOString().split('T')[0];

      const atRiskTasks = await db.select().from(operationalTasks)
        .where(and(
          ne(operationalTasks.status, "COMPLETE"),
          sql`(${operationalTasks.dueDate} IS NOT NULL AND ${operationalTasks.dueDate} <= ${twoWeeksStr})`
        ))
        .orderBy(asc(operationalTasks.dueDate));

      const grouped = new Map<string, typeof atRiskTasks>();
      for (const t of atRiskTasks) {
        const key = t.projectName || "Unassigned";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(t);
      }

      const result = Array.from(grouped.entries()).map(([projectName, tasks]) => {
        const overdue = tasks.filter(t => t.dueDate && t.dueDate < todayStr);
        const onHold = tasks.filter(t => t.status === "HOLD");
        return {
          id: projectName,
          projectName: projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          milestoneName: `${tasks.length} task${tasks.length !== 1 ? "s" : ""} due within 14 days`,
          dueDate: tasks[0]?.dueDate || null,
          linkedTasks: tasks.length,
          incompleteTasks: tasks.length,
          highWarnings: overdue.length + onHold.length,
          deliverableStatuses: tasks.slice(0, 4).map(t => ({
            name: t.title.substring(0, 40),
            status: t.status,
          })),
        };
      }).sort((a, b) => b.highWarnings - a.highWarnings);

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/dashboard/deliverables-pipeline", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const taskStatuses = [
        "TO DO", "IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL",
        "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "COMPLETE"
      ];
      const pipeline: Record<string, number> = {};
      for (const s of taskStatuses) {
        const [result] = await db.select({ count: sql<number>`count(*)::int` })
          .from(operationalTasks)
          .where(eq(operationalTasks.status, s));
        pipeline[s] = result?.count || 0;
      }
      res.json(pipeline);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/dashboard/orphan-tasks", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const orphans = await db.select().from(operationalTasks)
        .where(and(
          isNull(operationalTasks.linkedPlanItemId),
          isNull(operationalTasks.linkedDeliverableId),
          isNull(operationalTasks.linkedQualityItemInstanceId),
          ne(operationalTasks.status, "COMPLETE")
        ))
        .orderBy(desc(operationalTasks.createdAt));
      res.json(orphans);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/dashboard/warning-tower", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const highWarnings = await db.select().from(qcWarning)
        .where(and(
          eq(qcWarning.status, "open"),
          eq(qcWarning.severity, "HIGH" as any)
        ))
        .orderBy(asc(qcWarning.createdAt));
      res.json(highWarnings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== USERS LIST (for assignment dropdowns) ==========

  app.get("/api/eng/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id, name: users.name, email: users.email, role: users.role,
      }).from(users).orderBy(asc(users.name));
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== ADMIN AUDIT LOG (global activity across all tasks) ==========

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const role = getUserRole(req);
    if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
  }

  app.get("/api/eng/unified-audit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { category, search, limit: qLimit, offset: qOffset } = req.query;
      const pageLimit = Math.min(parseInt(qLimit as string) || 100, 500);
      const pageOffset = parseInt(qOffset as string) || 0;
      const searchTerm = (search as string || "").trim().toLowerCase();

      const catFilter = (!category || category === "all") ? null : (category as string);
      const searchFilter = searchTerm ? `%${searchTerm}%` : null;

      const unionParts: string[] = [];
      const unionParams: any[] = [];

      if (!catFilter || catFilter === "task_changes") {
        unionParts.push(`
          SELECT
            'task_' || tal.id::text AS id,
            'task_changes' AS category,
            tal.action_type AS action_type,
            CASE
              WHEN tal.action_type = 'field_changed' AND tal.field_name IS NOT NULL
                THEN 'Changed ' || tal.field_name
              WHEN tal.action_type = 'created' THEN 'Task created'
              ELSE 'Task ' || replace(tal.action_type, '_', ' ')
            END AS summary,
            CASE
              WHEN tal.action_type = 'field_changed'
                THEN coalesce(tal.old_value, '—') || ' → ' || coalesce(tal.new_value, '—')
              WHEN tal.action_type = 'created'
                THEN coalesce(tal.new_value, ot.title)
              ELSE ot.title
            END AS detail,
            u.name AS actor_name,
            replace(ot.project_name, '_', ' ') AS project_name,
            tal.created_at AS timestamp
          FROM task_activity_log tal
          LEFT JOIN users u ON tal.actor_id = u.id
          LEFT JOIN operational_tasks ot ON tal.task_id = ot.id
        `);
      }

      if (!catFilter || catFilter === "phase_changes") {
        unionParts.push(`
          SELECT
            'phase_' || pph.id::text AS id,
            'phase_changes' AS category,
            'phase_changed' AS action_type,
            'Phase: ' || coalesce(pph.from_phase, 'None') || ' → ' || pph.to_phase AS summary,
            pph.reason AS detail,
            u.name AS actor_name,
            replace(replace(pi.project_name, '_Tracker', ''), '_', ' ') AS project_name,
            pph.changed_at AS timestamp
          FROM project_phase_history pph
          LEFT JOIN users u ON pph.changed_by_user_id = u.id
          LEFT JOIN project_info pi ON pph.project_id = pi.id
        `);
      }

      if (!catFilter || catFilter === "data_imports") {
        unionParts.push(`
          SELECT
            'upload_' || um.id::text AS id,
            'data_imports' AS category,
            CASE WHEN um.status = 'success' THEN 'import_success' ELSE 'import_failed' END AS action_type,
            'Data import: ' || um.file_name AS summary,
            um.records_processed::text || ' records processed' ||
              CASE WHEN um.validation_errors IS NOT NULL THEN ' — ' || um.validation_errors ELSE '' END AS detail,
            u.name AS actor_name,
            NULL AS project_name,
            um.uploaded_at AS timestamp
          FROM upload_metadata um
          LEFT JOIN users u ON um.uploaded_by = u.id
        `);
        unionParts.push(`
          SELECT
            'refresh_' || rl.id::text AS id,
            'data_imports' AS category,
            'data_refresh' AS action_type,
            'Data refresh triggered' AS summary,
            'Status: ' || rl.status AS detail,
            u.name AS actor_name,
            NULL AS project_name,
            rl.refreshed_at AS timestamp
          FROM refresh_logs rl
          LEFT JOIN users u ON rl.triggered_by = u.id
        `);
      }

      if (!catFilter || catFilter === "writebacks") {
        unionParts.push(`
          SELECT
            'wb_' || wal.id::text AS id,
            'writebacks' AS category,
            CASE
              WHEN wal.status = 'applied' THEN 'writeback_applied'
              WHEN wal.status = 'rolled_back' THEN 'writeback_rolled_back'
              ELSE 'writeback_error'
            END AS action_type,
            'Writeback: ' || wal.sheet_name || '!' || wal.cell_address AS summary,
            coalesce(wal.previous_value, '—') || ' → ' || wal.new_value ||
              CASE WHEN wal.error_message IS NOT NULL THEN ' (Error: ' || wal.error_message || ')' ELSE '' END AS detail,
            u.name AS actor_name,
            wal.project_id AS project_name,
            wal.applied_at AS timestamp
          FROM writeback_audit_log wal
          LEFT JOIN users u ON wal.actor_id = u.id
        `);
      }

      if (!catFilter || catFilter === "template_applications") {
        unionParts.push(`
          SELECT
            'tpl_' || pta.id::text AS id,
            'template_applications' AS category,
            'template_applied' AS action_type,
            'Template applied: ' || coalesce(pt.name, 'Unknown') || ' v' || pta.template_version::text AS summary,
            'Phase: ' || pta.phase AS detail,
            u.name AS actor_name,
            replace(replace(pi.project_name, '_Tracker', ''), '_', ' ') AS project_name,
            pta.applied_at AS timestamp
          FROM phase_template_application pta
          LEFT JOIN users u ON pta.applied_by_user_id = u.id
          LEFT JOIN project_info pi ON pta.project_id = pi.id
          LEFT JOIN phase_template pt ON pta.template_id = pt.id
        `);
      }

      if (unionParts.length === 0) {
        return res.json({ entries: [], total: 0, categoryCounts: {} });
      }

      const unionQuery = unionParts.join(" UNION ALL ");

      let whereClause = "";
      if (searchFilter) {
        whereClause = ` WHERE lower(summary) LIKE $1 OR lower(detail) LIKE $1 OR lower(actor_name) LIKE $1 OR lower(project_name) LIKE $1`;
        unionParams.push(searchFilter);
      }

      const countQuery = `SELECT category, count(*)::int AS cnt FROM (${unionQuery}) unified ${whereClause} GROUP BY category`;
      const countResult = await db.execute(sql.raw(
        searchFilter
          ? countQuery.replace(/\$1/g, `'${searchFilter.replace(/'/g, "''")}'`)
          : countQuery
      ));

      const categoryCounts: Record<string, number> = {};
      let total = 0;
      for (const row of countResult.rows as any[]) {
        categoryCounts[row.category] = row.cnt;
        total += row.cnt;
      }

      const dataQuery = `SELECT * FROM (${unionQuery}) unified ${whereClause} ORDER BY timestamp DESC NULLS LAST LIMIT ${pageLimit} OFFSET ${pageOffset}`;
      const dataResult = await db.execute(sql.raw(
        searchFilter
          ? dataQuery.replace(/\$1/g, `'${searchFilter.replace(/'/g, "''")}'`)
          : dataQuery
      ));

      const entries = (dataResult.rows as any[]).map((r: any) => ({
        id: r.id,
        category: r.category,
        actionType: r.action_type,
        summary: r.summary,
        detail: r.detail,
        actorName: r.actor_name,
        projectName: r.project_name,
        timestamp: r.timestamp,
      }));

      res.json({ entries, total, categoryCounts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/audit-log", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, actorId, actionType, dateFrom, dateTo, limit: qLimit, offset: qOffset } = req.query;
      const pageLimit = Math.min(parseInt(qLimit as string) || 100, 500);
      const pageOffset = parseInt(qOffset as string) || 0;

      const conditions: any[] = [];
      if (projectName) {
        conditions.push(eq(operationalTasks.projectName, projectName as string));
      }
      if (actorId) {
        conditions.push(eq(taskActivityLog.actorId, parseInt(actorId as string)));
      }
      if (actionType) {
        conditions.push(eq(taskActivityLog.actionType, actionType as string));
      }
      if (dateFrom) {
        conditions.push(gt(taskActivityLog.createdAt, new Date(dateFrom as string)));
      }
      if (dateTo) {
        conditions.push(lt(taskActivityLog.createdAt, new Date(dateTo as string)));
      }

      const baseQuery = db.select({
        id: taskActivityLog.id,
        taskId: taskActivityLog.taskId,
        actionType: taskActivityLog.actionType,
        fieldName: taskActivityLog.fieldName,
        oldValue: taskActivityLog.oldValue,
        newValue: taskActivityLog.newValue,
        createdAt: taskActivityLog.createdAt,
        actorName: users.name,
        actorEmail: users.email,
        taskTitle: operationalTasks.title,
        projectName: operationalTasks.projectName,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .leftJoin(operationalTasks, eq(taskActivityLog.taskId, operationalTasks.id));

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .leftJoin(operationalTasks, eq(taskActivityLog.taskId, operationalTasks.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const rows = await baseQuery
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(taskActivityLog.createdAt))
        .limit(pageLimit)
        .offset(pageOffset);

      const allActions = await db.selectDistinct({ actionType: taskActivityLog.actionType })
        .from(taskActivityLog);
      const allProjects = await db.selectDistinct({ projectName: operationalTasks.projectName })
        .from(taskActivityLog)
        .leftJoin(operationalTasks, eq(taskActivityLog.taskId, operationalTasks.id))
        .where(sql`${operationalTasks.projectName} IS NOT NULL`);
      const allActors = await db.select({ id: users.id, name: users.name })
        .from(users)
        .orderBy(asc(users.name));

      res.json({
        entries: rows,
        total: Number(countResult[0]?.count || 0),
        limit: pageLimit,
        offset: pageOffset,
        filters: {
          actionTypes: allActions.map(a => a.actionType),
          projectNames: allProjects.map(p => p.projectName).filter(Boolean),
          actors: allActors,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/audit-log/stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const totalResult = await db.select({ count: sql<number>`count(*)` }).from(taskActivityLog);
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .where(gt(taskActivityLog.createdAt, todayStart));

      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
      const weekResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .where(gt(taskActivityLog.createdAt, weekStart));

      const byAction = await db.select({
        actionType: taskActivityLog.actionType,
        count: sql<number>`count(*)`,
      }).from(taskActivityLog).groupBy(taskActivityLog.actionType);

      const topActors = await db.select({
        actorId: taskActivityLog.actorId,
        actorName: users.name,
        count: sql<number>`count(*)`,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .groupBy(taskActivityLog.actorId, users.name)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

      res.json({
        total: Number(totalResult[0]?.count || 0),
        today: Number(todayResult[0]?.count || 0),
        thisWeek: Number(weekResult[0]?.count || 0),
        byAction,
        topActors,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/eng/audit-log/phase-history", requireAuth, requireAdmin, async (req, res) => {
    try {
      const history = await db.select({
        id: projectPhaseHistory.id,
        projectId: projectPhaseHistory.projectId,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        reason: projectPhaseHistory.reason,
        changedAt: projectPhaseHistory.changedAt,
        changedByName: users.name,
        projectName: projectInfo.projectName,
      })
      .from(projectPhaseHistory)
      .leftJoin(users, eq(projectPhaseHistory.changedByUserId, users.id))
      .leftJoin(projectInfo, eq(projectPhaseHistory.projectId, projectInfo.id))
      .orderBy(desc(projectPhaseHistory.changedAt));
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PROJECT PHASE MANAGEMENT ==========

  app.patch("/api/projects/:projectId/phase", jwtAuth, requireAuth, async (req, res) => {
    try {
      const user = getUser(req);
      if (user.role !== "admin") {
        return res.status(403).json({ error: "forbidden", message: "Only admins can change project phases" });
      }

      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const { toPhase, reason, overrideSequence } = req.body;
      if (!toPhase || !reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "toPhase and reason are required" });
      }
      if (!PROJECT_PHASES.includes(toPhase as any)) {
        return res.status(400).json({ error: "Invalid phase value", validPhases: PROJECT_PHASES });
      }

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const fromPhase = project.phase;

      if (fromPhase === toPhase) {
        return res.status(400).json({ error: "Project is already in this phase" });
      }

      const fromIdx = PROJECT_PHASES.indexOf(fromPhase as any);
      const toIdx = PROJECT_PHASES.indexOf(toPhase as any);
      if (fromIdx >= 0 && toIdx >= 0 && Math.abs(toIdx - fromIdx) > 1 && !overrideSequence) {
        return res.status(400).json({
          error: "sequential_required",
          message: `Phase can only move one step at a time (${PROJECT_PHASE_LABELS[fromPhase as ProjectPhase] || fromPhase} → next). Set overrideSequence=true to skip.`,
        });
      }

      let tasksCreated = 0;
      let templateApplied = false;
      let templateResult: any = null;

      await db.transaction(async (tx) => {
        await tx.update(projectInfo)
          .set({
            phase: toPhase,
            phaseUpdatedAt: new Date(),
            phaseUpdatedByUserId: user.id,
            phaseNotes: reason.trim(),
            updatedAt: new Date(),
          })
          .where(eq(projectInfo.id, projectId));

        await tx.insert(projectPhaseHistory).values({
          projectId,
          fromPhase: fromPhase || null,
          toPhase,
          changedByUserId: user.id,
          reason: reason.trim(),
        });
      });

      try {
        const [activeTemplate] = await db.select().from(phaseTemplateTbl)
          .where(and(eq(phaseTemplateTbl.phase, toPhase), eq(phaseTemplateTbl.isActive, true)));

        if (activeTemplate) {
          templateResult = await applyTemplate(projectId, toPhase, activeTemplate.id, activeTemplate.version, user.id);
          templateApplied = true;
          tasksCreated = templateResult.tasksCreated || 0;
        }
      } catch (err: any) {
        console.warn("[Phase] Template apply error (non-fatal):", err.message);
      }

      if (!templateApplied) {
        const fromP1OrBefore = !fromPhase || PROJECT_PHASES.indexOf(fromPhase as any) <= 1;
        const toP2OrBeyond = PROJECT_PHASES.indexOf(toPhase as any) >= 2;

        if (fromP1OrBefore && toP2OrBeyond) {
          const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
          const existing = await db.select({ id: operationalTasks.id })
            .from(operationalTasks)
            .where(eq(operationalTasks.projectName, cleanName))
            .limit(1);

          if (existing.length === 0) {
            const DEFAULT_ENG_TASKS = [
              { title: "PD/PM Handover", workstream: "PD", priority: "High", phase: "P2_PD_PM_HANDOVER" },
              { title: "Detailed Design Package", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
              { title: "Structural Design Review", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
              { title: "Electrical Design Review", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
              { title: "Equipment Procurement Release", workstream: "Procurement", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
              { title: "BOM Finalisation", workstream: "Procurement", priority: "Med", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
              { title: "Construction Method Statement", workstream: "Construction", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
              { title: "H&S File Preparation", workstream: "Quality", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
              { title: "Site Mobilisation Checklist", workstream: "Construction", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
              { title: "Installation & Construction", workstream: "Construction", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
              { title: "QC Inspections", workstream: "Quality", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
              { title: "Commissioning & Testing", workstream: "Commissioning", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
              { title: "Performance Verification", workstream: "Commissioning", priority: "Med", phase: "P5_COMMISSIONING_TESTING" },
              { title: "Client Handover Documentation", workstream: "Handover", priority: "High", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
              { title: "O&M Handover", workstream: "Handover", priority: "Med", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
              { title: "Close-out Report", workstream: "PM", priority: "Med", phase: "P7_CLOSEOUT_POSTMORTEM" },
            ];

            for (let i = 0; i < DEFAULT_ENG_TASKS.length; i++) {
              const t = DEFAULT_ENG_TASKS[i];
              await db.insert(operationalTasks).values({
                projectName: cleanName,
                title: t.title,
                status: "TO DO",
                priority: t.priority,
                phase: t.phase,
                primaryWorkstream: t.workstream,
                createdBy: user.id,
                sortOrder: (i + 1) * 10,
              });
            }
            tasksCreated = DEFAULT_ENG_TASKS.length;

            await db.insert(taskActivityLog).values({
              taskId: 0,
              actorId: user.id,
              actionType: "auto_generated",
              newValue: `${tasksCreated} engineering tasks auto-created for ${cleanName} on phase transition to ${PROJECT_PHASE_LABELS[toPhase as ProjectPhase]}`,
            });
          }
        }
      }

      let engStagesResult: any = null;
      const stageNames = PHASE_TO_ENG_STAGES[toPhase];
      if (stageNames && stageNames.length > 0) {
        try {
          engStagesResult = await generateEngStagesForProject(projectId, user.id, stageNames);
          if (engStagesResult.stagesCreated > 0) {
            console.log(`[Phase] Auto-generated ${engStagesResult.stagesCreated} eng stages for project ${projectId}: ${engStagesResult.stageDetails.join(", ")}`);
          }
        } catch (err: any) {
          console.warn("[Phase] Eng stage auto-generation error (non-fatal):", err.message);
        }
      }

      const [updated] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      res.json({
        project: updated,
        phaseLabel: PROJECT_PHASE_LABELS[toPhase as ProjectPhase] || toPhase,
        tasksCreated,
        templateApplied,
        templateResult,
        engStagesResult,
      });
    } catch (err: any) {
      console.error("[Phase] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/projects/:projectId/phase-history", jwtAuth, requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const history = await db.select({
        id: projectPhaseHistory.id,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        changedAt: projectPhaseHistory.changedAt,
        reason: projectPhaseHistory.reason,
        changedByUserId: projectPhaseHistory.changedByUserId,
        changedByName: users.name,
      })
        .from(projectPhaseHistory)
        .leftJoin(users, eq(projectPhaseHistory.changedByUserId, users.id))
        .where(eq(projectPhaseHistory.projectId, projectId))
        .orderBy(desc(projectPhaseHistory.changedAt));

      res.json({ history, phaseLabels: PROJECT_PHASE_LABELS });
    } catch (err: any) {
      console.error("[Phase] History error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PROJECT ENGINEERING TASKS (for project detail page) ==========

  app.get("/api/projects/:projectId/eng-tasks", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

      const tasks = await db.select().from(operationalTasks)
        .where(eq(operationalTasks.projectName, cleanName))
        .orderBy(asc(operationalTasks.sortOrder), asc(operationalTasks.id));

      res.json({
        projectName: cleanName,
        phase: project.phase,
        tasks,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:projectId/generate-eng-tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

      const existing = await db.select({ id: operationalTasks.id })
        .from(operationalTasks)
        .where(eq(operationalTasks.projectName, cleanName))
        .limit(1);

      if (existing.length > 0) {
        return res.status(400).json({ error: "Engineering tasks already exist for this project" });
      }

      const DEFAULT_ENG_TASKS = [
        { title: "PD/PM Handover", workstream: "PD", priority: "High", phase: "P2_PD_PM_HANDOVER" },
        { title: "Detailed Design Package", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
        { title: "Structural Design Review", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
        { title: "Electrical Design Review", workstream: "Engineering", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
        { title: "Equipment Procurement Release", workstream: "Procurement", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
        { title: "BOM Finalisation", workstream: "Procurement", priority: "Med", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
        { title: "Construction Method Statement", workstream: "Construction", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
        { title: "H&S File Preparation", workstream: "Quality", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
        { title: "Site Mobilisation Checklist", workstream: "Construction", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
        { title: "Installation & Construction", workstream: "Construction", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
        { title: "QC Inspections", workstream: "Quality", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
        { title: "Commissioning & Testing", workstream: "Commissioning", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
        { title: "Performance Verification", workstream: "Commissioning", priority: "Med", phase: "P5_COMMISSIONING_TESTING" },
        { title: "Client Handover Documentation", workstream: "Handover", priority: "High", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
        { title: "O&M Handover", workstream: "Handover", priority: "Med", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
        { title: "Close-out Report", workstream: "PM", priority: "Med", phase: "P7_CLOSEOUT_POSTMORTEM" },
      ];

      const created = [];
      for (let i = 0; i < DEFAULT_ENG_TASKS.length; i++) {
        const t = DEFAULT_ENG_TASKS[i];
        const [task] = await db.insert(operationalTasks).values({
          projectName: cleanName,
          title: t.title,
          status: "TO DO",
          priority: t.priority,
          phase: t.phase,
          primaryWorkstream: t.workstream,
          createdBy: user.id,
          sortOrder: (i + 1) * 10,
        }).returning();
        created.push(task);

        await db.insert(taskActivityLog).values({
          taskId: task.id,
          actorId: user.id,
          actionType: "created",
          newValue: `${t.title} (auto-generated)`,
        });
      }

      res.json({ tasksCreated: created.length, tasks: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== CONSTANTS ==========

  app.get("/api/eng/constants", (req, res) => {
    res.json({
      taskStatuses: TASK_STATUSES,
      taskWorkstreams: TASK_WORKSTREAMS,
      taskPriorities: TASK_PRIORITIES,
      projectPhases: PROJECT_PHASES,
      projectPhaseLabels: PROJECT_PHASE_LABELS,
      deliverableStatuses: DELIVERABLE_STATUSES,
    });
  });
}
