/**
 * Plan Rollup Service — canonical, single-source-of-truth pipeline for
 * project Actual % / Expected % / Variance %.
 *
 * Background (2026-05-19): The COO confirmed that the project detail
 * Plan tab's pill (Actual %, Expected %) is the truth set — it matches
 * the Excel project-plan top-row rollup. Every other surface
 * (Schedule Status modal, COO Home, Program Dashboard, Execution
 * Dashboard "All Projects" table, /api/projects-summary delta column)
 * MUST use the IDENTICAL algorithm so the numbers never disagree.
 *
 * This service extracts the Plan-tab pipeline that used to live inline
 * in `server/routes/planning-tasks-routes.ts` (lines 257-776 prior to
 * the refactor) into reusable pure-ish functions:
 *
 *   buildPlanRollupTasksFromCanonical(canonicalTasks, projectName, today)
 *     — mirrors the per-task transform + parent rollup logic
 *     — applies the "infer complete from actual_end" rule
 *     — computes computedExpectedPct (date-derived) and parent rollups
 *     — sets isParent / childCount flags
 *
 *   computePlanPill(tasks, { workstream })
 *     — filters by workstream (default PM, matching the Plan tab's
 *       default "Project" dropdown)
 *     — picks leaves (!isParent && !childCount)
 *     — calls the shared computeProjectProgress helper
 *
 *   computeAllProjectPlanPills(opts)
 *     — batch entry point: fetches PM/ENG/QUALITY work_items for every
 *       requested project in one DB hit, runs the pipeline per project,
 *       and returns a Map<projectId, PlanPill>. Used by dashboards so
 *       a single page render does not make N HTTP calls.
 *
 * IMPORTANT: this service intentionally does NOT include the operational
 * task merge, tracker field overlay, or manual_overrides overlay that
 * the Plan tab API does. Those affect display fields only and do not
 * change the Actual %, Expected %, or Variance numbers. The Plan tab
 * API still does those overlays on top of the rollup task array this
 * service produces.
 */
import { eq, and, isNull, inArray, asc, sql } from "drizzle-orm";
import { workItems } from "@shared/schema/tasks";
import { projectInfo } from "@shared/schema/projects";
import { db } from "../db";
import { computeProjectProgress, expectedPctFromDates } from "../lib/kpi-formulas";
import { getAllWorkItemsForPlanTab } from "../work-items-adapter";
import { manualOverridesEnabled } from "../lib/manual-overrides";

export interface PlanPill {
  /** Duration-weighted average actual %, 0..100, or null if no leaves */
  actualPct: number | null;
  /** Duration-weighted average expected %, 0..100, or null if no leaves */
  expectedPct: number | null;
  /** actualPct - expectedPct, 0..100, or null if either side is null */
  variancePct: number | null;
  /** Count of leaf tasks contributing to the pill */
  leafCount: number;
  /** Total tasks after phantom-row filter and workstream filter */
  totalTasks: number;
  /** Tasks with status === 'complete' */
  doneTasks: number;
  /** Items whose start/end fall inside the FY window (for COO Home tile counts) */
  fyItems: number;
}

export interface PlanRollupTask {
  id: number;
  workItemId: number;
  projectId: number | null;
  projectName: string;
  taskNumber: string;
  parentWorkItemId: number | null;
  parentRowNumber: number | null;
  parentTaskId: number | null;
  rowNumber: number | null;
  indentLevel: number | null;
  startDate: string | null;
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  durationDays: number | null;
  plannedDurationDays: number | null;
  percentComplete: number;
  expectedPercentComplete: number;
  computedExpectedPct: number | null;
  storedActualPct: number | null;
  isMilestone: boolean;
  isParent: boolean;
  childCount: number;
  status: string;
  workstream: string;
  sortOrder: number;
}

