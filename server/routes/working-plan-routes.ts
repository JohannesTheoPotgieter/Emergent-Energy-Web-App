// @ts-nocheck — TODO: fix 20 type errors then remove this directive
// Error breakdown: TS7006 implicit-any: 12, TS2345 query/param types: 8, other: 0
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { workItems } from "@shared/schema";
import { calculateCPM, applyOverridesToTasks, applyOverridesToDependencies } from "../cpmEngine";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";

export function registerWorkingPlanRoutes(app: Express) {
  // ==================== PROJECT PLAN SCHEDULING API ====================

  // Get working plan with CPM calculation for a project
  app.get("/api/projects/:projectName/working-plan", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      // Get or create active scenario
      const scenario = await storage.getOrCreateActiveScenario(decodedName);

      // Get base tasks from work_items (PM/SMART_IMPORT)
      const baseTasks = await storage.getProjectPlansByProject(decodedName);

      // Get task overrides
      const taskOverrides = await storage.getTaskOverridesByScenario(scenario.id);

      // Apply overrides to get working tasks
      const workingTasks = applyOverridesToTasks(
        baseTasks.map(t => ({
          id: t.id,
          taskNo: t.taskNo,
          name: t.highLevelProgramme,
          startDate: t.actualStart,
          endDate: t.actualEnd,
          type: null,
          percentComplete: t.actualPctComplete ?? null,
          isBaseline: true,
        })),
        taskOverrides
      );

      // Get base dependencies
      const baseDeps = await storage.getDependenciesByProject(decodedName);

      // Get dependency overrides
      const depOverrides = await storage.getDependencyOverridesByScenario(scenario.id);

      // Apply dependency overrides
      const workingDeps = applyOverridesToDependencies(
        baseDeps.map(d => ({
          id: d.id,
          predecessorTaskId: d.predecessorTaskId,
          successorTaskId: d.successorTaskId,
          dependencyType: d.dependencyType,
          lagDays: d.lagDays,
        })),
        depOverrides
      );

      // Calculate CPM
      const cpmResult = calculateCPM(workingTasks, workingDeps);

      // Get project info for key dates
      const projectInfo = await storage.getProjectInfo(decodedName);

      res.json({
        scenario,
        tasks: cpmResult.tasks,
        dependencies: workingDeps,
        criticalPath: cpmResult.criticalPath,
        projectFinish: cpmResult.projectFinish,
        hasCircularDependency: cpmResult.hasCircularDependency,
        warnings: cpmResult.warnings,
        keyDates: {
          pdHandoverDate: projectInfo?.pdHandoverDate || null,
          constructionStartDate: projectInfo?.constructionStartDate || null,
          commissioningDate: projectInfo?.commissioningDate || null,
          omHandoverDate: projectInfo?.omHandoverDate || null,
          clientHandoverDate: projectInfo?.clientHandoverDate || null,
        },
        overrideCounts: {
          taskOverrides: taskOverrides.filter(o => o.deletedFlag !== 1).length,
          dependencyOverrides: depOverrides.filter(o => o.deletedFlag !== 1).length,
        },
      });
    } catch (error: any) {
      console.error("Error getting working plan:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Reset working plan to baseline
  app.post("/api/projects/:projectName/working-plan/reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      const scenario = await storage.getActiveScenario(decodedName);
      if (scenario) {
        await storage.resetScenario(scenario.id);
      }

      logAuditFromReq(req, { entityType: "working_plan", action: "reset", projectName, changesJson: { description: "Working plan reset to baseline" } });
      res.json({ success: true, message: "Working plan reset to baseline" });
    } catch (error: any) {
      console.error("Error resetting working plan:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Update a task in working plan
  app.patch("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { taskId } = req.params;
      const { projectName, startDate, endDate, name, taskNo, comment, percentComplete } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);

      const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
      const existing = existingOverrides.find(o => o.importedTaskId === id);

      let result;
      if (existing) {
        result = await storage.updateTaskOverride(existing.id, {
          overrideStartDate: startDate || existing.overrideStartDate,
          overrideEndDate: endDate || existing.overrideEndDate,
          overrideName: name || existing.overrideName,
          overrideTaskNo: taskNo || existing.overrideTaskNo,
          overrideComment: comment || existing.overrideComment,
        });
      } else {
        result = await storage.createTaskOverride({
          scenarioId: scenario.id,
          importedTaskId: id,
          overrideStartDate: startDate || null,
          overrideEndDate: endDate || null,
          overrideName: name || null,
          overrideTaskNo: taskNo || null,
          overrideComment: comment || null,
          deletedFlag: 0,
          isNewTask: 0,
        });
      }

      if (percentComplete !== undefined && percentComplete !== null) {
        const parsed = parseInt(String(percentComplete));
        if (isNaN(parsed) || parsed < 0 || parsed > 100) {
          return res.status(400).json({ error: "BAD_REQUEST", message: "percentComplete must be between 0 and 100" });
        }
        const pctVal = parsed / 100;
        try {
          const result = await db.update(workItems).set({ percentComplete: pctVal }).where(
            and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, id))
          ).returning({ id: workItems.id });
          if (result.length === 0) {
            const wiByProject = await db.execute(sql`
              SELECT wi.id, wi.title, pi.project_name
              FROM work_items wi
              JOIN project_info pi ON wi.project_id = pi.id
              WHERE wi.legacy_table = 'project_plan' AND wi.legacy_id = ${id} AND wi.deleted_at IS NULL
              LIMIT 1
            `);
            if (wiByProject.rows.length > 0) {
              await db.update(workItems).set({ percentComplete: pctVal }).where(
                eq(workItems.id, (wiByProject.rows[0] as any).id)
              );
            }
          }
        } catch (e) {
          console.warn(`[working-plan] Failed to sync percentComplete to work_items for task ${id}:`, e);
        }
      }

      logAuditFromReq(req, { entityType: "working_plan_task", action: "update", entityId: String(id), projectName, changesJson: { description: "Working plan task updated", startDate, endDate, name, taskNo } });
      res.json(result);

      try {
        // Notifications feature removed - financial impact notification inserts are now no-ops
      } catch (crossErr: any) {
        console.warn("[fin-cross] Plan-to-financial notification failed:", crossErr.message);
      }
    } catch (error: any) {
      console.error("Error updating task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create new task in working plan
  app.post("/api/working-plan/tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, startDate, endDate, name, taskNo } = req.body;

      if (!projectName || !startDate || !endDate || !name) {
        return res.status(400).json({ 
          error: "validation_error", 
          message: "projectName, startDate, endDate, and name are required" 
        });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);

      const created = await storage.createTaskOverride({
        scenarioId: scenario.id,
        importedTaskId: null,
        overrideStartDate: startDate,
        overrideEndDate: endDate,
        overrideName: name,
        overrideTaskNo: taskNo || null,
        overrideComment: null,
        deletedFlag: 0,
        isNewTask: 1,
      });

      logAuditFromReq(req, { entityType: "working_plan_task", action: "create", projectName, changesJson: { description: "Working plan task created", name, startDate, endDate } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  app.post("/api/projects/:projectName/working-plan/renumber-wbs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const scenario = await storage.getOrCreateActiveScenario(decodedName);
      const baseTasks = await storage.getProjectPlansByProject(decodedName);
      const taskOverrides = await storage.getTaskOverridesByScenario(scenario.id);
      const workingTasks = applyOverridesToTasks(
        baseTasks.map(t => ({
          id: t.id,
          taskNo: t.taskNo,
          name: t.highLevelProgramme,
          startDate: t.actualStart,
          endDate: t.actualEnd,
          type: null,
          percentComplete: t.actualPctComplete ?? null,
          isBaseline: true,
        })),
        taskOverrides
      );

      let wbsNum = 1;
      for (const task of workingTasks) {
        const newWbs = String(wbsNum);
        const absId = Math.abs(task.id);
        if (task.id < 0) {
          const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
          const existing = existingOverrides.find(o => o.id === absId && o.isNewTask === 1);
          if (existing) {
            await storage.updateTaskOverride(existing.id, { overrideTaskNo: newWbs });
          }
        } else {
          const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
          const existing = existingOverrides.find(o => o.importedTaskId === task.id);
          if (existing) {
            await storage.updateTaskOverride(existing.id, { overrideTaskNo: newWbs });
          } else {
            await storage.createTaskOverride({
              scenarioId: scenario.id,
              importedTaskId: task.id,
              overrideStartDate: null,
              overrideEndDate: null,
              overrideName: null,
              overrideTaskNo: newWbs,
              overrideComment: null,
              deletedFlag: 0,
              isNewTask: 0,
            });
          }
        }
        wbsNum++;
      }

      logAuditFromReq(req, { entityType: "working_plan", action: "renumber_wbs", projectName: decodedName, changesJson: { totalTasks: workingTasks.length } });
      res.json({ success: true, totalRenamed: workingTasks.length });
    } catch (error: any) {
      console.error("Error renumbering WBS:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete task from working plan (soft delete)
  app.delete("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { taskId } = req.params;
      const { projectName, isBaseline, isNewTask } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);
      const absId = Math.abs(id);
      const isImported = isBaseline === true || id < 0;

      if (isImported) {
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find(o => o.importedTaskId === absId);

        if (existing) {
          await storage.softDeleteTaskOverride(existing.id);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: absId,
            overrideStartDate: null,
            overrideEndDate: null,
            overrideName: null,
            overrideTaskNo: null,
            overrideComment: null,
            deletedFlag: 1,
            isNewTask: 0,
          });
        }
      } else {
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existingOverride = existingOverrides.find(o => o.id === absId && o.isNewTask === 1);
        if (existingOverride) {
          await storage.softDeleteTaskOverride(existingOverride.id);
        } else {
          // GC-002: Use soft-delete instead of hard-delete for data recovery
          await db.update(workItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(workItems.id, absId));
        }
      }

      logAuditFromReq(req, { entityType: "working_plan_task", action: "delete", entityId: taskId, projectName, changesJson: { description: "Working plan task deleted", isImported } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create dependency
  app.post("/api/projects/:projectName/dependencies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const { predecessorTaskId, successorTaskId, dependencyType, lagDays } = req.body;

      if (!predecessorTaskId || !successorTaskId) {
        return res.status(400).json({ 
          error: "validation_error", 
          message: "predecessorTaskId and successorTaskId are required" 
        });
      }

      const predId = parseInt(predecessorTaskId);
      const succId = parseInt(successorTaskId);

      if (predId === succId) {
        return res.status(400).json({
          error: "validation_error",
          message: "A task cannot depend on itself"
        });
      }

      const validTypes = ["FS", "SS", "FF", "SF"];
      const depType = dependencyType || "FS";
      if (!validTypes.includes(depType)) {
        return res.status(400).json({
          error: "validation_error",
          message: "Invalid dependency type. Must be FS, SS, FF, or SF"
        });
      }

      const lag = parseInt(lagDays) || 0;
      if (lag < -365 || lag > 365) {
        return res.status(400).json({
          error: "validation_error",
          message: "Lag days must be between -365 and 365"
        });
      }

      const existingDeps = await storage.getDependenciesByProject(decodedName);
      
      const visited = new Set<number>();
      const checkCycle = (taskId: number, target: number): boolean => {
        if (taskId === target) return true;
        if (visited.has(taskId)) return false;
        visited.add(taskId);
        
        const successorDeps = existingDeps.filter(d => d.predecessorTaskId === taskId);
        for (const dep of successorDeps) {
          if (checkCycle(dep.successorTaskId, target)) return true;
        }
        return false;
      };
      
      if (checkCycle(succId, predId)) {
        return res.status(400).json({
          error: "validation_error",
          message: "This dependency would create a circular reference"
        });
      }

      const created = await storage.createDependency({
        projectName: decodedName,
        predecessorTaskId: predId,
        successorTaskId: succId,
        dependencyType: depType,
        lagDays: lag,
      });

      logAuditFromReq(req, { entityType: "dependency", action: "create", entityId: String(created.id), projectName: decodedName, changesJson: { description: "Dependency created", predecessorTaskId: predId, successorTaskId: succId, dependencyType: depType, lagDays: lag } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete dependency
  app.delete("/api/dependencies/:depId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const depId = parseInt(req.params.depId);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });
      await storage.deleteDependency(depId);
      logAuditFromReq(req, { entityType: "dependency", action: "delete", entityId: depId, changesJson: { description: "Dependency deleted" } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Get schedule change notices
  app.get("/api/projects/:projectName/change-notices", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const notices = await storage.getChangeNoticesByProject(decodedName);
      res.json(notices);
    } catch (error: any) {
      console.error("Error getting change notices:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create schedule change notice
  app.post("/api/projects/:projectName/change-notices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const { summary, oldFinishDate, newFinishDate, changedTasks, criticalPathDelta, userNote, createdBy } = req.body;

      if (!summary) {
        return res.status(400).json({ error: "validation_error", message: "summary is required" });
      }

      const created = await storage.createChangeNotice({
        projectName: decodedName,
        summary,
        oldFinishDate: oldFinishDate || null,
        newFinishDate: newFinishDate || null,
        changedTasks: changedTasks || null,
        criticalPathDelta: criticalPathDelta || null,
        userNote: userNote || null,
        clientNotified: 0,
        documentationUpdated: 0,
        createdBy: createdBy || null,
      });

      logAuditFromReq(req, { entityType: "change_notice", action: "create", entityId: String(created.id), projectName: decodedName, changesJson: { description: "Change notice created", summary, oldFinishDate, newFinishDate, criticalPathDelta } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating change notice:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Update schedule change notice (mark as notified/documented)
  app.patch("/api/change-notices/:noticeId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const noticeId = parseInt(req.params.noticeId);
      if (isNaN(noticeId)) return res.status(400).json({ error: "Invalid notice ID" });
      const { clientNotified, documentationUpdated, userNote } = req.body;

      const updated = await storage.updateChangeNotice(noticeId, {
        clientNotified: clientNotified !== undefined ? clientNotified : undefined,
        documentationUpdated: documentationUpdated !== undefined ? documentationUpdated : undefined,
        userNote: userNote !== undefined ? userNote : undefined,
      });

      if (!updated) {
        return res.status(404).json({ error: "not_found", message: "Change notice not found" });
      }

      logAuditFromReq(req, { entityType: "change_notice", action: "update", entityId: noticeId, changesJson: { description: "Change notice updated", clientNotified, documentationUpdated, userNote } });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating change notice:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });
}
