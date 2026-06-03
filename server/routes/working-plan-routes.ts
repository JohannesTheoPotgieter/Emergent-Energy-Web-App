// Error breakdown: TS7006 implicit-any: 12, TS2345 query/param types: 8, other: 0
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { workItems, workItemDependencies, projectInfo } from "@shared/schema";
import { calculateCPM, applyOverridesToTasks, applyOverridesToDependencies } from "../cpmEngine";
import { computeReschedule } from "../lib/reschedule-engine";
import { WorkManagementRepository } from "../repositories/work-management-repository";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { paramStr, parseIntParam } from "../lib/req-params";

const workManagementRepository = new WorkManagementRepository();

export function registerWorkingPlanRoutes(app: Express) {
  // ==================== PROJECT PLAN SCHEDULING API ====================

  // Get working plan with CPM calculation for a project
  app.get("/api/projects/:projectName/working-plan", requireAuth, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
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
          pdHandoverDate: (projectInfo as any)?.pdHandoverDate || null,
          constructionStartDate: (projectInfo as any)?.constructionStartDate || null,
          commissioningDate: (projectInfo as any)?.commissioningDate || null,
          omHandoverDate: (projectInfo as any)?.omHandoverDate || null,
          clientHandoverDate: (projectInfo as any)?.clientHandoverDate || null,
        },
        overrideCounts: {
          taskOverrides: taskOverrides.filter((o: any) => o.deletedFlag !== 1).length,
          dependencyOverrides: depOverrides.filter((o: any) => o.deletedFlag !== 1).length,
        },
      });
    } catch (error: any) {
      console.error("Error getting working plan:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Critical path on the CANONICAL plan (work_items + work_item_dependencies).
  // The legacy /working-plan route reads the deprecated projectPlanDependency
  // table (now empty), so its critical path is always empty; this endpoint runs
  // CPM on the same data the live Gantt shows. Computed on LEAF tasks only —
  // summary/parent rows are roll-ups, not schedulable.
  app.get(
    "/api/projects/:projectName/critical-path",
    requireAuth,
    requirePermission("pd_plan", "view"),
    async (req, res) => {
      try {
        const projectName = decodeURIComponent(paramStr(req.params.projectName));
        const empty = {
          criticalTaskIds: [] as number[],
          slackById: {} as Record<number, number>,
          projectFinish: 0,
          hasCircularDependency: false,
          warnings: [] as string[],
        };
        const piRow = await db
          .select({ id: projectInfo.id })
          .from(projectInfo)
          .where(eq(projectInfo.projectName, projectName))
          .limit(1);
        if (piRow.length === 0) return res.json(empty);

        const rows = await db
          .select({
            id: workItems.id,
            wbsCode: workItems.wbsCode,
            title: workItems.title,
            startDate: workItems.startDate,
            endDate: workItems.endDate,
            type: workItems.type,
            percentComplete: workItems.percentComplete,
            parentId: workItems.parentId,
          })
          .from(workItems)
          .where(and(
            eq(workItems.projectId, piRow[0].id),
            eq(workItems.workstream, "PM"),
            eq(workItems.source, "SMART_IMPORT"),
            isNull(workItems.deletedAt),
          ));
        if (rows.length === 0) return res.json(empty);

        // Leaf tasks only — a row that is some other row's parent is a summary.
        type PlanRow = (typeof rows)[number];
        const parentIds = new Set(
          rows.map((r: PlanRow) => r.parentId).filter((p: number | null): p is number => p != null),
        );
        const leaves = rows.filter((r: PlanRow) => !parentIds.has(r.id));
        const leafIds = new Set(leaves.map((r: PlanRow) => r.id));

        const allIds = rows.map((r: PlanRow) => r.id);
        const depRows = allIds.length
          ? await db
              .select({
                id: workItemDependencies.id,
                predecessorId: workItemDependencies.predecessorId,
                successorId: workItemDependencies.successorId,
                depType: workItemDependencies.depType,
                lagDays: workItemDependencies.lagDays,
              })
              .from(workItemDependencies)
              .where(and(
                inArray(workItemDependencies.predecessorId, allIds),
                isNull(workItemDependencies.deletedAt),
              ))
          : [];

        type DepRow = (typeof depRows)[number];
        const cpm = calculateCPM(
          leaves.map((r: PlanRow) => ({
            id: r.id,
            taskNo: r.wbsCode,
            name: r.title,
            // primary date = actual ?? planned (set by the importer) — the same
            // dates the Gantt renders.
            startDate: r.startDate,
            endDate: r.endDate,
            type: r.type,
            percentComplete: r.percentComplete,
          })),
          depRows
            .filter((d: DepRow) => leafIds.has(d.predecessorId) && leafIds.has(d.successorId))
            .map((d: DepRow) => ({
              id: d.id,
              predecessorTaskId: d.predecessorId,
              successorTaskId: d.successorId,
              dependencyType: d.depType || "FS",
              lagDays: d.lagDays || 0,
            })),
        );

        const slackById: Record<number, number> = {};
        for (const t of cpm.tasks) slackById[t.id] = t.slack;
        res.json({
          criticalTaskIds: cpm.criticalPath,
          slackById,
          projectFinish: cpm.projectFinish,
          hasCircularDependency: cpm.hasCircularDependency,
          warnings: cpm.warnings,
        });
      } catch (error: any) {
        console.error("Error computing critical path:", error);
        res.status(500).json({ error: "server_error" });
      }
    },
  );

  // Auto-reschedule (Phase 2): reflow successor dates from dependencies on the
  // SA working calendar. Owner-chosen behaviour: PREVIEW by default (returns
  // proposed changes, writes nothing); commit only when { commit: true }.
  // Manually-dated tasks (a startDate/endDate manual override) are anchored —
  // never moved — so it respects hand-set dates. Commit writes the computed
  // dates to columns (not overrides) so auto tasks stay re-flowable.
  app.post(
    "/api/projects/:projectName/reschedule",
    requireAuth,
    requirePermission("pd_plan", "edit"),
    async (req, res) => {
      try {
        const projectName = decodeURIComponent(paramStr(req.params.projectName));
        const commit = req.body?.commit === true || req.query.commit === "true";
        const piRow = await db
          .select({ id: projectInfo.id })
          .from(projectInfo)
          .where(eq(projectInfo.projectName, projectName))
          .limit(1);
        const empty = { changes: [], hasCircularDependency: false, warnings: [] as string[], applied: 0 };
        if (piRow.length === 0) return res.json(empty);

        const rows = await db
          .select({
            id: workItems.id,
            wbsCode: workItems.wbsCode,
            title: workItems.title,
            startDate: workItems.startDate,
            endDate: workItems.endDate,
            duration: workItems.duration,
            parentId: workItems.parentId,
            manualOverrides: workItems.manualOverrides,
          })
          .from(workItems)
          .where(and(
            eq(workItems.projectId, piRow[0].id),
            eq(workItems.workstream, "PM"),
            eq(workItems.source, "SMART_IMPORT"),
            isNull(workItems.deletedAt),
          ));
        if (rows.length === 0) return res.json(empty);

        type Row = (typeof rows)[number];
        const parentIds = new Set(
          rows.map((r: Row) => r.parentId).filter((p: number | null): p is number => p != null),
        );
        const leaves = rows.filter((r: Row) => !parentIds.has(r.id));
        const leafIds = new Set(leaves.map((r: Row) => r.id));
        const allIds = rows.map((r: Row) => r.id);

        const depRows = allIds.length
          ? await db
              .select({
                predecessorId: workItemDependencies.predecessorId,
                successorId: workItemDependencies.successorId,
                depType: workItemDependencies.depType,
                lagDays: workItemDependencies.lagDays,
              })
              .from(workItemDependencies)
              .where(and(
                inArray(workItemDependencies.predecessorId, allIds),
                isNull(workItemDependencies.deletedAt),
              ))
          : [];
        type DRow = (typeof depRows)[number];

        const result = computeReschedule(
          leaves.map((r: Row) => {
            const mo = r.manualOverrides as Record<string, unknown> | null;
            // A startDate/endDate manual override means the user set this date
            // by hand — anchor it (respect manual dates).
            const isFixed = !!(mo && typeof mo === "object" && ((mo as any).startDate || (mo as any).endDate));
            return {
              id: r.id,
              taskNo: r.wbsCode,
              name: r.title,
              startDate: r.startDate,
              endDate: r.endDate,
              durationDays: r.duration,
              isFixed,
            };
          }),
          depRows
            .filter((d: DRow) => leafIds.has(d.predecessorId) && leafIds.has(d.successorId))
            .map((d: DRow) => ({
              predecessorTaskId: d.predecessorId,
              successorTaskId: d.successorId,
              dependencyType: d.depType || "FS",
              lagDays: d.lagDays || 0,
            })),
        );

        let applied = 0;
        if (commit && result.changes.length > 0 && !result.hasCircularDependency) {
          applied = await workManagementRepository.applyRescheduleDates(
            result.changes.map((c) => ({ id: c.id, startDate: c.newStart, endDate: c.newEnd })),
          );
          logAuditFromReq(req, {
            entityType: "plan_reschedule",
            action: "update",
            projectName,
            changesJson: { description: `Auto-reschedule applied to ${applied} task(s)`, count: applied },
          });
        }
        res.json({ ...result, applied });
      } catch (error: any) {
        console.error("Error rescheduling:", error);
        res.status(500).json({ error: "server_error" });
      }
    },
  );

  // Reset working plan to baseline
  app.post("/api/projects/:projectName/working-plan/reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
      const decodedName = decodeURIComponent(projectName);

      const scenario = await storage.getActiveScenario(decodedName);
      if (scenario) {
        await storage.resetScenario(scenario.id);
      }

      logAuditFromReq(req, { entityType: "working_plan", action: "reset", projectName, changesJson: { description: "Working plan reset to baseline" } });
      res.json({ success: true, message: "Working plan reset to baseline" });
    } catch (error: any) {
      console.error("Error resetting working plan:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Update a task in working plan
  app.patch("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const taskId = paramStr(req.params.taskId);
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
      res.status(500).json({ error: "server_error" });
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
      res.status(500).json({ error: "server_error" });
    }
  });

  app.post("/api/projects/:projectName/working-plan/renumber-wbs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
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
      res.status(500).json({ error: "server_error" });
    }
  });

  // Delete task from working plan (soft delete)
  app.delete("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const taskId = paramStr(req.params.taskId);
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
      res.status(500).json({ error: "server_error" });
    }
  });

  // Create dependency
  app.post("/api/projects/:projectName/dependencies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
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
      res.status(500).json({ error: "server_error" });
    }
  });

  // Delete dependency
  app.delete("/api/dependencies/:depId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const depId = parseIntParam(req.params.depId);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });
      await storage.deleteDependency(depId);
      logAuditFromReq(req, { entityType: "dependency", action: "delete", entityId: String(depId), changesJson: { description: "Dependency deleted" } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting dependency:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Get schedule change notices
  app.get("/api/projects/:projectName/change-notices", requireAuth, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
      const decodedName = decodeURIComponent(projectName);
      const notices = await storage.getChangeNoticesByProject(decodedName);
      res.json(notices);
    } catch (error: any) {
      console.error("Error getting change notices:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Create schedule change notice
  app.post("/api/projects/:projectName/change-notices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = paramStr(req.params.projectName);
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
      res.status(500).json({ error: "server_error" });
    }
  });

  // Update schedule change notice (mark as notified/documented)
  app.patch("/api/change-notices/:noticeId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const noticeId = parseIntParam(req.params.noticeId);
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

      logAuditFromReq(req, { entityType: "change_notice", action: "update", entityId: String(noticeId), changesJson: { description: "Change notice updated", clientNotified, documentationUpdated, userNote } });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating change notice:", error);
      res.status(500).json({ error: "server_error" });
    }
  });
}
