/**
 * Planning / Project Plan Routes — Extracted from server/routes.ts (Phase 4b)
 *
 * 7 handlers:
 *   GET    /api/project-plans
 *   GET    /api/project-plan/overrides
 *   GET    /api/project-plan/:projectName
 *   POST   /api/project-plan/overrides
 *   DELETE /api/project-plan/overrides/:projectName
 *   POST   /api/project-plan/structure
 *   POST   /api/project-plan/delete-tasks
 *
 * Helpers moved: sendPlanChangeNotifications, PLAN_CHANGE_NOTIFY_ROLES
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { workItems } from "@shared/schema";
import { OVERRIDE_CATEGORIES } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { recordOverride } from "../lib/audit/diff-engine";
import { recordManualEditFlag } from "../lib/manual-edit-flag";
import { isWorkItemsEnabled, getAllWorkItemsForPlanTab } from "../work-items-adapter";
import { convertWorkItemTypeInPlace, WorkItemConversionError } from "../services/work-item-conversion-service";
import { paramStr } from "../lib/req-params";
import { UsersRepository } from "../repositories/users-repository";
import { NotificationsRepository } from "../repositories/notifications-repository";
import { WorkManagementRepository } from "../repositories/work-management-repository";

const usersRepository = new UsersRepository();
const notificationsRepository = new NotificationsRepository();
const workManagementRepository = new WorkManagementRepository();

// ── Plan change notification helpers (moved from routes.ts) ──

const PLAN_CHANGE_NOTIFY_ROLES = ['PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'];

async function sendPlanChangeNotifications(
  projectName: string,
  changedByUserId: number | undefined,
  changeDescription: string,
  changeDetails: { field?: string; oldValue?: string; newValue?: string; tasks?: string[]; operation?: string }[]
) {
  try {
    const recipients = await usersRepository.listByRoles(PLAN_CHANGE_NOTIFY_ROLES);

    if (recipients.length === 0) return;

    const changedByName = changedByUserId
      ? (await usersRepository.getNameById(changedByUserId)) ?? "Unknown"
      : "System";

    const detailsJson = JSON.stringify({ projectName, changedBy: changedByName, changes: changeDetails, timestamp: new Date().toISOString() });
    for (const recipient of recipients) {
      if (recipient.id === changedByUserId) continue;
      await notificationsRepository.create({
        recipientUserId: recipient.id,
        eventType: "plan_change",
        title: `Plan updated: ${projectName}`,
        body: changeDescription,
        projectName,
        changeDetails: detailsJson,
      });
    }
  } catch (err: any) {
    console.warn("[plan-notify] Failed to send plan change notifications:", err.message);
  }
}

// ── Main registration function ──

export function registerPlanningExtractedRoutes(app: Express): void {

  // ==================== PROJECT PLANS (READ) ====================

  app.get("/api/project-plans", requireAuth, async (req, res) => {
    try {
      const { projectName, applyOverrides } = req.query;
      let plans;

      if (projectName && typeof projectName === 'string') {
        plans = await storage.getProjectPlansByProject(projectName);

        // Apply overrides if requested
        if (applyOverrides === 'true') {
          // Override data now baked into base rows
        }
        return res.json(plans);
      }
      plans = await storage.getAllProjectPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plans", message: "Failed to fetch project plans" });
    }
  });

  app.get("/api/project-plan/overrides", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.query;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan overrides", message: "Failed to fetch project plan overrides" });
    }
  });

  app.get("/api/project-plan/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
      const { applyOverrides } = req.query;

      let plans = await storage.getProjectPlansByProject(projectName);

      // Override data now baked into base rows

      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan", message: "Failed to fetch project plan", code: "PROJECT_PLAN_ERROR" });
    }
  });


  // ==================== PROJECT PLAN OVERRIDES (WRITE) ====================

  app.post("/api/project-plan/overrides", requireAuth, requirePermission('pd_plan', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;
      const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyProjectPlanOverrides(overridesWithUser);

      try {
        for (const o of overrides) {
          await recordOverride({
            actorUserId: userId,
            actorRole: (req as any).user?.role,
            entityType: "project_plan_override",
            entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
            projectName: o.projectName,
            action: "PROJECT_PLAN_OVERRIDE",
            overrideCategory,
            overrideComment: overrideComment.trim(),
            oldRecord: {},
            newRecord: { [o.fieldName]: o.overrideValue },
          });
        }
      } catch (auditErr: any) {
        console.warn("[audit] Project plan override audit failed:", auditErr.message);
      }

      // Record manual edit flags for import conflict detection
      for (const o of overrides) {
        recordManualEditFlag({
          entityType: "project_plan",
          entityId: o.rowNumber,
          fieldName: o.fieldName,
          editedByUserId: userId,
          editedByName: (req as any).user?.name,
        });
      }

      // Plan edit notifications are tracked via planEditNotifications table (existing mechanism)
      const projectNameForNotif = overrides[0]?.projectName;
      if (projectNameForNotif) {
        const changeDetails = overrides.map((o: any) => ({
          field: o.fieldName,
          newValue: o.overrideValue,
          tasks: [`Row ${o.rowNumber}`],
        }));
        const fieldNames = [...new Set(overrides.map((o: any) => o.fieldName))].join(", ");
        sendPlanChangeNotifications(
          projectNameForNotif,
          req.user?.id,
          `Fields updated: ${fieldNames}.`,
          changeDetails
        );
      }

      logAuditFromReq(req, { entityType: "plan_override", action: "create", projectName: overrides[0]?.projectName, changesJson: { description: `${overrides.length} plan override(s) saved`, count: overrides.length, fields: [...new Set(overrides.map((o: any) => o.fieldName))] } });
      res.json({ message: "Project plan overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save project plan overrides" });
    }
  });

  app.delete("/api/project-plan/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      await storage.deleteProjectPlanOverridesByProject(projectName);

      logAuditFromReq(req, { entityType: "plan_override", action: "delete", projectName, changesJson: { description: "All plan overrides deleted for project", projectName } });
      res.json({ message: `Project plan overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete project plan overrides", message: "Failed to delete project plan overrides" });
    }
  });

  app.post("/api/project-plan/structure", requireAuth, requirePermission('pd_plan', 'edit'), async (req: Request, res: Response) => {
    try {
      const { operation, projectName: rawProjectName, data } = req.body;
      if (!rawProjectName || !operation) {
        return res.status(400).json({ error: "projectName and operation required" });
      }
      const userId = (req as any).user?.id || null;

      const trackerName = rawProjectName.endsWith("_Tracker") ? rawProjectName : rawProjectName + "_Tracker";
      const plansDirect = await storage.getProjectPlansByProject(rawProjectName);
      const projectName = plansDirect.length > 0 ? rawProjectName : trackerName;

      const notifyStructureChange = (desc: string) => {
        sendPlanChangeNotifications(rawProjectName, userId, desc, [{ operation, tasks: data?.taskRowNumbers || [] }]);
      };

      if (operation === "createMilestone") {
        const { title } = data || {};
        if (!title) return res.status(400).json({ error: "title required" });

        const useCanonical = await isWorkItemsEnabled();
        if (useCanonical) {
          const projectInfoRow = await storage.getProjectInfo(rawProjectName);
          const projectId = projectInfoRow?.id || null;
          if (!projectId) return res.status(400).json({ error: "Project not found" });

          const existingWbsCodes = await workManagementRepository.listPmTopLevelWbsCodes(projectId);

          let nextTopLevelNum = 1;
          for (const wbsCode of existingWbsCodes) {
            const topLevel = parseInt(wbsCode.split('.')[0]);
            if (!isNaN(topLevel) && topLevel >= nextTopLevelNum) {
              nextTopLevelNum = topLevel + 1;
            }
          }
          const newWbsCode = String(nextTopLevelNum);

          const maxSort = await workManagementRepository.getMaxSortOrder(projectId);
          const nextSortOrder = maxSort + 10;

          const newMilestone = await workManagementRepository.createPmMilestone({
            projectId,
            title,
            wbsCode: newWbsCode,
            sortOrder: nextSortOrder,
            createdBy: userId,
          });

          notifyStructureChange(`New milestone created: "${title}".`);
          return res.json({ message: "Milestone created", workItemId: newMilestone.id, wbsCode: newWbsCode });
        }

        const newRowNumber = -1;

        const milestoneOverrides = [
          { projectName, rowNumber: newRowNumber, fieldName: "highLevelProgramme", overrideValue: title, createdBy: userId },
          { projectName, rowNumber: newRowNumber, fieldName: "indentLevel", overrideValue: "0", createdBy: userId },
          { projectName, rowNumber: newRowNumber, fieldName: "sortOrder", overrideValue: String(newRowNumber), createdBy: userId },
        ];
        await storage.upsertManyProjectPlanOverrides(milestoneOverrides);
        notifyStructureChange(`New milestone created: "${title}".`);
        return res.json({ message: "Milestone created", rowNumber: newRowNumber });
      }

      if (operation === "setParent") {
        const { taskRowNumbers, parentRowNumber } = data || {};
        if (!Array.isArray(taskRowNumbers) || parentRowNumber === undefined) {
          return res.status(400).json({ error: "taskRowNumbers[] and parentRowNumber required" });
        }
        const safeRows = taskRowNumbers.filter((rn: number) => rn !== parentRowNumber);
        if (safeRows.length === 0) {
          return res.status(400).json({ error: "Cannot set a task as its own parent" });
        }
        const overridesToSave: any[] = [];
        for (let i = 0; i < safeRows.length; i++) {
          overridesToSave.push({
            projectName, rowNumber: safeRows[i],
            fieldName: "parentRowNumber", overrideValue: String(parentRowNumber), createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: safeRows[i],
            fieldName: "indentLevel", overrideValue: "1", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${taskRowNumbers.length} task(s) grouped under a milestone.`);
        return res.json({ message: `${taskRowNumbers.length} tasks grouped under milestone` });
      }

      if (operation === "removeMilestone") {
        const { taskRowNumbers } = data || {};
        if (!Array.isArray(taskRowNumbers)) {
          return res.status(400).json({ error: "taskRowNumbers[] required" });
        }
        const overridesToSave: any[] = [];
        for (const rn of taskRowNumbers) {
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "indentLevel", overrideValue: "", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${taskRowNumbers.length} task(s) ungrouped from milestone.`);
        return res.json({ message: `${taskRowNumbers.length} tasks ungrouped` });
      }

      if (operation === "reorder") {
        const { rowNumber, newSortOrder } = data || {};
        if (rowNumber === undefined || newSortOrder === undefined) {
          return res.status(400).json({ error: "rowNumber and newSortOrder required" });
        }
        await storage.upsertManyProjectPlanOverrides([{
          projectName, rowNumber, fieldName: "sortOrder",
          overrideValue: String(newSortOrder), createdBy: userId,
        }]);
        return res.json({ message: "Sort order updated" });
      }

      if (operation === "convertToMilestone") {
        const { milestoneRowNumber, subtaskRowNumbers } = data || {};
        if (milestoneRowNumber === undefined || !Array.isArray(subtaskRowNumbers) || subtaskRowNumbers.length === 0) {
          return res.status(400).json({ error: "milestoneRowNumber and subtaskRowNumbers[] required" });
        }
        const safeSubtasks = subtaskRowNumbers.filter((rn: number) => rn !== milestoneRowNumber);
        if (safeSubtasks.length === 0) {
          return res.status(400).json({ error: "No valid subtasks after excluding milestone" });
        }
        const overridesToSave: any[] = [];
        overridesToSave.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "indentLevel", overrideValue: "0", createdBy: userId,
        });
        overridesToSave.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
        });
        for (const rn of safeSubtasks) {
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "parentRowNumber", overrideValue: String(milestoneRowNumber), createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "indentLevel", overrideValue: "1", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`Task converted to milestone with ${subtaskRowNumbers.length} subtask(s).`);
        return res.json({ message: `Task converted to milestone with ${subtaskRowNumbers.length} subtasks` });
      }

      if (operation === "deleteMilestone") {
        const { milestoneRowNumber } = data || {};
        if (milestoneRowNumber === undefined || milestoneRowNumber >= 0) {
          return res.status(400).json({ error: "milestoneRowNumber (negative) required" });
        }
        const allOverrides: any[] = [];
        const childOverrides = allOverrides.filter(
          (o: any) => o.fieldName === "parentRowNumber" && o.overrideValue === String(milestoneRowNumber)
        );
        const ungroupOverrides: any[] = [];
        for (const co of childOverrides) {
          ungroupOverrides.push({
            projectName, rowNumber: co.rowNumber,
            fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
          });
          ungroupOverrides.push({
            projectName, rowNumber: co.rowNumber,
            fieldName: "indentLevel", overrideValue: "", createdBy: userId,
          });
        }
        ungroupOverrides.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "isDeleted", overrideValue: "true", createdBy: userId,
        });
        await storage.upsertManyProjectPlanOverrides(ungroupOverrides);
        notifyStructureChange(`Milestone deleted, ${childOverrides.length} task(s) ungrouped.`);
        return res.json({ message: "Milestone deleted and children ungrouped" });
      }

      if (operation === "setTaskNumber") {
        const { rowNumber, taskNumber } = data || {};
        if (rowNumber === undefined || taskNumber === undefined) {
          return res.status(400).json({ error: "rowNumber and taskNumber required" });
        }
        await storage.upsertManyProjectPlanOverrides([{
          projectName, rowNumber, fieldName: "taskNo",
          overrideValue: String(taskNumber), createdBy: userId,
        }]);
        notifyStructureChange(`Task number manually set to "${taskNumber}".`);
        return res.json({ message: "Task number updated" });
      }

      if (operation === "bulkReorder") {
        const { items } = data || {};
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "items[] with {rowNumber, sortOrder, parentRowNumber?} required" });
        }
        const existingOverrides: any[] = [];
        const indentMap = new Map<number, number>();
        for (const o of existingOverrides) {
          if (o.fieldName === "indentLevel") {
            indentMap.set(o.rowNumber, parseInt(o.overrideValue || "0") || 0);
          }
        }
        const overridesToSave: any[] = [];
        for (const item of items) {
          overridesToSave.push({
            projectName, rowNumber: item.rowNumber,
            fieldName: "sortOrder", overrideValue: String(item.sortOrder), createdBy: userId,
          });
          if (item.parentRowNumber !== undefined) {
            const parentIndent = item.parentRowNumber !== null ? (indentMap.get(item.parentRowNumber) ?? 0) : -1;
            const newIndent = parentIndent + 1;
            overridesToSave.push({
              projectName, rowNumber: item.rowNumber,
              fieldName: "parentRowNumber", overrideValue: item.parentRowNumber !== null ? String(item.parentRowNumber) : "", createdBy: userId,
            });
            overridesToSave.push({
              projectName, rowNumber: item.rowNumber,
              fieldName: "indentLevel", overrideValue: String(Math.max(0, newIndent)), createdBy: userId,
            });
          }
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${items.length} task(s) reordered.`);
        return res.json({ message: `Reordered ${items.length} tasks` });
      }

      if (operation === "renumber") {
        const plansDirect2 = await storage.getProjectPlansByProject(rawProjectName);
        const pName2 = plansDirect2.length > 0 ? rawProjectName : trackerName;
        const rawPlanTasks = plansDirect2.length > 0 ? plansDirect2 : await storage.getProjectPlansByProject(trackerName);
        const planTasks = rawPlanTasks;

        const SECTION_HEADER_TITLES = ["high level programme", "programme", "high level program"];
        const tasks2 = planTasks
          .filter((pt: any) => {
            if (pt.isVirtual) return true;
            const title = (pt.highLevelProgramme || "").trim().toLowerCase();
            return title && !SECTION_HEADER_TITLES.includes(title);
          })
          .map((pt: any) => ({
            rowNumber: pt.rowNumber,
            parentRowNumber: pt.parentRowNumber || null,
            taskNo: pt.taskNo || null,
            sortOrder: pt.sortOrder ?? pt.rowNumber ?? 0,
            isVirtual: pt.isVirtual === true,
          }));

        const hasAnyParentOverrides = tasks2.some(t => t.parentRowNumber != null);

        if (!hasAnyParentOverrides) {
          const taskNoSet = new Set(tasks2.map(t => t.taskNo).filter(Boolean));
          const taskNoToRow = new Map<string, number>();
          for (const t of tasks2) {
            if (t.taskNo) taskNoToRow.set(t.taskNo, t.rowNumber);
          }
          for (const t of tasks2) {
            if (!t.taskNo || !t.taskNo.includes(".")) continue;
            const parts = t.taskNo.split(".");
            parts.pop();
            const parentNo = parts.join(".");
            if (parentNo && taskNoSet.has(parentNo) && taskNoToRow.has(parentNo)) {
              t.parentRowNumber = taskNoToRow.get(parentNo)!;
            }
          }
        }

        const childMap = new Map<number | null, any[]>();
        for (const t of tasks2) {
          const parent = t.parentRowNumber;
          if (!childMap.has(parent)) childMap.set(parent, []);
          childMap.get(parent)!.push(t);
        }
        for (const [, children] of childMap) {
          children.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }

        const overridesToSave: any[] = [];
        const assignNumbers = (parentRn: number | null, prefix: string) => {
          const children = childMap.get(parentRn) || [];
          children.forEach((child: any, idx: number) => {
            const num = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
            overridesToSave.push({
              projectName: pName2, rowNumber: child.rowNumber,
              fieldName: "taskNo", overrideValue: num, createdBy: userId,
            });
            assignNumbers(child.rowNumber, num);
          });
        };
        assignNumbers(null, "");

        if (overridesToSave.length > 0) {
          await storage.upsertManyProjectPlanOverrides(overridesToSave);
        }
        return res.json({ message: `Renumbered ${overridesToSave.length} tasks` });
      }

      if (operation === "convertToMilestoneWI") {
        const { workItemId, subtaskWorkItemIds } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });

        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        // TODO(EE-QA-011): move this db.transaction + inline tx repo into
        // WorkManagementRepository.runConversionTransaction; not lint-blocked
        // today (rule scope is db.{select,insert,update,delete} only).
        try {
          await db.transaction(async (tx: any) => {
            const repo = {
              getById: async (id: number) => {
                const rows = await tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(eq(workItems.id, id)).limit(1);
                return rows[0] || null;
              },
              listByIds: async (ids: number[]) => {
                if (!ids.length) return [];
                return tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(inArray(workItems.id, ids));
              },
              patchById: async (id: number, patch: any) => {
                await tx.update(workItems).set(patch).where(eq(workItems.id, id));
              },
            };

            await convertWorkItemTypeInPlace({
              repo,
              workItemId,
              target: "milestone",
              projectId,
              subtaskWorkItemIds,
            });
          });
        } catch (err: any) {
          if (err instanceof WorkItemConversionError) {
            // eslint-disable-next-line no-restricted-syntax -- intentional: WorkItemConversionError carries a user-authored business message
            return res.status(err.status).json({ error: err.message });
          }
          throw err;
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          action: "convert_to_milestone",
          entityId: String(workItemId),
          changesJson: {
            projectName: rawProjectName,
            subtaskWorkItemIds: Array.isArray(subtaskWorkItemIds) ? subtaskWorkItemIds : [],
            conversion: "in_place",
          },
        });

        notifyStructureChange(`Task converted to milestone.`);
        return res.json({ message: "Converted to milestone" });
      }

      if (operation === "convertToTaskWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });

        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        // TODO(EE-QA-011): see convertToMilestoneWI — same transaction-driven
        // inline repo, same follow-up to lift into WorkManagementRepository.
        try {
          await db.transaction(async (tx: any) => {
            const repo = {
              getById: async (id: number) => {
                const rows = await tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(eq(workItems.id, id)).limit(1);
                return rows[0] || null;
              },
              listByIds: async () => [],
              patchById: async (id: number, patch: any) => {
                await tx.update(workItems).set(patch).where(eq(workItems.id, id));
              },
            };

            await convertWorkItemTypeInPlace({
              repo,
              workItemId,
              target: "task",
              projectId,
            });
          });
        } catch (err: any) {
          if (err instanceof WorkItemConversionError) {
            // eslint-disable-next-line no-restricted-syntax -- intentional: WorkItemConversionError carries a user-authored business message
            return res.status(err.status).json({ error: err.message });
          }
          throw err;
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          action: "convert_to_task",
          entityId: String(workItemId),
          changesJson: {
            projectName: rawProjectName,
            conversion: "in_place",
          },
        });

        notifyStructureChange(`Milestone converted to regular task.`);
        return res.json({ message: "Converted to task" });
      }

      if (operation === "indentWI") {
        const { workItemId, parentWorkItemId } = data || {};
        if (!workItemId || !parentWorkItemId) return res.status(400).json({ error: "workItemId and parentWorkItemId required" });
        if (workItemId === parentWorkItemId) return res.status(400).json({ error: "Cannot indent a task under itself" });
        const parentIndent = await workManagementRepository.getIndentLevel(parentWorkItemId);
        await workManagementRepository.setParentAndIndent(workItemId, parentWorkItemId, parentIndent + 1);
        await workManagementRepository.markAsMilestoneIfNot(parentWorkItemId);
        notifyStructureChange(`Task indented under parent.`);
        return res.json({ message: "Task indented" });
      }

      if (operation === "outdentWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });
        await workManagementRepository.clearParent(workItemId);
        notifyStructureChange(`Task outdented to top level.`);
        return res.json({ message: "Task outdented" });
      }

      if (operation === "setParentWI") {
        const { workItemIds, parentWorkItemId } = data || {};
        if (!Array.isArray(workItemIds) || parentWorkItemId === undefined) {
          return res.status(400).json({ error: "workItemIds[] and parentWorkItemId required" });
        }
        const safeIds = workItemIds.filter((id: number) => id !== parentWorkItemId);
        if (safeIds.length === 0) return res.status(400).json({ error: "No valid tasks after excluding parent" });
        await workManagementRepository.setParentBatch(parentWorkItemId, safeIds);
        notifyStructureChange(`${safeIds.length} task(s) grouped under parent.`);
        return res.json({ message: `${safeIds.length} tasks grouped` });
      }

      if (operation === "removeParentWI") {
        const { workItemIds } = data || {};
        if (!Array.isArray(workItemIds)) return res.status(400).json({ error: "workItemIds[] required" });
        for (const wiId of workItemIds) {
          await workManagementRepository.clearParent(wiId);
        }
        notifyStructureChange(`${workItemIds.length} task(s) ungrouped.`);
        return res.json({ message: `${workItemIds.length} tasks ungrouped` });
      }

      if (operation === "reorderWI") {
        const { items } = data || {};
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "items[] with {workItemId, sortOrder} required" });
        }
        await workManagementRepository.setSortOrders(
          items.map((item: { workItemId: number; sortOrder: number }) => ({ id: item.workItemId, sortOrder: item.sortOrder }))
        );
        notifyStructureChange(`${items.length} task(s) reordered.`);
        return res.json({ message: `Reordered ${items.length} tasks` });
      }

      if (operation === "renumberWI") {
        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        const allItems = await workManagementRepository.listPmWbsTree(projectId);

        const childMap = new Map<number | null, typeof allItems>();
        for (const item of allItems) {
          const parent = item.parentId ?? null;
          if (!childMap.has(parent)) childMap.set(parent, []);
          childMap.get(parent)!.push(item);
        }

        const updates: Array<{ id: number; wbsCode: string; indentLevel: number }> = [];
        const assignWbs = (parentId: number | null, prefix: string, depth: number) => {
          const children = childMap.get(parentId) || [];
          children.forEach((child, idx: number) => {
            const num = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
            updates.push({ id: child.id, wbsCode: num, indentLevel: depth });
            assignWbs(child.id, num, depth + 1);
          });
        };
        assignWbs(null, "", 0);

        await workManagementRepository.applyWbsRenumber(updates);
        notifyStructureChange(`WBS renumbered for ${updates.length} tasks.`);
        return res.json({ message: `Renumbered ${updates.length} tasks` });
      }

      if (operation === "deleteMilestoneWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });
        await workManagementRepository.clearParentByParentId(workItemId);
        await workManagementRepository.softDeleteWorkItem(workItemId);
        notifyStructureChange(`Milestone deleted and children ungrouped.`);
        return res.json({ message: "Milestone deleted and children ungrouped" });
      }

      if (operation === "setBaselineWI") {
        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });
        const n = await workManagementRepository.captureBaseline(projectId);
        notifyStructureChange(`Baseline captured for ${n} task(s).`);
        return res.json({ message: `Baseline set for ${n} tasks`, count: n });
      }

      logAuditFromReq(req, { entityType: "plan_structure", action: "update", projectName: rawProjectName, changesJson: { description: `Plan structure operation: ${operation}`, operation, projectName: rawProjectName } });
      return res.status(400).json({ error: `Unknown operation: ${operation}` });
    } catch (error: any) {
      console.error("[plan-structure] Error:", error);
      res.status(500).json({ error: "Failed to update plan structure" });
    }
  });

  app.post("/api/project-plan/delete-tasks", requireAuth, requirePermission('pd_plan', 'edit'), async (req, res) => {
    try {
      const { projectName, rowNumbers } = req.body;
      if (!projectName || !Array.isArray(rowNumbers) || rowNumbers.length === 0) {
        return res.status(400).json({ error: "projectName and rowNumbers[] required" });
      }
      const userId = (req as any).user?.id || (req as any).jwtPayload?.userId || null;
      const overrides = rowNumbers.map((rn: number) => ({
        projectName,
        rowNumber: rn,
        fieldName: "isDeleted",
        overrideValue: "true",
        createdBy: userId,
      }));
      await storage.upsertManyProjectPlanOverrides(overrides);

      logAuditFromReq(req, { entityType: "plan_task", action: "delete", projectName, changesJson: { description: `${rowNumbers.length} task(s) deleted from plan`, rowNumbers } });
      res.json({ message: `Deleted ${rowNumbers.length} task(s)` });
    } catch (error) {
      console.error("[PlanDelete] Error:", error);
      res.status(500).json({ error: "Failed to delete plan tasks" });
    }
  });
}
