import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, or, sql, isNull, asc, desc, inArray } from "drizzle-orm";
import { projectInfo, workItems, workItemAssignments, notifications } from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { ApiError, sendError, badRequest, notFound, validationError, unauthorized, serverError, forbidden } from "../lib/api-error";
import { validateTaskCreate, validateTaskUpdate } from "../lib/task-validation";
import { normalizeStatus, normalizePriority } from "../lib/canonical-task-engine";
import { isWorkItemsEnabled, getAllWorkItemsForPlanTab, toCanonicalStatus } from "../work-items-adapter";
import { projectEngineeringTicket } from "@shared/lib/engineering-ticket-view";
import { softDeleteCanonicalWorkItemByLegacyTaskId } from "../canonical-boundaries";
import { runCascadesAfterUpdate, validateParentCompletion } from "../services/task-cascade-service";
import { queryStr, queryInt, paramStr, paramInt } from "../lib/req-parse";

// SA working days helpers (duplicated from routes.ts for self-containment)
function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const s = dateStr.substring(0, 10);
  return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
}

function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt);
      next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1); add(3, 21); add(4, 27); add(5, 1); add(6, 16);
  add(8, 9); add(9, 24); add(12, 16); add(12, 25); add(12, 26);
  const easter = computeEaster(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(formatDateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  const familyDay = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  familyDay.setUTCDate(familyDay.getUTCDate() + 1);
  holidays.add(formatDateKey(familyDay.getUTCFullYear(), familyDay.getUTCMonth() + 1, familyDay.getUTCDate()));
  return holidays;
}

function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

const holidayCacheByYear = new Map<number, Set<string>>();
function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!holidayCacheByYear.has(year)) {
    holidayCacheByYear.set(year, getSAPublicHolidays(year));
  }
  return holidayCacheByYear.get(year)!.has(dateStr);
}

function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (!startDateStr || !endDateStr || !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)) return null;
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

async function notifyWorkItemWatchers(params: {
  workItemId: number;
  actorUserId?: number;
  projectName: string;
  title: string;
  body: string;
  eventType?: string;
}) {
  try {
    const watcherRows = await db
      .select({ userId: workItemAssignments.userId })
      .from(workItemAssignments)
      .where(and(eq(workItemAssignments.workItemId, params.workItemId), eq(workItemAssignments.role, "VIEWER")));

    if (!watcherRows.length) return;

    for (const watcher of watcherRows) {
      if (params.actorUserId && watcher.userId === params.actorUserId) continue;
      await db.insert(notifications).values({
        recipientUserId: watcher.userId,
        eventType: params.eventType || "watcher_update",
        title: params.title,
        body: params.body,
        projectName: params.projectName,
        linkedTaskId: params.workItemId,
        changeDetails: JSON.stringify({ source: "watcher_notification", workItemId: params.workItemId }),
      });
    }
  } catch (error: any) {
    console.warn("[watcher-notify] Failed to notify watchers:", error?.message || error);
  }
}