/** Plan-tab post-fetch row filter (planning-tasks-routes.ts:257-277). */
export function filterPhantomRows<T extends {
  workstream?: string | null;
  taskNo?: string | null;
  startDate?: any;
  endDate?: any;
  actualStartDate?: any;
  actualEndDate?: any;
  isMilestone?: boolean;
}>(canonicalTasks: T[]): T[] {
  return canonicalTasks.filter((ct) => {
    const ws = ct.workstream || "PM";
    if (ws === "ENG" || ws === "QUALITY") return true;
    const hasWbs = ct.taskNo && String(ct.taskNo).trim().length > 0;
    const hasPlannedStart = !!ct.startDate;
    const hasPlannedEnd = !!ct.endDate;
    const hasActualStart = !!ct.actualStartDate;
    const hasActualEnd = !!ct.actualEndDate;
    if (ct.isMilestone && hasWbs) return true;
    if (!hasWbs) return false;
    if (!hasPlannedStart && !hasPlannedEnd && !hasActualStart && !hasActualEnd) return false;
    return true;
  });
}

/**
 * Replicates planning-tasks-routes.ts:281-395 (canonical task mapping),
 * lines 552-595 (parent-id resolution), lines 597-745 (rollup + infer
 * complete from actual end), and 747-776 (final infer-complete pass +
 * delta + planStatus). Returns the post-rollup task list with
 * isParent / childCount / computedExpectedPct populated.
 */
