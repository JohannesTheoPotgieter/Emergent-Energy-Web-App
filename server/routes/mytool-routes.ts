/**
 * MyTool Routes — Extracted from server/routes.ts (Phase 1)
 *
 * 36 handlers covering:
 *   GET    /api/mytool/settings
 *   PUT    /api/mytool/settings
 *   GET    /api/calendar/my-tasks
 *   PATCH  /api/calendar/schedule-task
 *   GET    /api/mytool/tasks
 *   POST   /api/mytool/tasks
 *   PATCH  /api/mytool/tasks/:id
 *   DELETE /api/mytool/tasks/:id
 *   GET    /api/mytool/tasks/:id/dependencies
 *   POST   /api/mytool/tasks/:id/dependencies
 *   DELETE /api/mytool/tasks/:id/dependencies/:dependencyId
 *   GET    /api/mytool/recurrence-templates
 *   POST   /api/mytool/recurrence-templates
 *   GET    /api/mytool/timeblocks
 *   POST   /api/mytool/timeblocks
 *   PATCH  /api/mytool/timeblocks/:id
 *   DELETE /api/mytool/timeblocks/:id
 *   GET    /api/mytool/daily-review
 *   PUT    /api/mytool/daily-review
 *   GET    /api/mytool/escalated-priorities
 *   GET    /api/mytool/preferences
 *   PUT    /api/mytool/preferences
 *   GET    /api/mytool/email-links
 *   POST   /api/mytool/email-links
 *   DELETE /api/mytool/email-links/:id
 *   GET    /api/mytool/dod-templates
 *   POST   /api/mytool/dod-templates
 *   DELETE /api/mytool/dod-templates/:id
 *   POST   /api/mytool/support-ticket
 *   GET    /api/mytool/support-tickets
 *   GET    /api/mytool/triage-rules
 *   POST   /api/mytool/triage-rules
 *   PATCH  /api/mytool/triage-rules/:id
 *   DELETE /api/mytool/triage-rules/:id
 *   GET    /api/mytool/triage-inbox
 *   GET    /api/mytool/unclassified-tasks
 */

import type { Express, Request } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, or, sql, isNull, desc, inArray } from "drizzle-orm";
import {
  workItems, workItemAssignments, workItemDependencies,
  users, entityAssignments, mytoolRecurrenceTemplates,
  qcItemInstance, trItems, deliverables, projectEngApprovals, approvals,
} from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";
import { validateTaskCreate, validateTaskUpdate } from "../lib/task-validation";
import { normalizeStatus, normalizePriority } from "../lib/canonical-task-engine";
import { sendError, badRequest, validationError } from "../lib/api-error";
import { paramStr } from "../lib/req-params";
import { computeNextRecurrenceDate, isOverdue, shouldBlockTask, validateDependencyPair } from "../lib/mytool-work-engine";
import { mytoolTaskIdempotencyStore } from "../lib/mytool-task-idempotency";

// ── MyTool status/priority maps (moved from routes.ts) ──

const CANONICAL_TO_MYTOOL_STATUS: Record<string, string> = {
  todo: "planned",
  in_progress: "in_progress",
  blocked: "blocked",
  review: "waiting",
  complete: "done",
  cancelled: "cancelled",
};
function toMytoolDbStatus(canonical: string): string {
  return CANONICAL_TO_MYTOOL_STATUS[canonical] || CANONICAL_TO_MYTOOL_STATUS[canonical.toLowerCase()] || "planned";
}
const CANONICAL_TO_MYTOOL_PRIORITY: Record<string, string> = {
  P1: "critical", p1: "critical", urgent: "critical", critical: "critical",
  P2: "high", p2: "high", high: "high",
  P3: "normal", p3: "normal", medium: "normal", normal: "normal",
  P4: "low", p4: "low", low: "low",
};
function toMytoolDbPriority(priority: string): string {
  return CANONICAL_TO_MYTOOL_PRIORITY[priority] || CANONICAL_TO_MYTOOL_PRIORITY[priority.toLowerCase()] || "normal";
}

// ── enrichMytoolTasks (moved from routes.ts) ──

