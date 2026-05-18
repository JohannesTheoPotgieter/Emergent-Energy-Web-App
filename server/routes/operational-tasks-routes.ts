// Error breakdown: TS7006 implicit-any: 14, TS2345 query/param types: 8, other: 0
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { projectInfo, workItems, workItemAssignments, notifications } from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { assertTaskWorkflowTransition, buildTaskWorkflowContext, TaskWorkflowGuardError } from "../lib/task-workflow-guard";
import { ApiError, sendError, badRequest, notFound, validationError, unauthorized, serverError } from "../lib/api-error";
import { validateTaskCreate, validateTaskUpdate } from "../lib/task-validation";
import { normalizeStatus, normalizePriority } from "../lib/canonical-task-engine";
import { getWorkItemsAsOperationalTasks } from "../work-items-adapter";
import { paramStr, parseIntParam } from "../lib/req-params";

export function registerOperationalTasksRoutes(app: Express) {
  // ==================== OPERATIONAL TASKS ====================

  app.get("/api/operational-tasks/task/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: `Invalid task ID: ${req.params.id}` });
      }

      if (id < 0) {
        const planId = -id;
        let planTask: any = null;

        const [wiResult] = await db.select().from(workItems).where(eq(workItems.id, planId)).limit(1);
        if (wiResult) {
          const projName = wiResult.projectId
            ? (await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, wiResult.projectId)))[0]?.projectName || ""
            : "";
          planTask = {
            id: wiResult.id,
            projectName: projName,
            taskNo: wiResult.wbsCode,
            rowNumber: null,
            highLevelProgramme: wiResult.title,
            actualStart: wiResult.startDate,
            actualEnd: wiResult.endDate,
            durationDays: wiResult.duration,
            actualPctComplete: wiResult.percentComplete,
            expectedPctComplete: null,
            createdAt: wiResult.createdAt,
            comment: wiResult.description,
          };
        }

        if (!planTask) {
          const allProjects = await storage.getAllProjectInfo();
          for (const proj of allProjects) {
            const plans = await storage.getProjectPlansByProject(proj.projectName);
            planTask = plans.find((t: any) => t.id === planId);
            if (planTask) break;
          }
        }
        if (!planTask) return res.status(404).json({ error: "Baseline task not found" });

        const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
        let status = "todo";
        if (pctComplete >= 100) status = "complete";
        else if (pctComplete > 0) status = "in_progress";

        const syntheticTask = {
          id: -planTask.id,
          projectName: planTask.projectName,
          importedTaskId: planTask.id,
          taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
          parentTaskId: null,
          title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
          description: null,
          status,
          priority: "Normal",
          startDate: planTask.actualStart || null,
          dueDate: planTask.actualEnd || null,
          durationDays: planTask.durationDays || null,
          percentComplete: pctComplete,
          expectedPercentComplete: planTask.expectedPctComplete != null ? Math.round(planTask.expectedPctComplete * 100) : null,
          assignees: null,
          tags: null,
          blockerReason: null,
          plannedHours: null,
          actualHours: null,
          sortOrder: planTask.rowNumber || 0,
          isBaseline: true,
          source: "baseline",
          createdBy: null,
          createdAt: planTask.createdAt,
          updatedAt: planTask.createdAt,
        };
        res.json({ task: syntheticTask, comments: [], checklists: [], attachments: [], activity: [] });
        return;
      }

      // Try canonical work_items
      let task: any = null;
      const { getEngineeringWorkItemById } = await import("../work-items-adapter");
      const canonicalTask = await getEngineeringWorkItemById(id);
      if (canonicalTask) {
        task = canonicalTask;
      } else {
        task = await storage.getOperationalTask(id);
      }
      if (!task) return res.status(404).json({ error: "Task not found" });
      const taskIdForSub = task.workItemId || id;
      const [comments, checklists, attachments, activity] = await Promise.all([
        storage.getTaskComments(taskIdForSub),
        storage.getTaskChecklists(taskIdForSub),
        storage.getTaskAttachments(taskIdForSub),
        storage.getTaskActivityLog(taskIdForSub),
      ]);
      const checklistsWithItems = await Promise.all(checklists.map(async cl => ({
        ...cl,
        items: await storage.getChecklistItems(cl.id),
      })));

      const { buildUserMap, mergeResolvedWithTextNames } = await import("../user-resolver");
      const userMap = await buildUserMap();
      const idResolved = (task.assigneeUserIds || []).map((uid: number) => userMap.get(uid)).filter(Boolean);
      const resolvedAssignees = mergeResolvedWithTextNames(idResolved, task.assignees, userMap);
      const resolvedOwner = task.ownerUserId ? userMap.get(task.ownerUserId) || null : null;

      res.json({ task: { ...task, resolvedAssignees, resolvedOwner }, comments, checklists: checklistsWithItems, attachments, activity });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/operational-tasks/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectName = paramStr(req.params.projectName);

      // Always read from canonical work_items
      const canonicalTasks = await getWorkItemsAsOperationalTasks(projectName);
      if (canonicalTasks.length > 0) {
        return res.json(canonicalTasks);
      }

      // Legacy fallback removed — all data should be in work_items by now.
      return res.json([]);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/operational-tasks", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (req.body.status) req.body.status = normalizeStatus(req.body.status);
      if (req.body.priority) req.body.priority = normalizePriority(req.body.priority);
      const task = await storage.createOperationalTask(req.body);
      await storage.createTaskActivityLog({
        workItemId: task.id,
        actorId: (req.user as any)?.id || null,
        actionType: 'created',
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
      logAuditFromReq(req, { entityType: "operational_task", action: "create", entityId: String(task.id), projectName: req.body.projectName, changesJson: { description: "Operational task created", title: req.body.title, projectName: req.body.projectName } });
      res.json(task);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.patch("/api/operational-tasks/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: `Invalid task ID: ${req.params.id}` });
      }
      const updates = req.body;
      const validationErrors = validateTaskUpdate(updates);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);

      const linkPlanRowIdRaw =
        updates.importedTaskId !== undefined ? updates.importedTaskId :
        updates.linkedPlanItemId !== undefined ? updates.linkedPlanItemId :
        undefined;
      if (linkPlanRowIdRaw !== undefined) {
        const linkPlanRowId = linkPlanRowIdRaw === null ? null : Number(linkPlanRowIdRaw);
        if (linkPlanRowId !== null && !Number.isFinite(linkPlanRowId)) {
          return res.status(400).json({ error: "Invalid plan row id" });
        }
        if (linkPlanRowId !== null && id > 0) {
          try {
            const { db } = await import("../db");
            const { workItems } = await import("@shared/schema");
            const { eq } = await import("drizzle-orm");
            const [task] = await db.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, id));
            const [target] = await db.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, linkPlanRowId));
            if (!target) return res.status(400).json({ error: "Plan row not found" });
            if (task && target.projectId && task.projectId && target.projectId !== task.projectId) {
              return res.status(400).json({ error: "Plan row belongs to a different project" });
            }
          } catch (e) {
            console.warn("[operational-tasks-routes] link guard error:", e instanceof Error ? e.message : e);
          }
        }
        delete updates.importedTaskId;
        updates.linkedPlanItemId = linkPlanRowId;
      }

      if (updates.status && id > 0) {
        const oldTaskForGuard = await storage.getOperationalTask(id);
        if (!oldTaskForGuard) return sendError(res, notFound("Operational task"));
        try {
          const context = await buildTaskWorkflowContext(id, oldTaskForGuard.status);
          assertTaskWorkflowTransition(context, updates.status, "status_update");
        } catch (err: any) {
          if (err instanceof TaskWorkflowGuardError) {
            // eslint-disable-next-line no-restricted-syntax -- intentional: TaskWorkflowGuardError carries a user-authored business message
            return res.status(err.statusCode).json({ error: err.message });
          }
          throw err;
        }
      }

      if (id < 0) {
        const planId = -id;
        const planTasks = await storage.getProjectPlansByProject("");
        const pt = planTasks.find((t: any) => t.id === planId) ||
          (await (async () => {
            const allPlans = await storage.getProjectPlansByProject("");
            return allPlans.find((t: any) => t.id === planId);
          })());

        let planTask: any = null;
        try {
          const allProjects = await storage.getAllProjectInfo();
          for (const proj of allProjects) {
            const plans = await storage.getProjectPlansByProject(proj.projectName);
            planTask = plans.find((t: any) => t.id === planId);
            if (planTask) break;
          }
        } catch (e) { console.warn("[operational-tasks-routes] non-critical error:", e instanceof Error ? e.message : e); }

        if (!planTask) return res.status(404).json({ error: "Baseline task not found" });

        const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
        let status = "todo";
        if (pctComplete >= 100) status = "complete";
        else if (pctComplete > 0) status = "in_progress";

        const newTask = await storage.createOperationalTask({
          projectName: planTask.projectName,
          importedTaskId: planTask.id,
          taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
          title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
          description: null,
          status,
          priority: "Normal",
          startDate: planTask.actualStart || null,
          dueDate: planTask.actualEnd || null,
          durationDays: planTask.durationDays || null,
          percentComplete: pctComplete,
          assignees: null,
          tags: null,
          blockerReason: null,
          plannedHours: null,
          actualHours: null,
          sortOrder: planTask.rowNumber || 0,
          source: "baseline",
          createdBy: (req.user as any)?.id || null,
          ...updates,
        });

        await storage.createTaskActivityLog({
          workItemId: newTask.id,
          actorId: (req.user as any)?.id || null,
          actionType: 'promoted',
          fieldName: null,
          oldValue: `baseline:${planId}`,
          newValue: JSON.stringify(updates),
        });

        res.json({ ...newTask, isBaseline: true, _promotedFrom: planId });
        return;
      }

      const oldTask = await storage.getOperationalTask(id);
      if (!oldTask) return sendError(res, notFound("Operational task"));
      const updated = await storage.updateOperationalTask(id, updates);
      for (const [key, value] of Object.entries(updates)) {
        if ((oldTask as any)[key] !== value) {
          await storage.createTaskActivityLog({
            workItemId: id,
            actorId: (req.user as any)?.id || null,
            actionType: 'updated',
            fieldName: key,
            oldValue: String((oldTask as any)[key] ?? ''),
            newValue: String(value ?? ''),
          });
        }
      }
      logAuditFromReq(req, { entityType: "operational_task", action: "update", entityId: String(id), changesJson: { description: "Operational task updated", changedFields: Object.keys(updates) } });
      res.json(updated);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.delete("/api/operational-tasks/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const task = await storage.getOperationalTask(id);
      if (task) {
        await storage.createTaskActivityLog({
          workItemId: id,
          actorId: (req.user as any)?.id || null,
          actionType: 'deleted',
          fieldName: null,
          oldValue: task.title,
          newValue: null,
        });
      }
      await storage.deleteOperationalTask(id);
      logAuditFromReq(req, { entityType: "operational_task", action: "delete", entityId: String(id), changesJson: { description: "Operational task deleted", title: task?.title } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // GC-008: Task type/workstream conversion endpoint
  app.post("/api/operational-tasks/:id/convert", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const { targetWorkstream } = req.body;
      const validWorkstreams = ["PM", "Engineering", "Quality", "Procurement", "Construction", "Commissioning", "Handover", "PD"];
      if (!targetWorkstream || !validWorkstreams.includes(targetWorkstream)) {
        return res.status(400).json({ error: `Invalid target workstream. Valid values: ${validWorkstreams.join(", ")}` });
      }

      const task = await storage.getOperationalTask(id);
      if (!task) return sendError(res, notFound("Operational task"));

      const oldWorkstream = (task as any).primaryWorkstream || "PM";
      const updated = await storage.updateOperationalTask(id, { primaryWorkstream: targetWorkstream });

      await storage.createTaskActivityLog({
        workItemId: id,
        actorId: (req.user as any)?.id || null,
        actionType: 'converted',
        fieldName: 'primaryWorkstream',
        oldValue: oldWorkstream,
        newValue: targetWorkstream,
      });

      // Also update the linked work item's workstream if it exists
      try {
        const linkedWi = await db.select().from(workItems).where(eq(workItems.legacyId, id)).limit(1);
        if (linkedWi.length > 0) {
          await db.update(workItems).set({ workstream: targetWorkstream }).where(eq(workItems.id, linkedWi[0].id));
        }
      } catch (e: any) {
        console.warn(`[task-convert] Failed to sync work item workstream for task ${id}:`, e.message);
      }

      logAuditFromReq(req, {
        entityType: "operational_task", action: "convert", entityId: String(id),
        changesJson: { from: oldWorkstream, to: targetWorkstream, title: (task as any).title },
      });

      res.json({ ...updated, _converted: { from: oldWorkstream, to: targetWorkstream } });
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.post("/api/operational-tasks/bulk-update", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { taskIds, updates } = req.body as { taskIds: number[]; updates: Record<string, any> };
      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);
      const results = [];
      for (const taskId of taskIds) {
        if (taskId < 0) {
          const planId = -taskId;
          let planTask: any = null;
          try {
            const allProjects = await storage.getAllProjectInfo();
            for (const proj of allProjects) {
              const plans = await storage.getProjectPlansByProject(proj.projectName);
              planTask = plans.find((t: any) => t.id === planId);
              if (planTask) break;
            }
          } catch (e) { console.warn("[operational-tasks-routes] non-critical error:", e instanceof Error ? e.message : e); }
          if (!planTask) continue;

          const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
          let status = "Not Started";
          if (pctComplete >= 100) status = "Done";
          else if (pctComplete > 0) status = "In Progress";

          const newTask = await storage.createOperationalTask({
            projectName: planTask.projectName,
            importedTaskId: planTask.id,
            taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
            title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
            description: null,
            status,
            priority: "Normal",
            startDate: planTask.actualStart || null,
            dueDate: planTask.actualEnd || null,
            durationDays: planTask.durationDays || null,
            percentComplete: pctComplete,
            assignees: null,
            tags: null,
            blockerReason: null,
            plannedHours: null,
            actualHours: null,
            sortOrder: planTask.rowNumber || 0,
            source: "baseline",
            createdBy: (req.user as any)?.id || null,
            ...updates,
          });
          results.push(newTask);
          continue;
        }
        const oldTask = await storage.getOperationalTask(taskId);
        if (!oldTask) continue;
        if (updates.status) {
          try {
            const context = await buildTaskWorkflowContext(taskId, oldTask.status);
            assertTaskWorkflowTransition(context, updates.status, "bulk_status_update");
          } catch (err: any) {
            if (err instanceof TaskWorkflowGuardError) {
              // eslint-disable-next-line no-restricted-syntax -- intentional: TaskWorkflowGuardError carries a user-authored business message
              return res.status(err.statusCode).json({ error: err.message, taskId });
            }
            throw err;
          }
        }
        const updated = await storage.updateOperationalTask(taskId, updates);
        for (const [key, value] of Object.entries(updates)) {
          if ((oldTask as any)[key] !== value) {
            await storage.createTaskActivityLog({
              workItemId: taskId,
              actorId: (req.user as any)?.id || null,
              actionType: 'updated',
              fieldName: key,
              oldValue: String((oldTask as any)[key] ?? ''),
              newValue: String(value ?? ''),
            });
          }
        }
        results.push(updated);
      }
      logAuditFromReq(req, { entityType: "operational_task", action: "bulk_update", changesJson: { description: `${taskIds.length} task(s) bulk updated`, taskCount: taskIds.length, changedFields: Object.keys(updates) } });
      res.json(results);
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== TASK COMMENTS ====================

  app.get("/api/task-comments/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const comments = await storage.getTaskComments(parseIntParam(req.params.taskId));
      res.json(comments);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/task-comments", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const comment = await storage.createTaskComment(req.body);
      logAuditFromReq(req, { entityType: "task_comment", action: "create", entityId: String(comment.id), changesJson: { description: "Task comment added", taskId: req.body.taskId } });
      res.json(comment);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/task-comments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskComment(id);
      logAuditFromReq(req, { entityType: "task_comment", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Task comment deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== TASK CHECKLISTS ====================

  app.get("/api/task-checklists/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const checklists = await storage.getTaskChecklists(parseIntParam(req.params.taskId));
      const checklistsWithItems = await Promise.all(checklists.map(async cl => ({
        ...cl,
        items: await storage.getChecklistItems(cl.id),
      })));
      res.json(checklistsWithItems);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/task-checklists", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const checklist = await storage.createTaskChecklist(req.body);
      logAuditFromReq(req, { entityType: "task_checklist", action: "create", entityId: String(checklist.id), changesJson: { description: "Task checklist created", taskId: req.body.taskId } });
      res.json(checklist);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/task-checklists/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskChecklist(id);
      logAuditFromReq(req, { entityType: "task_checklist", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Task checklist deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/task-checklist-items", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const item = await storage.createChecklistItem(req.body);
      logAuditFromReq(req, { entityType: "checklist_item", action: "create", entityId: String(item.id), changesJson: { description: "Checklist item created" } });
      res.json(item);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateChecklistItem(id, req.body);
      logAuditFromReq(req, { entityType: "checklist_item", action: "update", entityId: paramStr(req.params.id), changesJson: { description: "Checklist item updated" } });
      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteChecklistItem(id);
      logAuditFromReq(req, { entityType: "checklist_item", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Checklist item deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== TASK ATTACHMENTS ====================

  app.get("/api/task-attachments/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const attachments = await storage.getTaskAttachments(parseIntParam(req.params.taskId));
      res.json(attachments);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/task-attachments", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const attachment = await storage.createTaskAttachment(req.body);
      logAuditFromReq(req, { entityType: "task_attachment", action: "create", entityId: String(attachment.id), changesJson: { description: "Task attachment added" } });
      res.json(attachment);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/task-attachments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskAttachment(id);
      logAuditFromReq(req, { entityType: "task_attachment", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Task attachment deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== TASK ACTIVITY LOG ====================

  app.get("/api/task-activity/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const activity = await storage.getTaskActivityLog(parseIntParam(req.params.taskId));
      res.json(activity);
    } catch (err: any) {
      throw err;
    }
  });
}