export function buildPlanRollupTasksFromCanonical(
  canonicalTasks: any[],
  projectName: string,
  todayIsoOverride?: string,
): PlanRollupTask[] {
  const filtered = filterPhantomRows(canonicalTasks);

  const todayDate = todayIsoOverride ? new Date(todayIsoOverride) : new Date();
  todayDate.setHours(0, 0, 0, 0);
  const todayMs = todayDate.getTime();
  const todayStr = todayDate.toISOString().split("T")[0];

  const usedIds = new Set<number>();
  const baselineTasks: PlanRollupTask[] = filtered.map((ct: any, idx: number) => {
    let taskId = Number.isFinite(ct.id) && ct.id > 0 ? ct.id : (idx + 1);
    while (usedIds.has(taskId)) taskId = taskId + 100000;
    usedIds.add(taskId);

    const rawPct = ct.pctComplete != null ? Number(ct.pctComplete) : 0;
    const pctComplete = rawPct > 1 ? Math.round(rawPct) : Math.round(rawPct * 100);

    let status = ct.status ? String(ct.status).toLowerCase() : "";
    if (!status || status === "not_started") {
      if (pctComplete >= 100) status = "complete";
      else if (pctComplete > 0) status = "in_progress";
      else status = status || "not_started";
    }

    const tPlannedStart = (ct.startDate || "").substring(0, 10);
    const tPlannedEnd = (ct.endDate || "").substring(0, 10);
    const tActualStart = (ct.actualStartDate || "").substring(0, 10);
    const tActualEnd = (ct.actualEndDate || "").substring(0, 10);
    const tStart = tActualStart || tPlannedStart;
    const tEnd = tActualEnd || tPlannedEnd;
    const expFraction = expectedPctFromDates(tStart || null, tEnd || null, todayStr);
    const computedExpPct = expFraction != null ? Math.round(expFraction * 100) : 0;

    return {
      id: -taskId,
      workItemId: ct.workItemId || taskId,
      projectId: ct.projectId ?? null,
      projectName,
      taskNumber: ct.taskNo || String(idx + 1),
      parentTaskId: null,
      parentWorkItemId: ct.parentWorkItemId || null,
      parentRowNumber: ct.parentRowNumber ?? null,
      rowNumber: ct.rowNumber ?? null,
      indentLevel: ct.indentLevel ?? null,
      startDate: tPlannedStart || null,
      dueDate: tPlannedEnd || null,
      actualStartDate: tActualStart || null,
      actualEndDate: tActualEnd || null,
      durationDays: ct.durationDays || ct.actualDurationDays || null,
      plannedDurationDays: null,
      percentComplete: pctComplete,
      expectedPercentComplete: computedExpPct,
      computedExpectedPct: null,
      storedActualPct: pctComplete,
      isMilestone: ct.isMilestone === true,
      isParent: false,
      childCount: 0,
      status,
      workstream: ct.workstream || "PM",
      sortOrder: ct.sortOrder ?? idx,
    };
  });

  // Parent-id resolution (planning-tasks-routes.ts:552-595).
  const rowNumberToId = new Map<number, number>();
  const taskNumToId = new Map<string, number>();
  const workItemIdToTaskId = new Map<number, number>();
  let summaryTaskId: number | null = null;
  for (const t of baselineTasks) {
    if (t.rowNumber != null) rowNumberToId.set(t.rowNumber, t.id);
    if (t.workItemId) workItemIdToTaskId.set(t.workItemId, t.id);
    if (t.taskNumber) {
      taskNumToId.set(String(t.taskNumber), t.id);
      const num = String(t.taskNumber).toLowerCase();
      if (num === "no." || num === "no" || num === "#") summaryTaskId = t.id;
    }
  }
  for (const t of baselineTasks) {
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

  // Build taskMap + childrenMap + plannedDurationDays
  // (planning-tasks-routes.ts:597-628).
  const taskMap = new Map<number, PlanRollupTask>();
  const childrenMap = new Map<number, number[]>();
  for (const t of baselineTasks) {
    const plannedStart = t.startDate ? new Date(t.startDate) : null;
    const plannedEnd = t.dueDate ? new Date(t.dueDate) : null;
    if (
      plannedStart && plannedEnd &&
      !isNaN(plannedStart.getTime()) && !isNaN(plannedEnd.getTime())
    ) {
      t.plannedDurationDays = Math.max(1, Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 86400000) + 1);
    } else {
      t.plannedDurationDays = t.durationDays || null;
    }
    taskMap.set(t.id, t);
    if (t.parentTaskId) {
      if (!childrenMap.has(t.parentTaskId)) childrenMap.set(t.parentTaskId, []);
      childrenMap.get(t.parentTaskId)!.push(t.id);
    }
  }

  // Parents auto-marked as milestones (planning-tasks-routes.ts:630-635).
  for (const [parentId] of childrenMap) {
    const parentTask = taskMap.get(parentId);
    if (parentTask && !parentTask.isMilestone) parentTask.isMilestone = true;
  }

  // Date-derived expected % (planning-tasks-routes.ts:637-657).
  const calcExpected = (t: PlanRollupTask): number | null => {
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

  // First "infer complete from actualEnd" pass for non-parent rows
  // (planning-tasks-routes.ts:728-742).
  for (const t of taskMap.values()) {
    if (childrenMap.has(t.id)) continue;
    const pct = t.percentComplete || 0;
    if (pct < 100 && t.actualEndDate) {
      const actualEnd = new Date(t.actualEndDate);
      if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
        t.percentComplete = 100;
        t.storedActualPct = 100;
        if (
          t.status === "not_started" || t.status === "to_do" ||
          t.status === "active" || !t.status
        ) {
          t.status = "complete";
        }
      }
    }
  }

  // Recursive parent rollup (planning-tasks-routes.ts:659-726, 744-745).
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

    if (minPlannedStart && (!parent.startDate)) parent.startDate = minPlannedStart.toISOString().split("T")[0];
    if (maxPlannedEnd && (!parent.dueDate)) parent.dueDate = maxPlannedEnd.toISOString().split("T")[0];
    if (parent.startDate && parent.dueDate) {
      const ps = new Date(parent.startDate);
      const pe = new Date(parent.dueDate);
      if (!isNaN(ps.getTime()) && !isNaN(pe.getTime())) {
        parent.plannedDurationDays = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / 86400000) + 1);
      }
    }
    if (minActualStart) parent.actualStartDate = minActualStart.toISOString().split("T")[0];
    if (maxActualEnd) parent.actualEndDate = maxActualEnd.toISOString().split("T")[0];

    const computedActual = totalWeight > 0 ? Math.round(totalWeightedPct / totalWeight) : (parent.percentComplete || 0);
    if (parent.storedActualPct != null) {
      parent.percentComplete = parent.storedActualPct;
    } else {
      parent.percentComplete = computedActual;
    }
    parent.computedExpectedPct = totalWeight > 0
      ? Math.round(totalWeightedExpected / totalWeight)
      : calcExpected(parent);
    parent.isParent = true;
    parent.childCount = children.length;
  };

  const rootIds = baselineTasks.filter((t) => !t.parentTaskId).map((t) => t.id);
  for (const rootId of rootIds) computeRollups(rootId);

  // Second "infer complete from actualEnd" pass for leaves
  // (planning-tasks-routes.ts:747-776).
  for (const t of taskMap.values()) {
    if (!childrenMap.has(t.id)) {
      t.computedExpectedPct = calcExpected(t);
    }
    if (t.percentComplete < 100 && t.actualEndDate) {
      const actualEnd = new Date(t.actualEndDate);
      if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
        t.percentComplete = 100;
        t.storedActualPct = 100;
        if (
          t.status === "not_started" || t.status === "to_do" ||
          t.status === "in_progress" || t.status === "active" || !t.status
        ) {
          t.status = "complete";
        }
      }
    }
  }

  return Array.from(taskMap.values());
}