export function registerPlanningTasksRoutes(app: Express) {
  // ==================== ENRICHED PLANNING TASKS (with rollups + expected %) ====================

  app.get("/api/planning-tasks/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(paramStr(req, "projectName"));

      const useCanonical = await isWorkItemsEnabled();

      let baselineTasks: any[] = [];
      let operationalTasks: any[] = [];
      let unlinkedOperationalCount = 0;
      let unlinkedOperationalRaw: any[] = [];

      if (useCanonical) {
        const canonicalTasks = await getAllWorkItemsForPlanTab(projectName);
        if (canonicalTasks.length > 0) {
          const allOps = await storage.getOperationalTasksByProject(projectName);
          const nonClickupOps = allOps.filter((t: any) => t.externalSource !== "clickup");
          unlinkedOperationalRaw = nonClickupOps.filter((t: any) => t.importedTaskId == null && t.linkedPlanItemId == null);
          unlinkedOperationalCount = unlinkedOperationalRaw.length;

          // Smart Import v2 tracker columns + cellFormat live on
          // work_items but the legacy adapter (work-items-adapter.ts) is
          // marked read-only and doesn't surface them. Pull a thin
          // tracker-fields lookup directly from work_items here so the
          // existing Plan tab can render lead / resource_1 / resource_2
          // / tracker_comments / work_days inline alongside per-cell
          // colours, without extending the legacy adapter.
          const trackerWorkItemRows = await db
            .select({
              id: workItems.id,
              lead: workItems.lead,
              resource1: workItems.resource1,
              resource2: workItems.resource2,
              trackerComments: workItems.trackerComments,
              workDays: workItems.workDays,
              cellFormat: workItems.cellFormat,
            })
            .from(workItems)
            .where(
              and(
                isNull(workItems.deletedAt),
                sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`,
              ),
            );
          const trackerByWorkItemId = new Map<number, {
            lead: string | null;
            resource1: string | null;
            resource2: string | null;
            trackerComments: string | null;
            workDays: number | null;
            cellFormat: unknown;
          }>(
            trackerWorkItemRows.map((row: any) => [row.id, {
              lead: row.lead ?? null,
              resource1: row.resource1 ?? null,
              resource2: row.resource2 ?? null,
              trackerComments: row.trackerComments ?? null,
              workDays: row.workDays ?? null,
              cellFormat: row.cellFormat ?? null,
            }]),
          );

          const filteredCanonical = canonicalTasks.filter((ct: any) => {
            const ws = ct.workstream || "PM";
            if (ws === "ENG" || ws === "QUALITY") return true;
            if (ct.isMilestone) return true;
            const hasWbs = ct.taskNo && String(ct.taskNo).trim().length > 0;
            const hasStart = ct.startDate && String(ct.startDate).trim().length > 0;
            const hasEnd = ct.endDate && String(ct.endDate).trim().length > 0;
            if (!hasWbs && !hasStart && !hasEnd) return false;
            return true;
          });

          const usedIds = new Set<number>();
          const isEngWorkstream = (ws?: string | null) => ws === "ENG" || ws === "QUALITY";
          baselineTasks = filteredCanonical.map((ct: any, idx: number) => {
            let taskId = Number.isFinite(ct.id) && ct.id > 0 ? ct.id : (idx + 1);
            while (usedIds.has(taskId)) taskId = taskId + 100000;
            usedIds.add(taskId);

            // Tracker fields keyed by the underlying work_items.id.
            // ct.workItemId is the canonical work_items row when present;
            // ct.id can be the legacyId so the lookup falls back through
            // both keys before defaulting to nulls.
            const trackerKey: number | undefined = (typeof ct.workItemId === "number" && ct.workItemId > 0)
              ? ct.workItemId
              : (typeof ct.id === "number" && ct.id > 0 ? ct.id : undefined);
            const tracker = trackerKey != null ? trackerByWorkItemId.get(trackerKey) : undefined;

            const rawPct = ct.pctComplete != null ? Number(ct.pctComplete) : 0;
            const pctComplete = rawPct > 1 ? Math.round(rawPct) : Math.round(rawPct * 100);
            // Prefer the canonical work_items.status the row already
            // carries (post-migration 20260413 lower_snake) instead of deriving
            // from %, so the Plan tab and Engineering Board show the same status
            // pill for the same row. Fall back to the % heuristic only when the
            // canonical row is missing a status (legacy plan-only rows).
            let status = ct.status ? toCanonicalStatus(ct.status) : "";
            if (!status || status === "not_started") {
              if (pctComplete >= 100) status = "complete";
              else if (pctComplete > 0) status = "in_progress";
              else status = status || "not_started";
            }

            let computedExpPct = 0;
            const tPlannedStart = (ct.startDate || "").substring(0, 10);
            const tPlannedEnd = (ct.endDate || "").substring(0, 10);
            const tActualStart = (ct.actualStartDate || "").substring(0, 10);
            const tActualEnd = (ct.actualEndDate || "").substring(0, 10);
            const tStart = tActualStart || tPlannedStart;
            const tEnd = tActualEnd || tPlannedEnd;
            if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
              const todayStr = new Date().toISOString().split("T")[0];
              if (todayStr >= tEnd) computedExpPct = 100;
              else if (todayStr <= tStart) computedExpPct = 0;
              else {
                const totalWd = saWorkingDays(tStart, tEnd);
                const elapsedWd = saWorkingDays(tStart, todayStr);
                if (totalWd && totalWd > 0 && elapsedWd !== null) {
                  computedExpPct = Math.round(Math.min(elapsedWd / totalWd, 1.0) * 100);
                }
              }
            }

            const ticketView = isEngWorkstream(ct.workstream)
              ? projectEngineeringTicket({
                  id: ct.id,
                  workItemId: ct.workItemId || taskId,
                  title: ct.taskName || `Task ${ct.taskNo || idx + 1}`,
                  description: ct.comment ?? null,
                  status,
                  projectId: ct.projectId ?? null,
                  projectName,
                  startDate: tPlannedStart || null,
                  endDate: tPlannedEnd || null,
                  dueDate: tPlannedEnd || null,
                  percentComplete: pctComplete,
                  expectedPctComplete: computedExpPct,
                  ownerName: Array.isArray(ct.assignees) ? (ct.assignees[0] ?? null) : null,
                  assignees: Array.isArray(ct.assignees) ? ct.assignees : null,
                })
              : null;

            return {
              id: -taskId,
              workItemId: ct.workItemId || taskId,
              projectName,
              planProjectName: projectName,
              importedTaskId: ct.id,
              ticketView,
              taskNumber: ct.taskNo || String(idx + 1),
              parentTaskId: null as number | null,
              parentWorkItemId: ct.parentWorkItemId || null,
              title: ct.taskName || `Task ${ct.taskNo || idx + 1}`,
              description: ct.comment || null,
              status,
              priority: "Normal",
              startDate: tPlannedStart || null,
              dueDate: tPlannedEnd || null,
              durationDays: ct.durationDays || ct.actualDurationDays || null,
              percentComplete: pctComplete,
              expectedPercentComplete: computedExpPct,
              storedActualPct: pctComplete,
              assignees: ct.assignees || null,
              tags: null,
              blockerReason: null,
              plannedHours: null,
              actualHours: null,
              actualStartDate: tActualStart || tPlannedStart || null,
              actualEndDate: tActualEnd || tPlannedEnd || null,
              actualDurationDays: ct.actualDurationDays || ct.durationDays || null,
              comment: ct.comment || null,
              sortOrder: ct.sortOrder ?? idx,
              isBaseline: true,
              isVirtualMilestone: false,
              isMilestone: ct.isMilestone === true,
              rowNumber: null,
              parentRowNumber: null,
              indentLevel: ct.indentLevel ?? null,
              baselineStart: ct.baselineStart || null,
              baselineEnd: ct.baselineEnd || null,
              baselineDuration: ct.baselineDuration || null,
              taskMode: ct.taskMode || "auto",
              workstream: ct.workstream || "PM",
              createdBy: null,
              createdAt: null,
              updatedAt: null,
              // Smart Import v2 tracker columns. See the trackerByWorkItemId
              // lookup above. Null when the row isn't in work_items.
              lead: tracker?.lead ?? null,
              resource1: tracker?.resource1 ?? null,
              resource2: tracker?.resource2 ?? null,
              trackerComments: tracker?.trackerComments ?? null,
              workDays: tracker?.workDays ?? null,
              cellFormat: tracker?.cellFormat ?? null,
            };
          });
        }
      }

      if (baselineTasks.length === 0) {
        const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";

        const [allOperationalTasks, planTasksDirect, planTasksTracker] = await Promise.all([
          storage.getOperationalTasksByProject(projectName),
          storage.getProjectPlansByProject(projectName),
          projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
        ]);

        const nonClickupOps = allOperationalTasks.filter((t: any) => t.externalSource !== "clickup");
        operationalTasks = nonClickupOps.filter((t: any) => t.importedTaskId != null || t.linkedPlanItemId != null);
        unlinkedOperationalRaw = nonClickupOps.filter((t: any) => t.importedTaskId == null && t.linkedPlanItemId == null);
        unlinkedOperationalCount = unlinkedOperationalRaw.length;

        const rawPlanTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;

        const planTasks = rawPlanTasks;

        const linkedImportedIds = new Set(
          operationalTasks
            .filter((t: any) => t.importedTaskId != null)
            .map((t: any) => t.importedTaskId)
        );

        const SECTION_HEADER_TITLES = ["high level programme", "programme", "high level program"];
        baselineTasks = planTasks
          .filter((pt: any) => !linkedImportedIds.has(pt.id))
          .filter((pt: any) => {
            if (pt.isVirtual) return true;
            const title = (pt.highLevelProgramme || "").trim().toLowerCase();
            return title && !SECTION_HEADER_TITLES.includes(title);
          })
          .map((pt: any) => {
            const pctComplete = pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : 0;
            // Emit canonical lower_snake to match the Engineering
            // Board / Standup wire format. The legacy plan rows here have no
            // canonical status of their own, so we still derive from %.
            let status = "not_started";
            if (pctComplete >= 100) status = "complete";
            else if (pctComplete > 0) status = "in_progress";

            let computedExpPct: number = pt.expectedPctComplete != null ? Math.round(pt.expectedPctComplete * 100) : 0;
            if (pt.expectedPctComplete == null && !pt.isVirtual) {
              const tStart = (pt.trueActualStart || pt.actualStart || "").substring(0, 10);
              const tEnd = (pt.trueActualEnd || pt.actualEnd || "").substring(0, 10);
              if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
                const todayStr = new Date().toISOString().split("T")[0];
                if (todayStr >= tEnd) {
                  computedExpPct = 100;
                } else if (todayStr <= tStart) {
                  computedExpPct = 0;
                } else {
                  const totalWd = saWorkingDays(tStart, tEnd);
                  const elapsedWd = saWorkingDays(tStart, todayStr);
                  if (totalWd && totalWd > 0 && elapsedWd !== null) {
                    computedExpPct = Math.round(Math.min(elapsedWd / totalWd, 1.0) * 100);
                  }
                }
              }
            }

            const isVirtualMilestone = pt.isVirtual === true;

            return {
              id: isVirtualMilestone ? pt.rowNumber : -pt.id,
              projectName: String(projectName),
              planProjectName: isVirtualMilestone ? projectName : pt.projectName,
              importedTaskId: isVirtualMilestone ? null : pt.id,
              taskNumber: pt.taskNo || String(pt.rowNumber || ""),
              parentTaskId: null as number | null,
              title: pt.highLevelProgramme || `Task ${pt.taskNo || pt.rowNumber}`,
              description: null,
              status: isVirtualMilestone ? "not_started" : status,
              priority: "Normal",
              startDate: pt.actualStart || null,
              dueDate: pt.actualEnd || null,
              durationDays: pt.durationDays || null,
              percentComplete: isVirtualMilestone ? 0 : pctComplete,
              expectedPercentComplete: isVirtualMilestone ? 0 : computedExpPct,
              storedActualPct: pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : null,
              assignees: null,
              tags: null,
              blockerReason: null,
              plannedHours: null,
              actualHours: null,
              actualStartDate: pt.trueActualStart || pt.actualStart || null,
              actualEndDate: pt.trueActualEnd || pt.actualEnd || null,
              actualDurationDays: pt.durationDays || null,
              comment: null as string | null,
              sortOrder: pt.sortOrder ?? pt.rowNumber ?? 0,
              isBaseline: !isVirtualMilestone,
              isVirtualMilestone,
              isMilestone: pt.isMilestone === true,
              rowNumber: pt.rowNumber,
              parentRowNumber: pt.parentRowNumber || null,
              indentLevel: pt.indentLevel ?? null,
              createdBy: null,
              createdAt: pt.createdAt || null,
              updatedAt: pt.createdAt || null,
            };
          });
      }

      const allTasks: any[] = [...baselineTasks, ...operationalTasks];

      const rowNumberToId = new Map<number, number>();
      const taskNumToId = new Map<string, number>();
      const workItemIdToTaskId = new Map<number, number>();
      let summaryTaskId: number | null = null;
      for (const t of allTasks) {
        if (t.rowNumber != null) rowNumberToId.set(t.rowNumber, t.id);
        if (t.workItemId) workItemIdToTaskId.set(t.workItemId, t.id);
        if (t.taskNumber) {
          taskNumToId.set(String(t.taskNumber), t.id);
          const num = String(t.taskNumber).toLowerCase();
          if (num === "no." || num === "no" || num === "#") {
            summaryTaskId = t.id;
          }
        }
      }

      for (const t of allTasks) {
        if (t.parentWorkItemId) {
          const parentId = workItemIdToTaskId.get(t.parentWorkItemId);
          if (parentId !== undefined) {
            t.parentTaskId = parentId;
            continue;
          }
        }
        if (t.parentRowNumber != null && t.parentRowNumber !== 0) {
          const parentId = rowNumberToId.get(t.parentRowNumber);
          if (parentId !== undefined) {
            t.parentTaskId = parentId;
            continue;
          }
        }
        if (t.parentTaskId) continue;
        const num = String(t.taskNumber || "");
        if (!num) continue;
        if (num.includes(".")) {
          const parts = num.split(".");
          parts.pop();
          const parentNum = parts.join(".");
          const parentId = taskNumToId.get(parentNum);
          if (parentId !== undefined) t.parentTaskId = parentId;
        } else if (/^\d+$/.test(num) && summaryTaskId !== null && t.id !== summaryTaskId) {
          t.parentTaskId = summaryTaskId;
        }
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();

      const taskMap = new Map<number, any>();
      const childrenMap = new Map<number, number[]>();

      for (const t of allTasks) {
        const task: any = { ...t };
        const plannedStart = t.startDate ? new Date(t.startDate) : null;
        const plannedEnd = t.dueDate ? new Date(t.dueDate) : null;

        if (plannedStart && plannedEnd && !isNaN(plannedStart.getTime()) && !isNaN(plannedEnd.getTime())) {
          task.plannedDurationDays = Math.max(1, Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 86400000) + 1);
        } else {
          task.plannedDurationDays = t.durationDays || null;
        }

        const actStart = t.actualStartDate ? new Date(t.actualStartDate) : null;
        const actEnd = t.actualEndDate ? new Date(t.actualEndDate) : null;
        if (actStart && actEnd && !isNaN(actStart.getTime()) && !isNaN(actEnd.getTime())) {
          task.computedActualDurationDays = Math.max(1, Math.round((actEnd.getTime() - actStart.getTime()) / 86400000) + 1);
        } else {
          task.computedActualDurationDays = t.actualDurationDays || null;
        }

        taskMap.set(t.id, task);
        if (t.parentTaskId) {
          if (!childrenMap.has(t.parentTaskId)) childrenMap.set(t.parentTaskId, []);
          childrenMap.get(t.parentTaskId)!.push(t.id);
        }
      }

      for (const [parentId] of childrenMap) {
        const parentTask = taskMap.get(parentId);
        if (parentTask && !parentTask.isMilestone) {
          parentTask.isMilestone = true;
        }
      }

      const calcExpected = (t: any): number | null => {
        if (t.expectedPercentComplete != null) return t.expectedPercentComplete;
        const useActual = t.actualStartDate && t.actualEndDate;
        const startStr = useActual ? t.actualStartDate : t.startDate;
        const endStr = useActual ? t.actualEndDate : t.dueDate;
        const plannedStart = startStr ? new Date(startStr) : null;
        const plannedEnd = endStr ? new Date(endStr) : null;
        if (!plannedStart || !plannedEnd || isNaN(plannedStart.getTime()) || isNaN(plannedEnd.getTime())) return null;
        const startMs = plannedStart.getTime();
        const endMs = plannedEnd.getTime();
        if (todayMs < startMs) return 0;
        if (todayMs >= endMs) return 100;
        const totalDays = Math.max(1, (endMs - startMs) / 86400000);
        const elapsed = (todayMs - startMs) / 86400000;
        return Math.round((elapsed / totalDays) * 100);
      };

      const getStoredExpected = (t: any): number | null => {
        if (t.expectedPercentComplete != null) return t.expectedPercentComplete;
        return null;
      };

      const computeRollups = (taskId: number): void => {
        const children = childrenMap.get(taskId);
        if (!children || children.length === 0) {
          const t = taskMap.get(taskId);
          if (t) t.computedExpectedPct = calcExpected(t);
          return;
        }
        for (const childId of children) computeRollups(childId);

        const parent = taskMap.get(taskId);
        if (!parent) return;

        let minPlannedStart: Date | null = null;
        let maxPlannedEnd: Date | null = null;
        let minActualStart: Date | null = null;
        let maxActualEnd: Date | null = null;
        let totalWeightedPct = 0;
        let totalWeightedExpected = 0;
        let totalWeight = 0;

        for (const childId of children) {
          const child = taskMap.get(childId);
          if (!child) continue;
          const ps = child.startDate ? new Date(child.startDate) : null;
          const pe = child.dueDate ? new Date(child.dueDate) : null;
          const as2 = child.actualStartDate ? new Date(child.actualStartDate) : null;
          const ae = child.actualEndDate ? new Date(child.actualEndDate) : null;

          if (ps && !isNaN(ps.getTime()) && (!minPlannedStart || ps < minPlannedStart)) minPlannedStart = ps;
          if (pe && !isNaN(pe.getTime()) && (!maxPlannedEnd || pe > maxPlannedEnd)) maxPlannedEnd = pe;
          if (as2 && !isNaN(as2.getTime()) && (!minActualStart || as2 < minActualStart)) minActualStart = as2;
          if (ae && !isNaN(ae.getTime()) && (!maxActualEnd || ae > maxActualEnd)) maxActualEnd = ae;

          const weight = child.plannedDurationDays || 1;
          totalWeightedPct += (child.percentComplete || 0) * weight;
          totalWeightedExpected += (child.computedExpectedPct ?? 0) * weight;
          totalWeight += weight;
        }

        if (!parent.isBaseline || !parent.startDate) {
          if (minPlannedStart) parent.startDate = minPlannedStart.toISOString().split('T')[0];
        }
        if (!parent.isBaseline || !parent.dueDate) {
          if (maxPlannedEnd) parent.dueDate = maxPlannedEnd.toISOString().split('T')[0];
        }
        if (parent.startDate && parent.dueDate) {
          const ps = new Date(parent.startDate);
          const pe = new Date(parent.dueDate);
          if (!isNaN(ps.getTime()) && !isNaN(pe.getTime())) {
            parent.plannedDurationDays = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / 86400000) + 1);
          }
        }
        if (minActualStart) parent.actualStartDate = minActualStart.toISOString().split('T')[0];
        if (maxActualEnd) parent.actualEndDate = maxActualEnd.toISOString().split('T')[0];
        if (minActualStart && maxActualEnd) {
          parent.computedActualDurationDays = Math.max(1, Math.round((maxActualEnd.getTime() - minActualStart.getTime()) / 86400000) + 1);
        }

        const computedActual = totalWeight > 0 ? Math.round(totalWeightedPct / totalWeight) : (parent.percentComplete || 0);
        if (parent.isBaseline && parent.storedActualPct != null) {
          parent.percentComplete = parent.storedActualPct;
        } else {
          parent.percentComplete = computedActual;
        }
        parent.computedExpectedPct = totalWeight > 0 ? Math.round(totalWeightedExpected / totalWeight) : calcExpected(parent);
        parent.isParent = true;
        parent.childCount = children.length;
      };

      for (const [, t] of taskMap) {
        if (childrenMap.has(t.id)) continue;
        const pct = t.percentComplete || 0;
        if (pct < 100 && t.actualEndDate) {
          const actualEnd = new Date(t.actualEndDate);
          if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
            t.percentComplete = 100;
            t.storedActualPct = 100;
            // Emit canonical lower_snake.
            if (t.status === "not_started" || t.status === "to_do" || t.status === "active" || !t.status) {
              t.status = "complete";
            }
          }
        }
      }

      const rootIds = allTasks.filter(t => !t.parentTaskId).map(t => t.id);
      for (const rootId of rootIds) computeRollups(rootId);

      for (const [, t] of taskMap) {
        if (!childrenMap.has(t.id)) {
          t.computedExpectedPct = calcExpected(t);
        }
        if (t.percentComplete < 100 && t.actualEndDate) {
          const actualEnd = new Date(t.actualEndDate);
          if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
            t.percentComplete = 100;
            t.storedActualPct = 100;
            // Emit canonical lower_snake.
            if (t.status === "not_started" || t.status === "to_do" || t.status === "in_progress" || t.status === "active" || !t.status) {
              t.status = "complete";
            }
          }
        }
        if (t.isVirtualMilestone && (t.isParent || t.childCount > 0)) {
          const pct = t.percentComplete || 0;
          // Emit canonical lower_snake.
          if (pct >= 100) t.status = "complete";
          else if (pct > 0) t.status = "in_progress";
          else t.status = "not_started";
        }
        const pct = t.percentComplete || 0;
        const exp = t.computedExpectedPct ?? 0;
        const delta = pct - exp;
        t.delta = delta;
        if (delta < -5) t.planStatus = 'behind';
        else if (delta > 5) t.planStatus = 'ahead';
        else t.planStatus = 'on_track';
      }

      const sortByTaskCode = (a: any, b: any): number => {
        const aCode = a.taskNumber || '';
        const bCode = b.taskNumber || '';
        const aParts = aCode.split('.').map((p: string) => parseInt(p) || 0);
        const bParts = bCode.split('.').map((p: string) => parseInt(p) || 0);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const av = aParts[i] || 0;
          const bv = bParts[i] || 0;
          if (av !== bv) return av - bv;
        }
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      };

      const result = Array.from(taskMap.values()).sort(sortByTaskCode);

      const userId = (req as any).user?.id;
      if (userId) {
        try {
          const assignmentRows = await db.execute(sql`
            SELECT work_item_id, role FROM work_item_assignments
            WHERE user_id = ${userId}
          `);
          const roleMap = new Map<number, string>();
          const rows = Array.isArray(assignmentRows) ? assignmentRows : (assignmentRows as any).rows || [];
          for (const r of rows) roleMap.set(r.work_item_id, r.role);
          for (const t of result) {
            const wiId = t.importedTaskId || Math.abs(t.id);
            const role = roleMap.get(wiId);
            t.assignmentRole = role || null;
          }
        } catch (e) { console.warn("[planning-tasks-routes] non-critical error:", e instanceof Error ? e.message : e); }
      }

      let unlinkedOperationalTasks: any[] = [];
      if (unlinkedOperationalRaw.length > 0) {
        try {
          const { buildUserMap } = await import("../user-resolver");
          const userMap = await buildUserMap();
          const ids = unlinkedOperationalRaw.map((t: any) => t.id).filter((n: any) => Number.isFinite(n));
          const assignmentsByItem = new Map<number, number[]>();
          if (ids.length > 0) {
            const rows = await db
              .select({ workItemId: workItemAssignments.workItemId, userId: workItemAssignments.userId, role: workItemAssignments.role })
              .from(workItemAssignments)
              .where(and(inArray(workItemAssignments.workItemId, ids), eq(workItemAssignments.role, "ASSIGNEE" as any)));
            for (const r of rows) {
              if (!assignmentsByItem.has(r.workItemId)) assignmentsByItem.set(r.workItemId, []);
              assignmentsByItem.get(r.workItemId)!.push(r.userId);
            }
          }
          unlinkedOperationalTasks = unlinkedOperationalRaw.map((t: any) => {
            const aIds = assignmentsByItem.get(t.id) || [];
            const assigneeNames = aIds
              .map((uid: number) => userMap.get(uid)?.name)
              .filter((n: any): n is string => !!n);
            const ownerName = t.ownerUserId ? userMap.get(t.ownerUserId)?.name || null : null;
            return {
              id: t.id,
              workItemId: t.id,
              title: t.title || t.taskName || `Task ${t.id}`,
              status: t.status || null,
              priority: t.priority || null,
              dueDate: t.endDate || t.dueDate || null,
              assigneeNames,
              ownerName,
              workstream: t.workstream || null,
            };
          });
        } catch (e) {
          console.warn("[planning-tasks-routes] failed to enrich unlinked tasks:", e instanceof Error ? e.message : e);
          unlinkedOperationalTasks = unlinkedOperationalRaw.map((t: any) => ({
            id: t.id,
            workItemId: t.id,
            title: t.title || t.taskName || `Task ${t.id}`,
            status: t.status || null,
            priority: t.priority || null,
            dueDate: t.endDate || t.dueDate || null,
            assigneeNames: [],
            ownerName: null,
            workstream: t.workstream || null,
          }));
        }
      }

      res.json({ tasks: result, unlinkedOperationalCount, unlinkedOperationalTasks });
    } catch (err: any) {
      console.error("Planning tasks error:", err);
      throw err;
    }
  });

  app.get("/api/planning-tasks/:projectName/summary-rollup", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(paramStr(req, "projectName"));
      const allTasks = await db.select().from(workItems).where(
        and(
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
          sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
        )
      );

      const childrenByParent = new Map<number, typeof allTasks>();
      for (const t of allTasks) {
        if (t.parentId) {
          if (!childrenByParent.has(t.parentId)) childrenByParent.set(t.parentId, []);
          childrenByParent.get(t.parentId)!.push(t);
        }
      }

      const rollup: Record<number, { percentComplete: number; startDate: string | null; endDate: string | null; duration: number | null }> = {};

      for (const [parentId, children] of childrenByParent) {
        let minStart: string | null = null;
        let maxEnd: string | null = null;
        let totalDuration = 0;
        let weightedPct = 0;
        let totalWeight = 0;

        for (const c of children) {
          const s = c.startDate;
          const e = c.endDate;
          if (s && (!minStart || s < minStart)) minStart = s;
          if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
          const dur = c.duration || 1;
          totalDuration += dur;
          const pct = c.percentComplete != null ? Number(c.percentComplete) : 0;
          weightedPct += pct * dur;
          totalWeight += dur;
        }

        rollup[parentId] = {
          percentComplete: totalWeight > 0 ? Math.round((weightedPct / totalWeight) * 100) / 100 : 0,
          startDate: minStart,
          endDate: maxEnd,
          duration: totalDuration || null,
        };
      }

      res.json(rollup);
    } catch (err: any) {
      console.error("Summary rollup error:", err);
      throw err;
    }
  });

  // ==================== PLAN TASK EDITING (with COO notifications) ====================

  const canEditProjectTasks = async (req: Request, projectName: string): Promise<boolean> => {
    const user = req.user as any;
    if (!user) return false;
    const role = user.role || "";
    if (["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"].includes(role)) return true;
    const info = await storage.getProjectInfo(projectName);
    if (!info) return false;
    if (info.pm === user.name || info.pd === user.name) return true;
    if (info.pmUserId === user.id || info.pdUserId === user.id) return true;
    return false;
  };

  app.patch("/api/planning-tasks/:taskId", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = paramInt(req, "taskId");
      if (taskId == null) {
        return res.status(400).json({ error: `Invalid task ID: ${paramStr(req, "taskId")}` });
      }
      const user = req.user as any;
      const { projectName, ...updates } = req.body;
      if (!projectName) return res.status(400).json({ error: "projectName is required" });

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return res.status(403).json({ error: "You don't have permission to edit this project's tasks" });

      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);

      const actualTaskId = Math.abs(taskId);

      const planTaskResult = await db.select().from(workItems).where(
        and(
          eq(workItems.legacyTable, "project_plan"),
          eq(workItems.legacyId, actualTaskId),
          isNull(workItems.deletedAt)
        )
      ).limit(1);
      const isProjectPlanTask = planTaskResult.length > 0;

      let workItemResult = !isProjectPlanTask
        ? await db.select().from(workItems).where(
            and(
              eq(workItems.legacyTable, "normalized_plan_tasks"),
              eq(workItems.legacyId, actualTaskId),
              isNull(workItems.deletedAt)
            )
          ).limit(1)
        : [];

      if (!isProjectPlanTask && workItemResult.length === 0) {
        workItemResult = await db.select().from(workItems).where(
          and(
            eq(workItems.id, actualTaskId),
            isNull(workItems.deletedAt)
          )
        ).limit(1);
      }

      if (!isProjectPlanTask && workItemResult.length === 0) {
        workItemResult = await db.select().from(workItems).where(
          and(
            eq(workItems.legacyId, actualTaskId),
            isNull(workItems.deletedAt),
            sql`${workItems.projectId} IN (SELECT id FROM project_info WHERE project_name = ${projectName})`
          )
        ).limit(1);
      }
      const isWorkItemTask = workItemResult.length > 0;
      const wi = workItemResult[0] as any;

      if (isProjectPlanTask) {
        const scenario = await storage.getOrCreateActiveScenario(projectName);
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find((o: any) => o.importedTaskId === actualTaskId);

        const basePlanTask = planTaskResult[0];
        const taskName = updates.title || basePlanTask?.title || "Unknown task";

        const overrideData: any = {};
        const notifFields: { field: string; old: string | null; new_: string | null }[] = [];

        if (updates.title != null) {
          overrideData.overrideName = updates.title;
          notifFields.push({ field: "title", old: basePlanTask?.highLevelProgramme || null, new_: updates.title });
        }
        if (updates.startDate != null) {
          overrideData.overrideStartDate = updates.startDate;
          notifFields.push({ field: "startDate", old: basePlanTask?.actualStart || null, new_: updates.startDate });
        }
        if (updates.dueDate != null || updates.endDate != null) {
          const endVal = updates.dueDate || updates.endDate;
          overrideData.overrideEndDate = endVal;
          notifFields.push({ field: "endDate", old: basePlanTask?.actualEnd || null, new_: endVal });
        }
        if (updates.status != null) {
          notifFields.push({ field: "status", old: null, new_: updates.status });
        }
        if (updates.percentComplete != null) {
          notifFields.push({ field: "percentComplete", old: basePlanTask?.actualPctComplete != null ? String(Math.round(basePlanTask.actualPctComplete * 100)) : null, new_: String(updates.percentComplete) });
        }
        // Treat description and comment as a unified "notes" field for plan rows
        // so the drawer's description editor persists for legacy/project-plan
        // baselines (previously updates.description was silently dropped here).
        const noteVal = updates.comment != null ? updates.comment : updates.description;
        if (noteVal != null) {
          overrideData.overrideComment = noteVal;
        }

        if (existing) {
          await storage.updateTaskOverride(existing.id, overrideData);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: actualTaskId,
            overrideStartDate: overrideData.overrideStartDate || null,
            overrideEndDate: overrideData.overrideEndDate || null,
            overrideName: overrideData.overrideName || null,
            overrideTaskNo: null,
            overrideComment: overrideData.overrideComment || null,
            deletedFlag: 0,
            isNewTask: 0,
          });
        }

        // Mirror notes/title onto the canonical work_items row so the grid +
        // drawer detail fetch (which reads work_items) immediately reflect the
        // saved value. The grid + detail panels both read work_items as their
        // source of truth, so a silent mirror failure would leave the user
        // looking at stale data after a "successful" save. Make this part of
        // the request-success contract: if the update affects no canonical
        // row, fail the request so the client surfaces a save-failed toast.
        const wiMirror: any = {};
        if (noteVal != null) wiMirror.description = noteVal;
        if (updates.title != null) wiMirror.title = updates.title;
        if (Object.keys(wiMirror).length > 0) {
          const mirrorResult = await db.update(workItems).set(wiMirror).where(
            and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, actualTaskId))
          ).returning({ id: workItems.id });
          if (mirrorResult.length === 0) {
            return res.status(409).json({
              error: `Could not persist title/description for plan task ${actualTaskId}: no canonical work_items row found. Please retry after the next plan sync.`,
            });
          }
        }

        if (updates.workstream != null) {
          const validWorkstreams = ["PM", "ENG", "QUALITY"];
          if (validWorkstreams.includes(updates.workstream)) {
            try {
              await db.update(workItems).set({ workstream: updates.workstream }).where(
                and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, actualTaskId))
              );
            } catch (e) {
              console.warn(`[planning-tasks] Failed to update workstream for legacy task ${actualTaskId}:`, e);
            }
          }
        }

        if (updates.status != null || updates.percentComplete != null) {
          const pctVal = updates.percentComplete != null ? updates.percentComplete / 100 : undefined;
          const statusVal = updates.status;
          const updateFields: any = {};
          if (pctVal !== undefined) updateFields.actualPctComplete = pctVal;
          if (statusVal === "Done" && pctVal === undefined) updateFields.actualPctComplete = 1.0;

          if (Object.keys(updateFields).length > 0) {
            try {
              const wiPct = updateFields.actualPctComplete;
              if (wiPct !== undefined) {
                const result = await db.update(workItems).set({ percentComplete: wiPct }).where(
                  and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, actualTaskId))
                ).returning({ id: workItems.id });
                if (result.length === 0) {
                  const wiByProject = await db.execute(sql`
                    SELECT wi.id, wi.title, pi.project_name
                    FROM work_items wi
                    JOIN project_info pi ON wi.project_id = pi.id
                    WHERE wi.legacy_table = 'project_plan' AND wi.legacy_id = ${actualTaskId} AND wi.deleted_at IS NULL
                    LIMIT 1
                  `);
                  if (wiByProject.rows.length > 0) {
                    await db.update(workItems).set({ percentComplete: wiPct }).where(
                      eq(workItems.id, (wiByProject.rows[0] as any).id)
                    );
                  }
                }
              }
            } catch (e) {
              console.warn(`[planning-tasks] Failed to sync percentComplete to work_items for task ${actualTaskId}:`, e);
            }
          }
        }

        // Notifications feature removed - planEditNotifications inserts are now no-ops

        logAuditFromReq(req, {
          entityType: "plan_task",
          action: "update",
          entityId: String(actualTaskId),
          projectName,
          changesJson: { taskName, ...updates },
        });

        res.json({ success: true, taskId });
      } else if (isWorkItemTask) {
        const taskName = updates.title || wi.title || "Unknown task";
        const wiUpdateFields: any = {};
        const notifFields: { field: string; old: string | null; new_: string | null }[] = [];

        if (updates.title != null) {
          wiUpdateFields.title = updates.title;
          notifFields.push({ field: "title", old: wi.title || null, new_: updates.title });
        }
        if (updates.startDate != null) {
          wiUpdateFields.startDate = updates.startDate;
          notifFields.push({ field: "startDate", old: wi.startDate || null, new_: updates.startDate });
        }
        if (updates.dueDate != null || updates.endDate != null) {
          const endVal = updates.dueDate || updates.endDate;
          wiUpdateFields.endDate = endVal;
          notifFields.push({ field: "endDate", old: wi.endDate || null, new_: endVal });
        }
        if (updates.status != null) {
          wiUpdateFields.status = updates.status;
          notifFields.push({ field: "status", old: wi.status || null, new_: updates.status });
        }
        if (updates.percentComplete != null) {
          wiUpdateFields.percentComplete = updates.percentComplete / 100;
          notifFields.push({
            field: "percentComplete",
            old: wi.percentComplete != null ? String(Math.round(Number(wi.percentComplete) * 100)) : null,
            new_: String(updates.percentComplete),
          });
        }
        if (updates.comment != null || updates.description != null) {
          wiUpdateFields.description = updates.comment || updates.description;
        }
        if (updates.priority != null) {
          wiUpdateFields.priority = updates.priority;
        }
        if (updates.duration != null) {
          wiUpdateFields.duration = updates.duration;
          notifFields.push({ field: "duration", old: wi.duration != null ? String(wi.duration) : null, new_: String(updates.duration) });
          if (updates.startDate || wi.startDate) {
            const start = new Date(updates.startDate || wi.startDate!);
            start.setDate(start.getDate() + updates.duration);
            wiUpdateFields.endDate = start.toISOString().split("T")[0];
          }
        }
        if (updates.assigneeUserId != null) {
          wiUpdateFields.ownerUserId = updates.assigneeUserId || null;
          notifFields.push({ field: "assignee", old: wi.ownerUserId ? String(wi.ownerUserId) : null, new_: String(updates.assigneeUserId) });
        }
        if (updates.wbsCode != null) {
          wiUpdateFields.wbsCode = updates.wbsCode;
        }
        if (updates.workstream != null) {
          const validWorkstreams = ["PM", "ENG", "QUALITY"];
          if (validWorkstreams.includes(updates.workstream)) {
            wiUpdateFields.workstream = updates.workstream;
            notifFields.push({ field: "workstream", old: wi.workstream || "PM", new_: updates.workstream });
          }
        }
        if (updates.baselineStart != null) {
          wiUpdateFields.baselineStart = updates.baselineStart;
        }
        if (updates.baselineEnd != null) {
          wiUpdateFields.baselineEnd = updates.baselineEnd;
        }
        if (updates.baselineDuration != null) {
          wiUpdateFields.baselineDuration = updates.baselineDuration;
        }
        if (updates.taskMode != null) {
          wiUpdateFields.taskMode = updates.taskMode;
        }

        if ((updates.status === "complete" || updates.status === "Done") && updates.percentComplete == null) {
          wiUpdateFields.percentComplete = 1.0;
        }

        // Validate parent completion: can't mark complete if children are still open
        if (updates.status && ["complete", "Done", "Complete", "COMPLETE"].includes(updates.status)) {
          const blockMsg = await validateParentCompletion(wi.id);
          if (blockMsg) {
            return res.status(400).json({ error: blockMsg });
          }
        }

        if (Object.keys(wiUpdateFields).length > 0) {
          await db.update(workItems).set(wiUpdateFields).where(eq(workItems.id, wi.id));
        }

        try {
          const wiSyncFields: any = {};
          if (updates.title != null) wiSyncFields.title = updates.title;
          if (updates.startDate != null) wiSyncFields.startDate = updates.startDate;
          if (updates.dueDate != null || updates.endDate != null) wiSyncFields.endDate = updates.dueDate || updates.endDate;
          if (updates.percentComplete != null) wiSyncFields.percentComplete = updates.percentComplete / 100;
          if ((updates.status === "complete" || updates.status === "Done") && updates.percentComplete == null) wiSyncFields.percentComplete = 1.0;
          if (Object.keys(wiSyncFields).length > 0) {
            await db.update(workItems).set(wiSyncFields).where(
              and(eq(workItems.legacyTable, "normalized_plan_tasks"), eq(workItems.legacyId, actualTaskId), isNull(workItems.deletedAt))
            );
          }
        } catch (e) {
          console.warn(`[planning-tasks] Failed to sync to work_items for task ${actualTaskId}:`, e);
        }

        // Notifications feature removed - planEditNotifications inserts are now no-ops

        logAuditFromReq(req, {
          entityType: "plan_task",
          action: "update",
          entityId: String(wi.id),
          projectName,
          changesJson: { taskName, ...updates },
        });

        // Run cascades (dates rollup to parent, status propagation)
        try {
          await runCascadesAfterUpdate(wi.id, {
            status: updates.status,
            startDate: updates.startDate,
            dueDate: updates.dueDate || updates.endDate,
          });
        } catch (cascadeErr: any) {
          console.warn("[planning-tasks] Non-fatal cascade error:", cascadeErr.message);
        }

        await notifyWorkItemWatchers({
          workItemId: wi.id,
          actorUserId: (req.user as any)?.id,
          projectName,
          title: `Task updated: ${taskName}`,
          body: `${taskName} was updated in ${projectName}.`,
          eventType: "task_updated",
        });
        res.json({ success: true, taskId, workItemId: wi.id });
      } else {
        // Canonical boundary: work_items is write-master for active planning task edits.
        const wiUpdateFields: any = {};
        if (updates.title != null) wiUpdateFields.title = updates.title;
        if (updates.status != null) wiUpdateFields.status = updates.status;
        if (updates.priority != null) wiUpdateFields.priority = updates.priority;
        if (updates.startDate != null) wiUpdateFields.startDate = updates.startDate;
        if (updates.dueDate != null) wiUpdateFields.endDate = updates.dueDate;
        if (updates.percentComplete != null) wiUpdateFields.percentComplete = updates.percentComplete / 100;
        if (updates.comment != null || updates.description != null) {
          wiUpdateFields.description = updates.comment != null ? updates.comment : updates.description;
        }

        if (Object.keys(wiUpdateFields).length > 0 && isWorkItemTask) {
          await db.update(workItems).set(wiUpdateFields).where(eq(workItems.id, wi.id));

          // Legacy mirror removed — work_items is now the canonical source.
        }

        res.json({ success: true, taskId, workItemId: wi?.id ?? null });
      }
    } catch (err: any) {
      console.error("Plan task update error:", err);
      throw err;
    }
  });

  app.post("/api/planning-tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { projectName, title, startDate, dueDate, status, priority, isMilestone, parentTaskId } = req.body;
      if (!projectName) return sendError(res, badRequest("projectName is required"));
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission to create tasks" });

      const normalizedStatus = normalizeStatus(status || "Not Started");
      const normalizedPriority = normalizePriority(priority || "Normal");

      const projectInfoRow = await storage.getProjectInfo(projectName);
      const projectId = projectInfoRow?.id || null;

      const existingItems = await db.select({ wbsCode: workItems.wbsCode })
        .from(workItems)
        .where(and(
          projectId ? eq(workItems.projectId, projectId) : sql`false`,
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
          isNull(workItems.parentId),
        ))
        .orderBy(desc(workItems.id));

      let nextTopLevelNum = 1;
      for (const item of existingItems) {
        if (item.wbsCode) {
          const topLevel = parseInt(item.wbsCode.split('.')[0]);
          if (!isNaN(topLevel) && topLevel >= nextTopLevelNum) {
            nextTopLevelNum = topLevel + 1;
          }
        }
      }
      const newWbsCode = String(nextTopLevelNum);

      let workItem: any;
      let task: any;

      await db.transaction(async (tx: any) => {
        [workItem] = await tx.insert(workItems).values({
          projectId,
          workstream: "PM",
          source: "UI",
          title,
          status: normalizedStatus,
          priority: normalizedPriority,
          startDate: startDate || null,
          endDate: dueDate || null,
          percentComplete: 0,
          wbsCode: newWbsCode,
          indentLevel: 0,
          parentId: null,
          isMilestone: isMilestone || false,
          createdBy: user.id,
          taskMode: "auto",
        }).returning();
      });

      // Legacy mirror removed — work_items is the canonical source.
      task = { id: workItem.id };

      // Notifications feature removed - planEditNotifications insert for task_created is now a no-op

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: "create",
        entityId: String(workItem.id),
        projectName,
        changesJson: { title, status, priority, wbsCode: newWbsCode },
      });

      await notifyWorkItemWatchers({
        workItemId: workItem.id,
        actorUserId: user.id,
        projectName,
        title: `Task created: ${title}`,
        body: `${title} was created in ${projectName}.`,
        eventType: "task_created",
      });
      res.json({ ...task, workItemId: workItem.id, wbsCode: newWbsCode });
    } catch (err: any) {
      console.error("Plan task create error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/planning-tasks/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { projectName, operation, taskIds } = req.body;
      if (!projectName || !operation || !Array.isArray(taskIds) || taskIds.length === 0) {
        return sendError(res, badRequest("projectName, operation, and taskIds[] required"));
      }

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return sendError(res, forbidden("You don't have permission to update tasks"));

      const results: Array<{ id: number; success: boolean; error?: string }> = [];

      if (operation === "delete") {
        for (const id of taskIds) {
          try {
            await db.update(workItems).set({ deletedAt: new Date() }).where(eq(workItems.id, id));
            results.push({ id, success: true });
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "indent") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task) {
              const siblings = await db.select().from(workItems).where(
                and(
                  eq(workItems.workstream, "PM"),
                  isNull(workItems.deletedAt),
                  eq(workItems.parentId, task.parentId || 0),
                  sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
                )
              );
              const sorted = siblings.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              const idx = sorted.findIndex((s: any) => s.id === id);
              if (idx > 0) {
                await db.update(workItems).set({ parentId: sorted[idx - 1].id, indentLevel: (task.indentLevel || 0) + 1 }).where(eq(workItems.id, id));
                results.push({ id, success: true });
              } else {
                results.push({ id, success: false, error: "No task above to indent under" });
              }
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "outdent") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task && task.parentId) {
              const [parent] = await db.select().from(workItems).where(eq(workItems.id, task.parentId));
              await db.update(workItems).set({
                parentId: parent?.parentId || null,
                indentLevel: Math.max(0, (task.indentLevel || 1) - 1),
              }).where(eq(workItems.id, id));
              results.push({ id, success: true });
            } else {
              results.push({ id, success: false, error: "Already at top level" });
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "moveUp" || operation === "moveDown") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task) {
              const siblings = await db.select().from(workItems).where(
                and(
                  eq(workItems.workstream, "PM"),
                  isNull(workItems.deletedAt),
                  task.parentId ? eq(workItems.parentId, task.parentId) : isNull(workItems.parentId),
                  sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
                )
              );
              const sorted = siblings.sort((a: any, b: any) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
              const idx = sorted.findIndex((s: any) => s.id === id);
              const swapIdx = operation === "moveUp" ? idx - 1 : idx + 1;
              if (swapIdx >= 0 && swapIdx < sorted.length) {
                const curOrder = sorted[idx].sortOrder ?? idx * 10;
                const swapOrder = sorted[swapIdx].sortOrder ?? swapIdx * 10;
                await db.update(workItems).set({ sortOrder: swapOrder }).where(eq(workItems.id, sorted[idx].id));
                await db.update(workItems).set({ sortOrder: curOrder }).where(eq(workItems.id, sorted[swapIdx].id));
                results.push({ id, success: true });
              } else {
                results.push({ id, success: false, error: `Cannot move ${operation === "moveUp" ? "up" : "down"}` });
              }
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else {
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
      }

      const succeeded = results.filter(r => r.success).length;

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: `bulk_${operation}`,
        entityId: taskIds.join(","),
        projectName,
        changesJson: { operation, taskIds, succeeded },
      });

      res.json({ success: true, results });
    } catch (err: any) {
      console.error("Bulk plan task error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/planning-tasks/:taskId", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = paramInt(req, "taskId");
      if (taskId == null) return sendError(res, badRequest("Invalid task ID"));
      const user = req.user as any;
      const { projectName } = req.body;
      if (!projectName) return sendError(res, badRequest("projectName is required"));

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return sendError(res, forbidden("You don't have permission to delete tasks"));

      const isBaselineTask = taskId < 0;
      const actualTaskId = Math.abs(taskId);

      if (isBaselineTask) {
        const scenario = await storage.getOrCreateActiveScenario(projectName);
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find((o: any) => o.importedTaskId === actualTaskId);

        if (existing) {
          await storage.softDeleteTaskOverride(existing.id);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: actualTaskId,
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
        // Canonical boundary: soft-delete work_items only (operational_tasks no longer used).
        await softDeleteCanonicalWorkItemByLegacyTaskId(taskId);
      }

      // Notifications feature removed - planEditNotifications insert for task_deleted is now a no-op

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: "delete",
        entityId: String(taskId),
        projectName,
        changesJson: { deleted: true },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Plan task delete error:", err);
      sendError(res, err);
    }
  });

  // ==================== PLAN EDIT NOTIFICATIONS (REMOVED) ====================
  // Notifications feature removed - plan-edit-notification endpoints removed

  // ==================== KEY DATE MAPPINGS ====================

  app.get("/api/key-date-mappings/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getKeyDateMappings(decodeURIComponent(paramStr(req, "projectName")));
      res.json(mappings);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/key-date-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createKeyDateMapping({ ...req.body, createdBy: (req.user as any)?.id });
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: String(mapping.id), action: "create", changesJson: req.body });
      res.json(mapping);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = paramInt(req, "id");
      if (id == null) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateKeyDateMapping(id, req.body);
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: paramStr(req, "id"), action: "update", changesJson: req.body });
      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = paramInt(req, "id");
      if (id == null) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteKeyDateMapping(id);
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: paramStr(req, "id"), action: "delete" });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  async function resolveKeyDates(projectId: number | null, projectName: string): Promise<any[]> {
    let planTasks: any[] = [];

    if (projectId) {
      const rows = await db.select().from(workItems)
        .where(and(
          eq(workItems.projectId, projectId),
          sql`${workItems.workstream} IN ('PM')`,
          eq(workItems.source, "SMART_IMPORT"),
          isNull(workItems.deletedAt),
        ));
      planTasks = rows.map((wi: any) => ({
        id: wi.id,
        highLevelProgramme: wi.title,
        actualStart: wi.startDate || null,
        actualEnd: wi.endDate || null,
        trueActualStart: wi.actualStart || wi.startDate || null,
        trueActualEnd: wi.actualEnd || wi.endDate || null,
        taskNo: wi.wbsCode || null,
        baselineStart: null,
        baselineEnd: null,
      }));
    }

    if (planTasks.length === 0 && projectName) {
      const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";
      const [planTasksDirect, planTasksTracker] = await Promise.all([
        storage.getProjectPlansByProject(projectName),
        projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
      ]);
      planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;
    }

    const autoMappings = [
      { keyDateName: "PD Handover", patterns: ['bd handover', 'project charter handover'], dateField: 'actualEnd' as const, sortOrder: 1 },
      { keyDateName: "Construction Start", patterns: ['site establishment'], dateField: 'actualStart' as const, sortOrder: 2 },
      { keyDateName: "Commissioning", patterns: ['commissioning'], dateField: 'actualEnd' as const, sortOrder: 3 },
      { keyDateName: "Practical Completion", patterns: ['practical completion'], dateField: 'actualEnd' as const, sortOrder: 4 },
      { keyDateName: "O&M Handover", patterns: ['handover to matriarch'], dateField: 'actualEnd' as const, sortOrder: 5 },
      { keyDateName: "Client Handover", patterns: ['handover to client'], dateField: 'actualEnd' as const, sortOrder: 6 },
    ];

    return autoMappings.map(mapping => {
      let matchedTask: any = null;
      let effectiveDate: string | null = null;

      for (const task of planTasks) {
        const desc = (task.highLevelProgramme || '').toLowerCase();
        const matches = mapping.patterns.some(p => desc.includes(p));
        if (matches) {
          const trueActual = mapping.dateField === 'actualStart' ? task.trueActualStart : task.trueActualEnd;
          const fallback = mapping.dateField === 'actualStart' ? task.actualStart : task.actualEnd;
          const dateVal = trueActual || fallback;
          if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
            const dateStr = dateVal.substring(0, 10);
            if (mapping.dateField === 'actualStart') {
              if (!effectiveDate || dateStr < effectiveDate) {
                effectiveDate = dateStr;
                matchedTask = task;
              }
            } else {
              if (!effectiveDate || dateStr > effectiveDate) {
                effectiveDate = dateStr;
                matchedTask = task;
              }
            }
          }
        }
      }

      const plannedStart = matchedTask?.actualStart?.substring(0, 10) || matchedTask?.baselineStart?.substring(0, 10) || null;
      const plannedEnd = matchedTask?.actualEnd?.substring(0, 10) || matchedTask?.baselineEnd?.substring(0, 10) || null;
      const plannedDate = mapping.dateField === 'actualStart' ? plannedStart : plannedEnd;

      return {
        id: mapping.sortOrder,
        keyDateName: mapping.keyDateName,
        sourceTaskNameMatch: mapping.patterns.join(' / '),
        dateField: mapping.dateField === 'actualStart' ? 'startDate' : 'dueDate',
        sortOrder: mapping.sortOrder,
        matchedTaskId: matchedTask?.id || null,
        matchedTaskTitle: matchedTask?.highLevelProgramme || null,
        matchedTaskNumber: matchedTask?.taskNo || null,
        plannedDate,
        actualDate: effectiveDate,
        effectiveDate,
        mappingValid: !!matchedTask,
        source: 'auto',
      };
    });
  }

  app.get("/api/key-dates/by-id/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = paramInt(req, "projectId");
      if (projectId == null) return res.status(400).json({ error: "Invalid project ID" });
      const [piRow] = await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1);
      const pName = piRow?.projectName || "";
      res.json(await resolveKeyDates(projectId, pName));
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/key-dates/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(paramStr(req, "projectName"));
      const [piRow] = await db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.projectName, projectName)).limit(1);
      const projectId = piRow?.id || null;
      res.json(await resolveKeyDates(projectId, projectName));
    } catch (err: any) {
      throw err;
    }
  });
}