async function enrichMytoolTasks(userId: number, tasks: any[]) {
  if (!tasks.length) return tasks;
  const ids = tasks.map((t) => t.id);
  const deps = await db.select().from(workItemDependencies).where(
    and(
      or(inArray(workItemDependencies.predecessorId, ids), inArray(workItemDependencies.successorId, ids)),
      isNull(workItemDependencies.deletedAt),
    )
  );
  const taskById = new Map<number, any>(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    const blockedBy = deps.filter((d: any) => d.successorId === task.id).map((d: any) => {
      const predecessor = taskById.get(d.predecessorId);
      return { ...d, predecessorTaskId: d.predecessorId, successorTaskId: d.successorId, predecessorStatus: predecessor?.status ?? null, predecessorTitle: predecessor?.title ?? null };
    });
    const blocking = deps.filter((d: any) => d.predecessorId === task.id).map((d: any) => {
      const successor = taskById.get(d.successorId);
      return { ...d, predecessorTaskId: d.predecessorId, successorTaskId: d.successorId, successorStatus: successor?.status ?? null, successorTitle: successor?.title ?? null };
    });

    const blockersIncomplete = blockedBy.filter((d: any) => shouldBlockTask([d.predecessorStatus]));
    task.blockedBy = blockedBy;
    task.blocking = blocking;
    task.blockedByCount = blockersIncomplete.length;
    task.isBlockedByDependencies = blockersIncomplete.length > 0;
    task.isOverdue = isOverdue(task.dueAt, task.status);
  }

  const milestoneIds = tasks.filter((t) => t.taskType === "milestone").map((t) => t.id);
  for (const mId of milestoneIds) {
    const milestone = taskById.get(mId);
    if (milestone) {
      milestone.milestoneTaskCount = 0;
      milestone.milestoneProgress = 0;
    }
  }

  return tasks;
}

async function refreshDependentTaskStates(_taskId: number) {
}

// ── computeNextDueDate (moved from routes.ts) ──

function computeNextDueDate(currentDue: Date, frequency: string, interval: number): Date {
  const d = new Date(currentDue);
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      break;
  }
  return d;
}

// ── Dependency type maps ──

const DEP_TYPE_TO_CANONICAL: Record<string, string> = { finish_to_start: "FS", start_to_start: "SS", finish_to_finish: "FF", start_to_finish: "SF" };
const DEP_TYPE_FROM_CANONICAL: Record<string, string> = { FS: "finish_to_start", SS: "start_to_start", FF: "finish_to_finish", SF: "start_to_finish" };

// ── Main registration function ──