/**
 * Replicates the Plan tab pill (`UnifiedPlanTab.tsx:1183-1242`):
 *   - apply the workstream filter (default 'PM' to match the tab's
 *     default "Project" dropdown)
 *   - pick leaves (!isParent && !childCount)
 *   - call computeProjectProgress with computedExpectedPct as the
 *     expected % source (NOT the raw DB column)
 */
export function computePlanPill(
  tasks: PlanRollupTask[],
  opts: {
    workstream?: "PM" | "ENG" | "QUALITY" | "ALL";
    todayIso?: string;
    fy?: { start: string; end: string; allData: boolean };
  } = {},
): PlanPill {
  const ws = opts.workstream ?? "PM";
  const todayIso = opts.todayIso ?? new Date().toISOString().slice(0, 10);

  const filtered = ws === "ALL" ? tasks : tasks.filter((t) => (t.workstream || "PM") === ws);
  const leafTasks = filtered.filter((t) => !t.isParent && !t.childCount);

  const total = filtered.length;
  const done = filtered.filter((t) => t.status === "complete").length;

  const fyItems = opts.fy && !opts.fy.allData
    ? filtered.filter((t) => {
        const d = t.startDate ?? t.dueDate;
        if (!d) return false;
        const ds = String(d).slice(0, 10);
        return ds >= opts.fy!.start && ds <= opts.fy!.end;
      }).length
    : filtered.length;

  const progress = computeProjectProgress(
    leafTasks.map((t) => ({
      taskNo: t.taskNumber ?? null,
      rowNumber: t.rowNumber ?? null,
      parentRowNumber: t.parentRowNumber ?? null,
      indentLevel: t.indentLevel ?? null,
      durationDays: t.durationDays ?? t.plannedDurationDays ?? null,
      actualPctComplete: typeof t.percentComplete === "number"
        ? (t.percentComplete > 1 ? t.percentComplete / 100 : t.percentComplete)
        : null,
      expectedPctComplete: typeof t.computedExpectedPct === "number"
        ? (t.computedExpectedPct > 1 ? t.computedExpectedPct / 100 : t.computedExpectedPct)
        : null,
      startDate: t.startDate ?? null,
      endDate: t.dueDate ?? null,
      actualStartDate: t.actualStartDate ?? null,
      actualEndDate: t.actualEndDate ?? null,
    })),
    todayIso,
  );

  const hasLeaves = progress.leafCount > 0;
  return {
    actualPct: hasLeaves ? Number(progress.actualPct.toFixed(1)) : null,
    expectedPct: hasLeaves ? Number(progress.expectedPct.toFixed(1)) : null,
    variancePct: hasLeaves ? Number((progress.actualPct - progress.expectedPct).toFixed(1)) : null,
    leafCount: progress.leafCount,
    totalTasks: total,
    doneTasks: done,
    fyItems,
  };
}

/**
 * Convenience: build rollup tasks then compute the pill for a single
 * project, given the raw canonical tasks (from getAllWorkItemsForPlanTab).
 */
export function computePlanPillForProject(
  canonicalTasks: any[],
  projectName: string,
  opts: Parameters<typeof computePlanPill>[1] = {},
): PlanPill {
  const tasks = buildPlanRollupTasksFromCanonical(canonicalTasks, projectName, opts.todayIso);
  return computePlanPill(tasks, opts);
}

/**
 * Batch entry point for dashboards. Fetches PM/ENG/QUALITY work_items
 * for every requested project in ONE DB hit, runs the Plan-tab pipeline
 * per project, and returns a Map<projectId, PlanPill & { projectName }>.
 */
export async function computeAllProjectPlanPills(opts: {
  projectIds?: number[];
  workstream?: "PM" | "ENG" | "QUALITY" | "ALL";
  todayIso?: string;
  fy?: { start: string; end: string; allData: boolean };
} = {}): Promise<Map<number, PlanPill & { projectName: string }>> {
  // Fetch work_items for the requested project set (or all, if not
  // specified). We hit the same projectInfo join that
  // getAllWorkItemsForPlanTab uses so the row set is identical to the
  // Plan tab's per-project fetch — just batched.
  const projectFilter = opts.projectIds && opts.projectIds.length > 0
    ? inArray(workItems.projectId, opts.projectIds)
    : sql`TRUE`;

  const rawItems = await db
    .select({
      id: workItems.id,
      legacyId: workItems.legacyId,
      projectId: workItems.projectId,
      title: workItems.title,
      type: workItems.type,
      status: workItems.status,
      description: workItems.description,
      wbsCode: workItems.wbsCode,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      actualStart: workItems.actualStart,
      actualEnd: workItems.actualEnd,
      duration: workItems.duration,
      actualDuration: workItems.actualDuration,
      percentComplete: workItems.percentComplete,
      isMilestone: workItems.isMilestone,
      indentLevel: workItems.indentLevel,
      parentId: workItems.parentId,
      sortOrder: workItems.sortOrder,
      sourceRow: workItems.sourceRow,
      workstream: workItems.workstream,
      ownerName: workItems.ownerName,
      ownerUserId: workItems.ownerUserId,
      baselineStart: workItems.baselineStart,
      baselineEnd: workItems.baselineEnd,
      baselineDuration: workItems.baselineDuration,
      taskMode: workItems.taskMode,
      manualOverrides: workItems.manualOverrides,
    })
    .from(workItems)
    .where(
      and(
        sql`${workItems.workstream} IN ('PM', 'ENG', 'QUALITY')`,
        isNull(workItems.deletedAt),
        projectFilter,
      ),
    )
    .orderBy(asc(workItems.projectId), asc(workItems.sortOrder), asc(workItems.sourceRow), asc(workItems.id));

  // Map workItems → the same shape getAllWorkItemsForPlanTab produces,
  // so buildPlanRollupTasksFromCanonical's input contract is identical.
  // Parent FK is converted to wbsCode for downstream parentWorkItemId.
  const parentIdToWbs = new Map<number, string>();
  for (const wi of rawItems) {
    if (wi.wbsCode) parentIdToWbs.set(wi.id, wi.wbsCode);
  }

  // Fetch project names for the requested projects.
  const projectIdsSet = new Set<number>();
  for (const wi of rawItems) if (wi.projectId) projectIdsSet.add(wi.projectId);
  if (opts.projectIds) for (const pid of opts.projectIds) projectIdsSet.add(pid);
  const projectIds = Array.from(projectIdsSet);
  const projectNameMap = new Map<number, string>();
  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    for (const row of projects) projectNameMap.set(row.id, row.projectName);
  }

  // 2026-05-19: Apply manual_overrides overlay BEFORE rollup so the
  // service mirrors planning-tasks-routes.ts:405-435 (Workstream B read
  // overlay). Without this, operator edits to percentComplete /
  // expectedPctComplete / dates / duration that the Plan tab pill
  // honours would be silently dropped here and the dashboard numbers
  // would drift from the Plan tab. See server/lib/manual-overrides.ts.
  const overridesUseAllowed = manualOverridesEnabled();
  const readOverride = (overrides: any, key: string): unknown | undefined => {
    if (!overrides || typeof overrides !== "object") return undefined;
    const e = (overrides as Record<string, any>)[key];
    return e && typeof e === "object" && "value" in e ? e.value : undefined;
  };

  // Group by projectId
  const byProject = new Map<number, any[]>();
  for (const wi of rawItems) {
    if (!wi.projectId) continue;
    if (!byProject.has(wi.projectId)) byProject.set(wi.projectId, []);
    const projectName = projectNameMap.get(wi.projectId) || "";
    const indentLevel = wi.indentLevel ?? (wi.wbsCode ? (wi.wbsCode.split(".").length - 1) : 0);

    let oStartDate: any = wi.startDate;
    let oEndDate: any = wi.endDate;
    let oDuration: any = wi.duration;
    let oPctComplete: any = wi.percentComplete != null ? wi.percentComplete : null;
    let oExpectedPct: number | null = null;
    if (overridesUseAllowed && wi.manualOverrides) {
      const ov = wi.manualOverrides;
      const sd = readOverride(ov, "startDate");
      if (sd !== undefined) oStartDate = sd as any;
      const ed = readOverride(ov, "endDate");
      if (ed !== undefined) oEndDate = ed as any;
      const dur = readOverride(ov, "duration");
      if (dur !== undefined) oDuration = dur as any;
      const pct = readOverride(ov, "percentComplete");
      if (pct !== undefined) {
        const v = Number(pct);
        oPctComplete = v > 1 ? Math.round(v) : Math.round(v * 100);
      }
      const exp = readOverride(ov, "expectedPctComplete");
      if (exp !== undefined) {
        const v = Number(exp);
        oExpectedPct = v > 1 ? Math.round(v) : Math.round(v * 100);
      }
    }

    byProject.get(wi.projectId)!.push({
      id: wi.legacyId ?? wi.id,
      workItemId: wi.id,
      projectId: wi.projectId,
      projectName,
      taskName: wi.title,
      taskNo: wi.wbsCode,
      phase: wi.type,
      startDate: oStartDate,
      endDate: oEndDate,
      durationDays: oDuration,
      actualStartDate: wi.actualStart,
      actualEndDate: wi.actualEnd,
      actualDurationDays: wi.actualDuration,
      status: wi.status,
      pctComplete: oPctComplete,
      expectedPctComplete: oExpectedPct,
      comment: wi.description,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
      parentTaskNo: wi.parentId ? (parentIdToWbs.get(wi.parentId) || null) : null,
      parentWorkItemId: wi.parentId || null,
      indentLevel,
      sortOrder: wi.sortOrder ?? 0,
      workstream: wi.workstream,
    });
  }

  const results = new Map<number, PlanPill & { projectName: string }>();
  for (const pid of projectIds) {
    const projectName = projectNameMap.get(pid) || "";
    const canonical = byProject.get(pid) || [];
    if (canonical.length === 0) {
      results.set(pid, {
        projectName,
        actualPct: null,
        expectedPct: null,
        variancePct: null,
        leafCount: 0,
        totalTasks: 0,
        doneTasks: 0,
        fyItems: 0,
      });
      continue;
    }
    const pill = computePlanPillForProject(canonical, projectName, {
      workstream: opts.workstream,
      todayIso: opts.todayIso,
      fy: opts.fy,
    });
    results.set(pid, { projectName, ...pill });
  }
  return results;
}

/**
 * Per-project entry point used by callers that already have a project
 * name. Fetches that project's PM/ENG/QUALITY work_items via the
 * existing Plan-tab adapter and runs the pipeline.
 */
export async function computePlanPillForProjectName(
  projectName: string,
  opts: Parameters<typeof computePlanPill>[1] = {},
): Promise<PlanPill> {
  const canonical = await getAllWorkItemsForPlanTab(projectName);
  return computePlanPillForProject(canonical, projectName, opts);
}