export function registerMytoolRoutes(app: Express): void {

  const MYTOOL_OVERSIGHT_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];

  function resolveMyToolUserId(req: Request): number {
    const authUserId = (req.user as any).id;
    const role = (req.user as any).role;
    const requestedUserId = req.query.userId ? parseInt(req.query.userId as string) : null;
    if (requestedUserId && !isNaN(requestedUserId) && MYTOOL_OVERSIGHT_ROLES.includes(role)) {
      return requestedUserId;
    }
    return authUserId;
  }

  function isMyToolOversightRole(req: Request): boolean {
    return MYTOOL_OVERSIGHT_ROLES.includes((req.user as any).role);
  }

  // ==================== MY TOOL - SETTINGS ====================

  app.get("/api/mytool/settings", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getMytoolSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/settings", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateMytoolSettings(req.body);
      logAuditFromReq(req, { entityType: "mytool_settings", action: "update", changesJson: { description: "MyTool settings updated" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== CALENDAR - COMBINED TASKS ====================

  app.get("/api/calendar/my-tasks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userName = (req.user as any).username;
      const displayName = (req.user as any).name || userName;

      const [myToolTasksResult, opTasksForUser, planTasksForUser, engTasksForUser, qcItemsForUser] = await Promise.all([
        // Canonical: personal tasks now read from work_items (workstream=PERSONAL)
        db.select().from(workItems).where(
          and(
            eq(workItems.workstream, "PERSONAL"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt),
          )
        ),
        // Operational tasks: exclude PERSONAL (fetched above), ENG (fetched below), and PM (fetched separately)
        db.select().from(workItems).where(
          and(
            isNull(workItems.deletedAt),
            sql`${workItems.workstream} NOT IN ('PERSONAL', 'ENG', 'PM')`,
            or(
              eq(workItems.ownerUserId, userId),
              sql`EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = ${workItems.id} AND wia.user_id = ${userId})`
            )
          )
        ),
        db.execute(sql`
          SELECT wi.id, wi.title as task_name, wi.wbs_code as task_no, wi.start_date, wi.end_date,
                 wi.percent_complete as pct_complete, wi.duration as duration_days,
                 wi.owner_user_id as assignee_user_id, wi.status, wi.type as phase,
                 wi.scheduled_date, wi.scheduled_start_time, wi.scheduled_end_time,
                 pi.project_name
          FROM work_items wi
          LEFT JOIN project_info pi ON wi.project_id = pi.id
          WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL
            AND (wi.owner_user_id = ${userId}
              OR EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = ${userId}))
        `),
        // Read ENG work_items
        db.select().from(workItems).where(
          and(
            eq(workItems.workstream, "ENG"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt)
          )
        ),
        db.execute(sql`
          SELECT qi.*, qc.project_name, qc.project_id, qti.item_name
          FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN qc_template_item qti ON qi.template_item_id = qti.id
          WHERE qi.assignee_user_id = ${userId}
            AND qi.is_applicable = true
        `),
      ]);

      const seenOpIds = new Set<number>();
      const allOpTasks: typeof opTasksForUser = [];
      for (const t of opTasksForUser) {
        if (!seenOpIds.has(t.id)) {
          seenOpIds.add(t.id);
          allOpTasks.push(t);
        }
      }

      const combined = [
        ...myToolTasksResult.map((t: any) => ({
          id: t.id,
          taskType: "mytool" as const,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectName: t.subProjectName || null,
          plannedForDate: t.scheduledDate,
          dueDate: t.endDate || null,
          startDate: t.startDate,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
        })),
        ...allOpTasks.map((t: any) => ({
          id: t.id,
          taskType: "operational" as const,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectName: t.projectName || null,
          plannedForDate: null,
          dueDate: t.endDate || t.dueDate || null,
          startDate: t.startDate,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
        })),
        ...(planTasksForUser as any[]).map((t: any) => ({
          id: t.id,
          taskType: "plan" as const,
          title: t.task_name,
          status: t.status || "active",
          priority: "Medium",
          projectName: t.project_name,
          plannedForDate: t.start_date,
          dueDate: t.end_date,
          startDate: t.start_date,
          scheduledDate: t.scheduled_date,
          scheduledStartTime: t.scheduled_start_time,
          scheduledEndTime: t.scheduled_end_time,
          pctComplete: t.pct_complete,
          phase: t.phase,
          owner: t.owner,
        })),
        ...engTasksForUser.map((t: any) => ({
          id: t.id,
          taskType: "engineering" as const,
          title: t.title,
          status: t.status,
          priority: "Medium",
          projectName: t.projectName,
          plannedForDate: null,
          dueDate: null,
          startDate: null,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
          lifecyclePhase: t.lifecyclePhaseTag,
        })),
        ...(qcItemsForUser as any[]).map((t: any) => ({
          id: t.id,
          taskType: "quality" as const,
          title: t.item_name,
          status: t.qm_status || "not_started",
          priority: "Medium",
          projectName: t.project_name,
          plannedForDate: t.start_date,
          dueDate: t.end_date,
          startDate: t.start_date,
          scheduledDate: t.scheduled_date,
          scheduledStartTime: t.scheduled_start_time,
          scheduledEndTime: t.scheduled_end_time,
        })),
      ];

      res.json(combined);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/calendar/schedule-task", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userName = (req.user as any).username;
      const { taskType, taskId, scheduledDate, scheduledStartTime, scheduledEndTime, approvalSubType } = req.body;
      if (!taskType || !taskId) {
        return res.status(400).json({ error: "taskType and taskId required" });
      }

      const timeRegex = /^\d{2}:\d{2}$/;
      if (scheduledStartTime && !timeRegex.test(scheduledStartTime)) {
        return res.status(400).json({ error: "scheduledStartTime must be HH:mm format" });
      }
      if (scheduledEndTime && !timeRegex.test(scheduledEndTime)) {
        return res.status(400).json({ error: "scheduledEndTime must be HH:mm format" });
      }
      if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return res.status(400).json({ error: "scheduledDate must be YYYY-MM-DD format" });
      }

      if (taskType === "mytool") {
        // Canonical: personal tasks now live in work_items (workstream=PERSONAL)
        const [task] = await db.select().from(workItems).where(
          and(
            eq(workItems.id, taskId),
            eq(workItems.workstream, "PERSONAL"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt),
          )
        );
        if (!task) return res.status(404).json({ error: "Task not found or not owned by you" });

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "operational") {
        const [task] = await db.select().from(workItems).where(and(eq(workItems.id, taskId), isNull(workItems.deletedAt)));
        if (!task) return res.status(404).json({ error: "Task not found" });

        const isOwner = task.ownerUserId === userId;
        // Check work_item_assignments for assignee relationship
        const assignmentCheck = await db.select().from(workItemAssignments).where(
          and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.userId, userId))
        );
        const isAssigned = assignmentCheck.length > 0;
        if (!isOwner && !isAssigned) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "plan") {
        const taskResult = await db.select().from(workItems).where(eq(workItems.id, taskId));
        const [task] = taskResult;
        if (!task) return res.status(404).json({ error: "Plan task not found" });

        const isAssigned = task.ownerUserId === userId;
        if (!isAssigned) {
          const assignmentCheck = await db.select().from(workItemAssignments).where(
            and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.userId, userId))
          );
          if (assignmentCheck.length === 0) {
            return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
          }
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "engineering") {
        // Schedule ENG tasks via work_items
        const [task] = await db.select().from(workItems).where(and(eq(workItems.id, taskId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
        if (!task) return res.status(404).json({ error: "Engineering task not found" });

        if (task.ownerUserId !== userId) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "quality") {
        const [task] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, taskId));
        if (!task) return res.status(404).json({ error: "Quality task not found" });

        if (task.assigneeUserId !== userId) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(qcItemInstance)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(qcItemInstance.id, taskId));
      } else if (taskType === "tr_register") {
        const [task] = await db.select().from(trItems).where(eq(trItems.id, taskId));
        if (!task) return res.status(404).json({ error: "Action item not found" });

        await db.update(trItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(trItems.id, taskId));
      } else if (taskType === "deliverable") {
        const [task] = await db.select().from(deliverables).where(eq(deliverables.id, taskId));
        if (!task) return res.status(404).json({ error: "Deliverable not found" });

        await db.update(deliverables)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, taskId));
      } else if (taskType === "approval") {
        const userRole = (req.user as any).role || "";
        const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
        const isAdmin = ADMIN_ROLES.includes(userRole);

        if (approvalSubType === "engineering") {
          const [task] = await db.select().from(projectEngApprovals).where(eq(projectEngApprovals.id, taskId));
          if (!task) return res.status(404).json({ error: "Engineering approval not found" });
          const APPROVAL_ROLE_TO_USER_ROLES: Record<string, string[]> = {
            QA_REVIEW: ["QUALITY_MANAGER"],
            TECHNICAL_SIGNOFF: ["ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
            "Engineering Manager": ["ENGINEERING_MANAGER"],
            "Quality Manager": ["QUALITY_MANAGER"],
            "COO": ["COO_ADMIN"],
          };
          const isAssignedApprover = task.approverUserId === userId;
          const allowedByRole = task.approverRole ? (APPROVAL_ROLE_TO_USER_ROLES[task.approverRole] || []).includes(userRole) : false;
          if (!isAdmin && !isAssignedApprover && !allowedByRole) {
            return res.status(403).json({ error: "You can only schedule approvals assigned to you" });
          }
          await db.update(projectEngApprovals)
            .set({
              scheduledDate: scheduledDate || null,
              scheduledStartTime: scheduledStartTime || null,
              scheduledEndTime: scheduledEndTime || null,
              updatedAt: new Date(),
            })
            .where(eq(projectEngApprovals.id, taskId));
        } else if (approvalSubType === "quality") {
          const [task] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, taskId));
          if (!task) return res.status(404).json({ error: "Quality approval not found" });
          const isQM = userRole === "QUALITY_MANAGER" || userRole === "quality_manager";
          const isAssignee = task.assigneeUserId === userId;
          if (!isAdmin && !isQM && !isAssignee) {
            return res.status(403).json({ error: "You can only schedule quality items assigned to you" });
          }
          await db.update(qcItemInstance)
            .set({
              scheduledDate: scheduledDate || null,
              scheduledStartTime: scheduledStartTime || null,
              scheduledEndTime: scheduledEndTime || null,
              lastUpdatedAt: new Date(),
            })
            .where(eq(qcItemInstance.id, taskId));
        } else if (approvalSubType === "general") {
          const [task] = await db.select().from(approvals).where(eq(approvals.id, taskId));
          if (!task) return res.status(404).json({ error: "Approval not found" });
          const isAssignedApprover = task.assignedApprover === userId;
          if (!isAdmin && !isAssignedApprover) {
            return res.status(403).json({ error: "You can only schedule approvals assigned to you" });
          }
          await db.update(approvals)
            .set({
              scheduledDate: scheduledDate || null,
              scheduledStartTime: scheduledStartTime || null,
              scheduledEndTime: scheduledEndTime || null,
            })
            .where(eq(approvals.id, taskId));
        } else {
          return res.status(400).json({ error: "approvalSubType must be 'engineering', 'quality', or 'general'" });
        }
      } else {
        return res.status(400).json({ error: "taskType must be 'mytool', 'operational', 'plan', 'engineering', 'quality', 'tr_register', 'deliverable', or 'approval'" });
      }

      logAuditFromReq(req, {
        entityType: `${taskType}_task`,
        action: "calendar_schedule",
        entityId: String(taskId),
        changesJson: { scheduledDate, scheduledStartTime, scheduledEndTime },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - TASKS ====================

  app.get("/api/mytool/tasks", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);

      // Canonical: always read from work_items via repository (no feature-flag gating)
      const { date } = req.query;
      let tasks;
      if (date && typeof date === 'string') {
        tasks = await storage.getMytoolTasksByDate(userId, date);
      } else {
        tasks = await storage.getMytoolTasks(userId);
      }
      const enriched = await enrichMytoolTasks(userId, tasks);
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/tasks", requireAuth, async (req, res) => {
    const userId = (req.user as any).id;
    const rawRequestId = req.header("x-idempotency-key") || req.body?.clientRequestId;
    const requestId = typeof rawRequestId === "string" ? rawRequestId.trim() : "";
    const hasRequestId = requestId.length > 0;

    try {
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      const bucket = req.body.bucket || 'personal';
      if (bucket === 'project' && !req.body.projectName) {
        return sendError(res, badRequest("Project name is required when bucket is 'project'"));
      }
      if (bucket !== 'project' && req.body.projectName) {
        req.body.projectName = null;
      }
      if (req.body.status) req.body.status = toMytoolDbStatus(normalizeStatus(req.body.status));
      if (req.body.priority) req.body.priority = toMytoolDbPriority(normalizePriority(req.body.priority));

      if (hasRequestId) {
        const idempotencyResult = mytoolTaskIdempotencyStore.begin(userId, requestId);
        if (idempotencyResult.state === "duplicate_pending") {
          console.info("[mytool-task-create] request", { requestId, userId, result: "duplicate_pending" });
          return res.status(409).json({ error: "Duplicate create request in progress", requestId });
        }

        if (idempotencyResult.state === "duplicate_completed" && idempotencyResult.taskId) {
          const existingTask = await storage.getMytoolTask(idempotencyResult.taskId);
          if (existingTask && existingTask.ownerUserId === userId) {
            console.info("[mytool-task-create] request", { requestId, userId, result: "duplicate_completed", taskId: existingTask.id });
            return res.json({ ...existingTask, idempotentReplay: true, requestId });
          }
        }
      }

      const task = await storage.createMytoolTask({ ...req.body, bucket, ownerUserId: userId, taskType: req.body.taskType || "task" });
      if (hasRequestId) {
        mytoolTaskIdempotencyStore.complete(userId, requestId, task.id);
      }

      // Create entity_assignment for the personal task owner
      try {
        const [ownerUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
        await db.insert(entityAssignments).values({
          entityType: "personal_task",
          entityId: task.id,
          projectId: null,
          assignmentRole: "OWNER",
          assigneeType: "internal_user",
          assigneeId: userId,
          displayLabelSnapshot: ownerUser?.name || String(userId),
          active: true,
          assignedByUserId: userId,
          metadata: null,
          updatedAt: new Date(),
        }).onConflictDoNothing();
      } catch (assignErr: any) {
        console.warn("[mytool-task-create] Failed to create entity_assignment, task still created:", assignErr?.message);
      }

      console.info("[mytool-task-create] request", { requestId: hasRequestId ? requestId : null, userId, result: "created", taskId: task.id });
      logAuditFromReq(req, { entityType: "mytool_task", action: "create", entityId: String(task.id), changesJson: { description: "MyTool task created", title: req.body.title, bucket } });
      res.json(task);
    } catch (err: any) {
      if (hasRequestId) {
        mytoolTaskIdempotencyStore.fail(userId, requestId);
      }
      console.error("[mytool-task-create] request", { requestId: hasRequestId ? requestId : null, userId, result: "error", message: err?.message || "unknown_error" });
      sendError(res, err);
    }
  });

  app.patch("/api/mytool/tasks/:id", requireAuth, async (req, res) => {
    try {
      const taskId = parseInt(paramStr(req.params.id));
      const userId = (req.user as any).id;
      const validationErrors = validateTaskUpdate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (req.body.status) req.body.status = toMytoolDbStatus(normalizeStatus(req.body.status));
      if (req.body.priority) req.body.priority = toMytoolDbPriority(normalizePriority(req.body.priority));
      const existingTask = await storage.getMytoolTask(taskId);
      if (existingTask && existingTask.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }

      if (req.body.bucket !== undefined || req.body.projectName !== undefined) {
        const bucket = req.body.bucket || existingTask?.bucket || 'personal';
        const projectName = req.body.projectName !== undefined ? req.body.projectName : existingTask?.projectName;
        if (bucket === 'project' && !projectName) {
          return sendError(res, badRequest("Project name is required when bucket is 'project'"));
        }
        if (bucket !== 'project') {
          req.body.projectName = null;
        }
      }

      if (req.body.status === 'complete' && existingTask) {
        const dod = req.body.definitionOfDone || existingTask.definitionOfDone;
        if (!dod || !dod.trim()) {
          return sendError(res, validationError({ definitionOfDone: "Cannot mark task as done without a Definition of Done." }));
        }
      }

      const task = await storage.updateMytoolTask(taskId, req.body);
      if (req.body.status !== undefined) {
        await refreshDependentTaskStates(taskId);
      }

      if (
        (req.body.status === "complete" || req.body.status === "done") &&
        existingTask &&
        existingTask.isRecurring &&
        existingTask.recurrenceFrequency
      ) {
        const nextDate = computeNextRecurrenceDate(
          existingTask.plannedForDate || new Date().toISOString().slice(0, 10),
          existingTask.recurrenceFrequency,
          existingTask.recurrenceInterval || 1,
          existingTask.recurrenceDaysOfWeek
        );

        if (!existingTask.recurrenceEndDate || nextDate <= existingTask.recurrenceEndDate) {
          const recurrenceParentId = existingTask.recurrenceParentId || existingTask.id;
          // Canonical: check work_items for existing recurrence instances
          const existingInstance = await db.select().from(workItems).where(and(
            eq(workItems.workstream, "PERSONAL"),
            eq(workItems.ownerUserId, userId),
            eq(workItems.recurrenceParentId, recurrenceParentId),
            eq(workItems.scheduledDate, nextDate),
            isNull(workItems.deletedAt),
          )).limit(1);

          if (!existingInstance.length) {
            await storage.createMytoolTask({
              ownerUserId: userId,
              title: existingTask.title,
              status: "planned",
              priority: existingTask.priority,
              plannedForDate: nextDate,
              dueAt: existingTask.dueAt ? computeNextDueDate(existingTask.dueAt, existingTask.recurrenceFrequency, existingTask.recurrenceInterval || 1) : null,
              notes: existingTask.notes,
              projectName: existingTask.projectName,
              tag: existingTask.tag,
              sortOrder: existingTask.sortOrder,
              isRecurring: true,
              recurrenceFrequency: existingTask.recurrenceFrequency,
              recurrenceInterval: existingTask.recurrenceInterval,
              recurrenceDaysOfWeek: existingTask.recurrenceDaysOfWeek,
              recurrenceEndDate: existingTask.recurrenceEndDate,
              recurrenceParentId,
              taskType: existingTask.taskType || "task",
            });
          }
        }
      }

      logAuditFromReq(req, { entityType: "mytool_task", action: "update", entityId: paramStr(req.params.id), changesJson: { description: "MyTool task updated", changedFields: Object.keys(req.body) } });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/tasks/:id", requireAuth, async (req, res) => {
    try {
      const taskId = parseInt(paramStr(req.params.id));
      const userId = (req.user as any).id;
      const existingTask = await storage.getMytoolTask(taskId);
      if (existingTask && existingTask.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      await storage.deleteMytoolTask(taskId);
      logAuditFromReq(req, { entityType: "mytool_task", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "MyTool task deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - DEPENDENCIES ====================

  // Canonical: personal task dependencies now use work_item_dependencies (FKs to work_items.id)

  app.get("/api/mytool/tasks/:id/dependencies", requireAuth, async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const userId = (req.user as any).id;
      const task = await storage.getMytoolTask(taskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const deps = await db.select().from(workItemDependencies).where(
        and(
          or(eq(workItemDependencies.predecessorId, taskId), eq(workItemDependencies.successorId, taskId)),
          isNull(workItemDependencies.deletedAt),
        )
      );
      // Map response to legacy shape for backward compat
      res.json(deps.map((d: any) => ({
        id: d.id,
        predecessorTaskId: d.predecessorId,
        successorTaskId: d.successorId,
        dependencyType: DEP_TYPE_FROM_CANONICAL[d.depType] || "finish_to_start",
        createdAt: null,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/tasks/:id/dependencies", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const successorTaskId = Number(req.params.id);
      const predecessorTaskId = Number(req.body.predecessorTaskId);
      const dependencyType = req.body.dependencyType || "finish_to_start";
      const depType = DEP_TYPE_TO_CANONICAL[dependencyType] || "FS";
      // Verify user owns the successor task
      const task = await storage.getMytoolTask(successorTaskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const validationMessage = validateDependencyPair(predecessorTaskId, successorTaskId);
      if (validationMessage) return res.status(400).json({ error: validationMessage });

      const predecessorLinks = await db.select().from(workItemDependencies).where(
        and(eq(workItemDependencies.successorId, predecessorTaskId), isNull(workItemDependencies.deletedAt))
      );
      if (predecessorLinks.some((l: any) => l.predecessorId === successorTaskId)) {
        return res.status(400).json({ error: "Circular dependency is not allowed" });
      }

      const [created] = await db.insert(workItemDependencies).values({
        predecessorId: predecessorTaskId,
        successorId: successorTaskId,
        depType: depType as any,
      }).onConflictDoNothing().returning();
      await refreshDependentTaskStates(predecessorTaskId);
      // Map response to legacy shape for backward compat
      const result = created
        ? { id: created.id, predecessorTaskId: created.predecessorId, successorTaskId: created.successorId, dependencyType }
        : { predecessorTaskId, successorTaskId, dependencyType, duplicate: true };
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/tasks/:id/dependencies/:dependencyId", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const taskId = Number(req.params.id);
      const task = await storage.getMytoolTask(taskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const dependencyId = Number(req.params.dependencyId);
      const [dep] = await db.select().from(workItemDependencies).where(eq(workItemDependencies.id, dependencyId));
      // Soft-delete to match work_item_dependencies pattern
      await db.update(workItemDependencies).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(workItemDependencies.id, dependencyId));
      if (dep) await refreshDependentTaskStates(dep.predecessorId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - RECURRENCE TEMPLATES ====================

  app.get("/api/mytool/recurrence-templates", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);
      const templates = await db.select().from(mytoolRecurrenceTemplates).where(eq(mytoolRecurrenceTemplates.ownerUserId, userId)).orderBy(desc(mytoolRecurrenceTemplates.updatedAt));
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/recurrence-templates", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const [template] = await db.insert(mytoolRecurrenceTemplates).values({ ...req.body, ownerUserId: userId }).returning();
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - TIMEBLOCKS ====================

  app.get("/api/mytool/timeblocks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: "date query parameter required" });
      }
      const blocks = await storage.getMytoolTimeblocks(userId, date);
      res.json(blocks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/timeblocks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const block = await storage.createMytoolTimeblock({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "create", entityId: String(block.id), changesJson: { description: "Timeblock created" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/mytool/timeblocks/:id", requireAuth, async (req, res) => {
    try {
      const block = await storage.updateMytoolTimeblock(parseInt(paramStr(req.params.id)), req.body);
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "update", entityId: paramStr(req.params.id), changesJson: { description: "Timeblock updated" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/timeblocks/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMytoolTimeblock(parseInt(paramStr(req.params.id)));
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Timeblock deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - DAILY REVIEWS ====================

  app.get("/api/mytool/daily-review", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: "date query parameter required" });
      }
      const review = await storage.getMytoolDailyReview(userId, date);
      res.json(review || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/daily-review", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const review = await storage.upsertMytoolDailyReview({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_daily_review", action: "update", changesJson: { description: "Daily review updated", date: req.body.date } });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Company priorities and priority-link APIs are served by departments/exco-routes.ts.

  app.get("/api/mytool/escalated-priorities", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllOperationalTasks(),
      ]);

      const escalated: Array<{
        id: string;
        type: 'project' | 'task';
        title: string;
        projectName: string;
        escalationLevel: string;
        status: string | null;
        priority: string | null;
        dueDate: string | null;
        assignees: string[] | null;
      }> = [];

      for (const proj of allProjectInfo) {
        if (proj.escalationLevel === 'Highest') {
          escalated.push({
            id: `project-${proj.id}`,
            type: 'project',
            title: proj.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
            projectName: proj.projectName,
            escalationLevel: proj.escalationLevel,
            status: proj.phase || null,
            priority: null,
            dueDate: null,
            assignees: proj.pm ? [proj.pm] : null,
          });
        }
      }

      for (const task of allOpTasks) {
        if (task.escalationLevel === 'Highest') {
          escalated.push({
            id: `task-${task.id}`,
            type: 'task',
            title: task.title,
            projectName: task.projectName,
            escalationLevel: task.escalationLevel,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            assignees: task.assignees,
          });
        }
      }

      res.json(escalated);
    } catch (err: any) {
      const msg = err?.message || '';
      if (/relation.*does not exist|no such table|column.*does not exist/i.test(msg) || err?.code === '42P01' || err?.code === '42703') {
        console.warn("[escalated-priorities] Schema not ready, returning empty:", msg);
        return res.json([]);
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - USER PREFERENCES ====================

  app.get("/api/mytool/preferences", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const prefs = await storage.getMytoolUserPreferences(userId);
      res.json(prefs || { ownerUserId: userId, defaultView: 'today', workdayStartTime: '08:00', workdayEndTime: '17:00', showCompanyPriorities: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/preferences", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const prefs = await storage.upsertMytoolUserPreferences({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_preferences", action: "update", changesJson: { description: "User preferences updated" } });
      res.json(prefs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - EMAIL LINKS ====================

  app.get("/api/mytool/email-links", requireAuth, async (req, res) => {
    try {
      const { taskId, priorityId, operationalTaskId } = req.query;
      if (taskId) {
        const links = await storage.getEmailLinksByTask(parseInt(taskId as string));
        return res.json(links);
      }
      if (operationalTaskId) {
        const links = await storage.getEmailLinksByOperationalTask(parseInt(operationalTaskId as string));
        return res.json(links);
      }
      if (priorityId) {
        const links = await storage.getEmailLinksByPriority(parseInt(priorityId as string));
        return res.json(links);
      }
      res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/email-links", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any)?.id || null;
      const link = await storage.createEmailLink({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "email_link", action: "create", entityId: String(link.id), changesJson: { description: "Email link created" } });
      res.json(link);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/email-links/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteEmailLink(parseInt(paramStr(req.params.id)));
      logAuditFromReq(req, { entityType: "email_link", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Email link deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - DOD TEMPLATES ====================

  app.get("/api/mytool/dod-templates", requireAuth, async (req, res) => {
    try {
      const templates = await storage.getMytoolDodTemplates();
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/dod-templates", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const template = await storage.createMytoolDodTemplate({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "dod_template", action: "create", entityId: String(template.id), changesJson: { description: "DoD template created", title: req.body.title } });
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/dod-templates/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMytoolDodTemplate(parseInt(paramStr(req.params.id)));
      logAuditFromReq(req, { entityType: "dod_template", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "DoD template deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - SUPPORT TICKETS ====================

  app.post("/api/mytool/support-ticket", requireAuth, async (req, res) => {
    try {
      const { summary, stepsToReproduce, currentRoute, userAgent } = req.body;
      if (!summary || !stepsToReproduce) {
        return res.status(400).json({ error: "Summary and steps to reproduce are required" });
      }
      const correlationId = `ST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const ticket = await storage.createSupportTicket({
        userId: (req.user as any).id,
        summary,
        stepsToReproduce,
        currentRoute: currentRoute || null,
        userAgent: userAgent || null,
        correlationId,
        status: "open",
      });
      logAuditFromReq(req, { entityType: "support_ticket", action: "create", entityId: correlationId, changesJson: { description: "Support ticket created", summary } });
      res.json(ticket);
    } catch (error: any) {
      console.error("Error creating support ticket:", error);
      res.status(500).json({ error: "Failed to create support ticket" });
    }
  });

  // Support tickets listing is admin-only (cross-user administrative view)
  app.get("/api/mytool/support-tickets", requireAuth, requireAdmin, async (req, res) => {
    try {
      const tickets = await storage.getSupportTickets();
      res.json(tickets);
    } catch (error: any) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ error: "Failed to fetch support tickets" });
    }
  });

  // ==================== TRIAGE RULES CRUD ====================

  app.get("/api/mytool/triage-rules", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const rules = await db.select().from(triageRulesTable).where(eq(triageRulesTable.ownerUserId, userId));
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/triage-rules", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { ruleType, value } = req.body;
      if (!ruleType || !value) return res.status(400).json({ error: "ruleType and value required" });
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [rule] = await db.insert(triageRulesTable).values({
        ownerUserId: userId,
        ruleType,
        value: value.trim(),
        enabled: true,
      }).returning();
      logAuditFromReq(req, { entityType: "triage_rule", action: "create", entityId: String(rule.id), changesJson: { description: "Triage rule created", ruleType, value } });
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/mytool/triage-rules/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ruleId = parseInt(paramStr(req.params.id));
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [existing] = await db.select().from(triageRulesTable).where(eq(triageRulesTable.id, ruleId)).limit(1);
      if (existing && existing.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const updates: any = {};
      if (req.body.value !== undefined) updates.value = req.body.value.trim();
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      const [rule] = await db.update(triageRulesTable).set(updates).where(eq(triageRulesTable.id, ruleId)).returning();
      logAuditFromReq(req, { entityType: "triage_rule", action: "update", entityId: String(ruleId), changesJson: { description: "Triage rule updated" } });
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/triage-rules/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ruleId = parseInt(paramStr(req.params.id));
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [existing] = await db.select().from(triageRulesTable).where(eq(triageRulesTable.id, ruleId)).limit(1);
      if (existing && existing.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      await db.delete(triageRulesTable).where(eq(triageRulesTable.id, ruleId));
      logAuditFromReq(req, { entityType: "triage_rule", action: "delete", entityId: String(ruleId), changesJson: { description: "Triage rule deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TRIAGE INBOX ====================

  app.get("/api/mytool/triage-inbox", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const outlook = await import("../outlook");
      if (!outlook.isOutlookConfigured()) {
        return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
      }

      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const rules = await db.select().from(triageRulesTable)
        .where(and(eq(triageRulesTable.ownerUserId, userId), eq(triageRulesTable.enabled, true)));

      const keywords = rules.filter((r: any) => r.ruleType === 'keyword').map((r: any) => r.value.toLowerCase());
      const senders = rules.filter((r: any) => r.ruleType === 'sender').map((r: any) => r.value.toLowerCase());
      const domains = rules.filter((r: any) => r.ruleType === 'domain').map((r: any) => r.value.toLowerCase());

      let flagged: any[] = [];
      try {
        flagged = await outlook.listFlaggedMessages(30);
      } catch {}

      let recentEmails: any[] = [];
      try {
        recentEmails = await outlook.listMessages({ top: 50 });
      } catch {}

      const keywordMatches: any[] = [];
      const senderMatches: any[] = [];
      const flaggedIds = new Set(flagged.map((e: any) => e.id));

      for (const email of recentEmails) {
        if (flaggedIds.has(email.id)) continue;
        const subjectLower = (email.subject || "").toLowerCase();
        const snippetLower = (email.snippet || "").toLowerCase();
        const senderEmailLower = (email.senderEmail || "").toLowerCase();

        const matchedKeyword = keywords.find((kw: string) => subjectLower.includes(kw) || snippetLower.includes(kw));
        if (matchedKeyword) {
          keywordMatches.push({ ...email, matchedRule: matchedKeyword, matchType: 'keyword' });
          continue;
        }

        const matchedSender = senders.find((s: string) => senderEmailLower === s || (email.sender || "").toLowerCase() === s);
        if (matchedSender) {
          senderMatches.push({ ...email, matchedRule: matchedSender, matchType: 'sender' });
          continue;
        }

        const matchedDomain = domains.find((d: string) => senderEmailLower.endsWith("@" + d) || senderEmailLower.endsWith("." + d));
        if (matchedDomain) {
          senderMatches.push({ ...email, matchedRule: matchedDomain, matchType: 'domain' });
        }
      }

      res.json({ flagged, keywordMatches, senderMatches, rules });
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== UNCLASSIFIED TASKS ====================

  app.get("/api/mytool/unclassified-tasks", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);
      // Canonical: personal tasks now in work_items (workstream=PERSONAL)
      const tasks = await db.select().from(workItems)
        .where(
          and(
            eq(workItems.workstream, "PERSONAL"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt),
            or(
              isNull(workItems.bucket),
              and(sql`${workItems.bucket} = 'project'`, isNull(workItems.projectId))
            )
          )
        );
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
