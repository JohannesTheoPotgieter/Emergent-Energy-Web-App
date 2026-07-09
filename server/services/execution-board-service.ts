// ============================================================
// Execution Board service — program-wide delivery control tower.
//
// Composes the batched repository reads into the board + detail payloads.
// All schedule arithmetic is display-only and read VERBATIM from work_items
// (the canonical Plan-tab table); nothing here writes any table.
//
// Pure threshold/selection logic lives in execution-board-math.ts (db-free,
// unit-tested). This module is the db-bound orchestration layer.
// ============================================================

import {
  executionBoardRepository,
  type InstallerRow,
  type ProcurementDeliveryRow,
  type ProcurementDeliveryFullRow,
} from "../repositories/execution-board-repository";
import {
  executionReviewRepository,
  type ExecutionItemCounts,
} from "../repositories/execution-review-repository";
import { pctTo100, type ScheduleRag } from "../lib/kpi-formulas";
import { PHASES, resolveCanonicalPhase } from "@shared/phases";
import logger from "../lib/logger";
import type { ProjectDeliveryMilestone } from "@shared/schema";
import {
  startOfDay,
  parsePlanDate,
  diffDays,
  computeScheduleSnapshot,
  selectNextTask,
  deliveryRag,
  isDeliveryOverdue,
  selectNextDelivery,
  summarizeEngineering,
  summarizeQuality,
  summarizeWorkstream,
  engineeringWorkstreamFromModule,
  qualityWorkstreamFromModule,
  computeCriticalPath,
  withComputedExpected,
  type PlanTask,
  type ScheduleSnapshot,
  type NextTask,
  type NextDelivery,
  type EngineeringSummary,
  type QualitySummary,
  type WorkstreamSummary,
  type CriticalPathResult,
} from "./execution-board-math";
// Wire payload types shared with the client (single source of truth) — imported
// for local use and re-exported so `./execution-board-service` consumers keep
// resolving them.
import type {
  InstallerSummary,
  BoardRow,
  BoardHeader,
  BoardResult,
  PlanTaskView,
  ProjectDetail,
  DeliveryProgramRow,
  UpcomingProgramRow,
  AllocationProgramRow,
} from "@shared/execution-board-types";
export type {
  InstallerSummary,
  BoardRow,
  BoardHeader,
  BoardResult,
  PlanTaskView,
  ProjectDetail,
  DeliveryProgramRow,
  UpcomingProgramRow,
  AllocationProgramRow,
};

function groupBy<T>(rows: T[], key: (r: T) => number | null | undefined): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const arr = out.get(k) ?? [];
    arr.push(r);
    out.set(k, arr);
  }
  return out;
}

function emptyCounts(): ExecutionItemCounts {
  return { open: 0, flagged: 0, actioned: 0, closed: 0, total: 0 };
}

/**
 * Resolve a capability fetch, degrading to a fallback on error so one failing
 * domain greys out a column instead of blanking the whole board (the board is
 * a radar — partial data beats no data).
 */
async function safe<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await p;
  } catch (err) {
    logger.error(`[execution-board] ${label} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

// ──────────────────────────────── board ─────────────────────────────────────

// The board payload types (InstallerSummary / BoardRow / BoardHeader /
// BoardResult) live in @shared/execution-board-types and are re-exported above.
// BoardRow.flags is ExecutionItemCounts, structurally the shared ItemCounts.

// The Execution board's UNIVERSE — every project the board can show: canonical
// phases from Financial Close (display position 3) through Compliance Handover,
// PLUS the terminal Hold/Done branches. Earlier phases (assessment / design)
// and unrecognised phases are excluded. The board defaults to Financial Close →
// Client Handover on the CLIENT (so later phases / Hold / Done are present but
// only shown when explicitly filtered to). Derived from the canonical phase list.
const BOARD_UNIVERSE_PHASE_LABELS = new Set(
  PHASES
    .filter((p) => (p.displayNumber != null && p.displayNumber >= 3) || p.isTerminal)
    .map((p) => p.label),
);
export function isBoardUniversePhase(phase: string | null): boolean {
  if (!phase) return false;
  const label = resolveCanonicalPhase(phase)?.label ?? phase;
  return BOARD_UNIVERSE_PHASE_LABELS.has(label);
}

function installerSummary(rows: InstallerRow[]): InstallerSummary {
  return {
    count: rows.length,
    primary: rows[0]?.counterpartyName ?? null,
    list: rows.map((r) => ({ id: r.id, counterpartyId: r.counterpartyId, name: r.counterpartyName, type: r.counterpartyType, role: r.role, workPackage: r.workPackage, scopeDescription: r.scopeDescription })),
  };
}

export async function getBoard(now: Date = new Date()): Promise<BoardResult> {
  const today = startOfDay(now);
  // Return the full board UNIVERSE — Financial Close forward + terminal
  // Hold/Done — so later-phase / on-hold / completed projects are available to
  // the board and appear when explicitly filtered to. The client defaults the
  // view to Financial Close → Client Handover. Earlier (assessment/design)
  // phases stay excluded.
  // includeArchived: the board shows the full phase universe, so a by-phase
  // filter (e.g. 3 Months Post HO Review / Hold / Done) returns every project in
  // that phase, including completed/archived ones — not just active-delivery rows.
  const allActive = await executionBoardRepository.getActiveProjects(true);
  const active = allActive.filter((p) => isBoardUniversePhase(p.phase));

  // Diagnostic — phase distribution of ALL active projects so an empty by-phase
  // filter is explainable from the environment (which phases actually have
  // active projects, and how many reach the board universe). One line per load.
  try {
    const dist: Record<string, number> = {};
    for (const p of allActive) {
      const label = p.phase ? (resolveCanonicalPhase(p.phase)?.label ?? p.phase) : "(none)";
      dist[label] = (dist[label] ?? 0) + 1;
    }
    console.log(`[execution-board][phase-diag] activeTotal=${allActive.length} onBoard=${active.length} byPhase=${JSON.stringify(dist)}`);
  } catch { /* diagnostics must never break the board */ }
  const ids = active.map((p) => p.id);

  const tasksByProject = await safe(
    executionBoardRepository.getPlanTasksForProjects(ids),
    new Map<number, PlanTask[]>(),
    "plan-tasks",
  );

  const [installers, milestones, procurement, itemCounts, engStages, openEngCounts, snags, qcSet] =
    await Promise.all([
      safe(executionBoardRepository.getInstallersForProjects(ids), [], "installers"),
      safe(executionBoardRepository.getDeliveryMilestonesForProjects(ids), [], "milestones"),
      // Full procurement rows (with linked-task dates) so the board builds the
      // SAME delivery-row model as the program Deliveries list — this read
      // already excludes soft-deleted orders.
      safe(executionBoardRepository.getProcurementDeliveriesForProjects(ids), [], "procurement"),
      safe(executionReviewRepository.getCountsByProjects(ids), new Map<number, ExecutionItemCounts>(), "item-counts"),
      // Real Engineering / Quality module signals for the Eng/QA columns; each
      // fetch is safe() so a failing domain falls back to the plan rollup rather
      // than blanking the board.
      safe(executionBoardRepository.getEngStagesForProjects(ids), [], "eng-stages"),
      safe(executionBoardRepository.getOpenEngTaskCounts(ids), new Map<number, number>(), "eng-tasks"),
      safe(executionBoardRepository.getSnagsForProjects(ids), [], "snags"),
      safe(executionBoardRepository.getQcLinkedProjectIds(ids), new Set<number>(), "qc-links"),
    ]);

  const installersByProject = groupBy(installers, (r) => r.projectId);
  const milestonesByProject = groupBy(milestones, (r) => r.projectId);
  const procurementByProject = groupBy(procurement, (r) => r.projectId);
  const engStagesByProject = groupBy(engStages, (r) => r.projectId);
  const snagsByProject = groupBy(snags, (r) => r.projectId);

  const userIds = active.flatMap((p) => [p.pmUserId, p.pdUserId]).filter((x): x is number => typeof x === "number");
  const userNames = await executionBoardRepository.getUserNamesByIds(userIds);

  const rows: BoardRow[] = [];
  let ragRed = 0, ragAmber = 0, ragGreen = 0, openFlags = 0, overdueDeliveries = 0;
  let actualSum = 0, expectedSum = 0, planned = 0;

  for (const p of active) {
    // EXP% is computed live from planned dates (not the stale Excel "Expected
    // Status" formula cache) — see withComputedExpected / liveExpectedFraction.
    const tasks = withComputedExpected(tasksByProject.get(p.id) ?? [], today);
    const schedule = computeScheduleSnapshot(tasks);

    // Deliveries: build the SAME canonical row model as the program Deliveries
    // list (milestones + procurement + delivery-named plan tasks, deduped), so
    // the board's Overdue-deliveries KPI equals the list's overdue count. The
    // Next-delivery column is the earliest still-open row.
    const deliveryRows = buildDeliveryRows(
      p.id, p.projectName, milestonesByProject.get(p.id) ?? [], procurementByProject.get(p.id) ?? [], tasks, today,
    );
    const rowOverdueDeliveries = deliveryRows.filter((r) => r.overdue).length;
    const nextRow = deliveryRows.find((r) => !r.complete && r.date != null) ?? null;
    const nextDelivery: NextDelivery | null = nextRow
      ? { label: nextRow.label, date: nextRow.date, rag: nextRow.rag, source: nextRow.source }
      : null;

    // Eng/QA: prefer the real Engineering / Quality module when the project has
    // data there; otherwise fall back to the plan's ENG / QUALITY workstream
    // rollup (work_items) so the column is never blank.
    const engStagesP = engStagesByProject.get(p.id) ?? [];
    const openEngP = openEngCounts.get(p.id) ?? 0;
    const eng = engStagesP.length > 0 || openEngP > 0
      ? engineeringWorkstreamFromModule(engStagesP, openEngP)
      : summarizeWorkstream(tasks.filter((t) => t.workstream === "ENG"));
    const snagsP = snagsByProject.get(p.id) ?? [];
    const hasQcpP = qcSet.has(p.id);
    const quality = snagsP.length > 0 || hasQcpP
      ? qualityWorkstreamFromModule(snagsP, hasQcpP, today)
      : summarizeWorkstream(tasks.filter((t) => t.workstream === "QUALITY"));

    const flags = itemCounts.get(p.id) ?? emptyCounts();

    if (schedule.rag === "red") ragRed += 1;
    else if (schedule.rag === "amber") ragAmber += 1;
    else if (schedule.rag === "green") ragGreen += 1;
    if (schedule.actualPct != null && schedule.expectedPct != null) {
      actualSum += schedule.actualPct;
      expectedSum += schedule.expectedPct;
      planned += 1;
    }
    openFlags += flags.open + flags.flagged;
    overdueDeliveries += rowOverdueDeliveries;

    rows.push({
      projectId: p.id,
      projectName: p.projectName,
      phase: p.phase,
      sizeKwp: p.sizeKwp,
      contractValue: p.contractValue,
      schedule: { ...schedule, importedAt: null },
      nextTask: selectNextTask(tasks, today, 14),
      nextDelivery,
      overdueDeliveryCount: rowOverdueDeliveries,
      installers: installerSummary(installersByProject.get(p.id) ?? []),
      pmUserId: p.pmUserId,
      pmName: (p.pmUserId != null ? userNames.get(p.pmUserId) : null) ?? p.pmText ?? null,
      pdUserId: p.pdUserId,
      pdName: (p.pdUserId != null ? userNames.get(p.pdUserId) : null) ?? p.pdText ?? null,
      engineering: eng,
      quality,
      flags,
      ragStatus: p.ragStatus,
      constructionStartDate: p.constructionStartDate,
      commissioningDate: p.commissioningDate,
      omHandoverDate: p.omHandoverDate,
      clientHandoverDate: p.clientHandoverDate,
    });
  }

  // Worst-RAG first (red, amber, green, none), then most behind.
  const ragWeight: Record<string, number> = { red: 0, amber: 1, green: 2 };
  rows.sort((a, b) => {
    const wa = a.schedule.rag ? ragWeight[a.schedule.rag] : 3;
    const wb = b.schedule.rag ? ragWeight[b.schedule.rag] : 3;
    if (wa !== wb) return wa - wb;
    return (a.schedule.variance ?? 0) - (b.schedule.variance ?? 0);
  });

  const header: BoardHeader = {
    activeCount: active.length,
    behindCount: ragRed,
    ragRed,
    ragAmber,
    ragGreen,
    weightedActual: planned > 0 ? Math.round((actualSum / planned) * 10) / 10 : null,
    weightedExpected: planned > 0 ? Math.round((expectedSum / planned) * 10) / 10 : null,
    openFlags,
    overdueDeliveries,
  };
  return { header, rows };
}

// ──────────────────────────────── detail ────────────────────────────────────

function computeSlip(plannedEnd: string | null, actualEnd: string | null, plannedStart: string | null, actualStart: string | null): number | null {
  const pe = parsePlanDate(plannedEnd);
  const ae = parsePlanDate(actualEnd);
  if (pe && ae) return diffDays(ae, pe);
  const ps = parsePlanDate(plannedStart);
  const as = parsePlanDate(actualStart);
  if (ps && as) return diffDays(as, ps);
  return null;
}

export async function getProjectDetail(projectId: number, now: Date = new Date()): Promise<ProjectDetail | null> {
  const today = startOfDay(now);
  const header = await executionBoardRepository.getProjectHeader(projectId);
  if (!header) return null;

  const [plan, installers, milestones, procurement] = await Promise.all([
    executionBoardRepository.getPlanTasksForProject(projectId),
    executionBoardRepository.getInstallersForProjects([projectId]),
    executionBoardRepository.getDeliveryMilestonesForProjects([projectId]),
    executionBoardRepository.getOpenProcurementForProjects([projectId]),
  ]);

  const [userNames, latest, engStages, openEngCounts, snagRows, qcSet] = await Promise.all([
    executionBoardRepository.getUserNamesByIds(
      [header.pmUserId, header.pdUserId].filter((x): x is number => typeof x === "number"),
    ),
    executionBoardRepository.getLatestUpdate(header.projectName),
    // Real Eng/Quality module signals for this project — safe() so a failing
    // domain greys the column (falls back to the plan-workstream rollup).
    safe(executionBoardRepository.getEngStagesForProjects([projectId]), [], "detail-eng-stages"),
    safe(executionBoardRepository.getOpenEngTaskCounts([projectId]), new Map<number, number>(), "detail-eng-tasks"),
    safe(executionBoardRepository.getSnagsForProjects([projectId]), [], "detail-snags"),
    safe(executionBoardRepository.getQcLinkedProjectIds([projectId]), new Set<number>(), "detail-qc-links"),
  ]);
  // EXP% is computed live from planned dates (not the stale Excel "Expected
  // Status" formula cache) — see withComputedExpected / liveExpectedFraction.
  const tasks = withComputedExpected(plan.tasks, today);

  // Eng/QA: prefer the real Engineering / Quality module; fall back to the plan
  // ENG / QUALITY workstream rollup when the project has no module data.
  const openEng = openEngCounts.get(projectId) ?? 0;
  const hasQcp = qcSet.has(projectId);
  const engineering = engStages.length > 0 || openEng > 0
    ? engineeringWorkstreamFromModule(engStages, openEng)
    : summarizeWorkstream(tasks.filter((t) => t.workstream === "ENG"));
  const quality = snagRows.length > 0 || hasQcp
    ? qualityWorkstreamFromModule(snagRows, hasQcp, today)
    : summarizeWorkstream(tasks.filter((t) => t.workstream === "QUALITY"));
  const schedule = computeScheduleSnapshot(tasks);
  const criticalPath = computeCriticalPath(tasks);
  const criticalSet = new Set(criticalPath.criticalTaskNos);
  const deliveries = selectNextDelivery(milestones, procurement, today);

  const planTasks: PlanTaskView[] = tasks.map((t) => ({
    taskNo: t.taskNo ?? null,
    taskName: t.taskName,
    phase: t.phase ?? null,
    parentTaskNo: t.parentTaskNo ?? null,
    isMilestone: Boolean(t.isMilestone),
    plannedStart: t.startDate ?? null,
    plannedEnd: t.endDate ?? null,
    actualStart: t.actualStartDate ?? null,
    actualEnd: t.actualEndDate ?? null,
    pctComplete: pctTo100(t.pctComplete),
    expectedPctComplete: pctTo100(t.expectedPctComplete),
    slipDays: computeSlip(t.endDate ?? null, t.actualEndDate ?? null, t.startDate ?? null, t.actualStartDate ?? null),
    onCriticalPath: t.taskNo != null && criticalSet.has(t.taskNo),
    comment: t.comment ?? null,
  }));

  return {
    project: {
      id: header.id,
      projectName: header.projectName,
      phase: header.phase,
      sizeKwp: header.sizeKwp,
      contractValue: header.contractValue,
      pmUserId: header.pmUserId,
      pmName: (header.pmUserId != null ? userNames.get(header.pmUserId) : null) ?? header.pmText ?? null,
      pdUserId: header.pdUserId,
      pdName: (header.pdUserId != null ? userNames.get(header.pdUserId) : null) ?? header.pdText ?? null,
      latestUpdate: latest?.latestUpdate ?? null,
      latestUpdateBy: latest?.latestUpdateBy ?? null,
      latestUpdateAt: latest?.latestUpdateAt ? latest.latestUpdateAt.toISOString() : null,
    },
    schedule: { ...schedule, importedAt: plan.importedAt ? plan.importedAt.toISOString() : null, runId: plan.runId },
    criticalPath,
    planTasks,
    installers,
    deliveries: {
      milestones,
      procurement,
      // Plan tasks named "delivery" — the same source the program Deliveries
      // list uses, so deliveries correlate through every lens.
      tasks: deliveryTaskRows(projectId, header.projectName, tasks, today),
      next: deliveries.next,
      overdueCount: deliveries.overdueCount,
    },
    engineering,
    quality,
  };
}

// ──────────────────────────── per-domain summaries ───────────────────────────

export async function getEngineeringSummary(projectId: number): Promise<EngineeringSummary> {
  const [stages, open] = await Promise.all([
    executionBoardRepository.getEngStagesForProjects([projectId]),
    executionBoardRepository.getOpenEngTaskCounts([projectId]),
  ]);
  return summarizeEngineering(stages, open.get(projectId) ?? 0);
}

export async function getQualitySummary(projectId: number, now: Date = new Date()): Promise<QualitySummary> {
  const [rows, qcSet] = await Promise.all([
    executionBoardRepository.getSnagsForProjects([projectId]),
    executionBoardRepository.getQcLinkedProjectIds([projectId]),
  ]);
  return summarizeQuality(rows, qcSet.has(projectId), startOfDay(now));
}

// ──────────────────────────── program-wide lists ─────────────────────────────

export async function getUpcomingProgram(daysOut = 14, now: Date = new Date()): Promise<UpcomingProgramRow[]> {
  const today = startOfDay(now);
  // Same project universe as the board (active-only + Financial-Close-forward
  // phase filter) so all four Execution lenses show the same set.
  const active = (await executionBoardRepository.getActiveProjects()).filter((p) => isBoardUniversePhase(p.phase));
  const ids = active.map((p) => p.id);
  const tasksByProject = await executionBoardRepository.getPlanTasksForProjects(ids);
  const nameById = new Map(active.map((p) => [p.id, p.projectName]));

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysOut);
  const out: UpcomingProgramRow[] = [];
  for (const [projectId, tasks] of tasksByProject) {
    const parentSet = new Set(tasks.map((t) => t.parentTaskNo).filter((p): p is string => Boolean(p)));
    for (const t of tasks) {
      if (t.taskNo != null && parentSet.has(t.taskNo)) continue;
      if ((pctTo100(t.pctComplete) ?? 0) >= 100) continue;
      const start = parsePlanDate(t.startDate) ?? parsePlanDate(t.actualStartDate);
      if (!start || start < today || start > horizon) continue;
      out.push({
        projectId,
        projectName: nameById.get(projectId) ?? "",
        taskNo: t.taskNo ?? null,
        taskName: t.taskName,
        date: t.startDate ?? t.actualStartDate ?? null,
        isMilestone: Boolean(t.isMilestone),
      });
    }
  }
  out.sort((a, b) => (parsePlanDate(a.date)?.getTime() ?? 0) - (parsePlanDate(b.date)?.getTime() ?? 0));
  return out;
}

// DeliveryProgramRow lives in @shared/execution-board-types (re-exported above);
// its `rag`/`willMakeIt` are the shared Rag (= the server's ScheduleRag | null).

/** yyyy-mm-dd shifted by n days (n may be negative). */
function shiftIso(iso: string | null, days: number): string | null {
  const d = parsePlanDate(iso);
  if (!d) return null;
  const shifted = new Date(d.getTime() + days * 86_400_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

/**
 * Plan a procurement order backward from the date it's needed on site. Returns
 * the latest-safe order date, the ETA once ordered, and a will-it-make-it RAG:
 *   delivered  → did the actual delivery beat the needed date? (green/red)
 *   ordered    → ETA (orderDate+lead) vs needed: green / amber (≤7d slack) / red
 *   not ordered→ order-by (needed−lead) vs today: green / amber (≤7d) / red (late)
 *   missing lead time or needed date → null (can't assess yet)
 */
export function planDelivery(
  neededBy: string | null,
  leadTimeDays: number | null,
  orderDate: string | null,
  deliveredDate: string | null,
  today: Date,
): { orderBy: string | null; eta: string | null; willMakeIt: ScheduleRag | null } {
  if (deliveredDate) {
    const made = !neededBy || (parsePlanDate(deliveredDate)?.getTime() ?? 0) <= (parsePlanDate(neededBy)?.getTime() ?? Infinity);
    return { orderBy: null, eta: deliveredDate, willMakeIt: made ? "green" : "red" };
  }
  const rag = (slackDays: number): ScheduleRag => (slackDays < 0 ? "red" : slackDays <= 7 ? "amber" : "green");
  if (orderDate != null && leadTimeDays != null) {
    const eta = shiftIso(orderDate, leadTimeDays);
    const etaD = parsePlanDate(eta);
    const needD = parsePlanDate(neededBy);
    return { orderBy: null, eta, willMakeIt: etaD && needD ? rag(diffDays(needD, etaD)) : null };
  }
  if (leadTimeDays != null && neededBy != null) {
    const orderBy = shiftIso(neededBy, -leadTimeDays);
    const obD = parsePlanDate(orderBy);
    return { orderBy, eta: null, willMakeIt: obD ? rag(diffDays(obD, today)) : null };
  }
  return { orderBy: null, eta: null, willMakeIt: null };
}

/**
 * Build delivery rows from plan tasks whose name mentions "delivery" — the
 * imported tracker's delivery lines, where most projects actually track
 * deliveries. Shared by the program Deliveries list and the per-project detail
 * so both read deliveries from exactly the same source.
 */
function deliveryTaskRows(
  projectId: number,
  projectName: string,
  tasks: PlanTask[],
  today: Date,
  managedWorkItemIds: Set<number> = new Set(),
): DeliveryProgramRow[] {
  const rows: DeliveryProgramRow[] = [];
  for (const t of tasks) {
    if (!t.taskName?.toLowerCase().includes("delivery")) continue;
    // Already promoted to a managed order → that order row represents it instead.
    if (t.id != null && managedWorkItemIds.has(t.id)) continue;
    const complete = (pctTo100(t.pctComplete) ?? 0) >= 100;
    const raw = t.endDate ?? t.actualEndDate ?? t.startDate ?? t.actualStartDate ?? null;
    const d = parsePlanDate(raw);
    rows.push({
      projectId,
      projectName,
      label: t.taskName,
      date: raw,
      rag: deliveryRag(d, today, complete),
      source: "task",
      overdue: isDeliveryOverdue({ date: raw, complete }, today),
      complete,
      // Promotable: editing creates a managed order linked to this work item, so
      // it can capture lead time + order date. No procurement id yet → create mode.
      editable: t.id != null,
      linkedWorkItemId: t.id ?? null,
      taskNo: t.taskNo,
      neededBy: raw,
    });
  }
  rows.sort((a, b) => (parsePlanDate(a.date)?.getTime() ?? Infinity) - (parsePlanDate(b.date)?.getTime() ?? Infinity));
  return rows;
}

/**
 * Canonical per-project delivery rows — milestones + procurement orders +
 * delivery-named plan tasks, deduped (a plan task promoted to a managed order is
 * represented by the order, not the task). This is the SINGLE row model shared
 * by the board's Overdue-deliveries KPI (see getBoard) and the program
 * Deliveries list (getDeliveriesProgram), so both agree on which deliveries
 * exist and which are overdue. Overdue is decided by the canonical
 * isDeliveryOverdue against each row's anchor `date` (neededBy for procurement).
 */
export function buildDeliveryRows(
  projectId: number,
  projectName: string,
  milestones: ProjectDeliveryMilestone[],
  procurement: ProcurementDeliveryFullRow[],
  planTasks: PlanTask[],
  today: Date,
): DeliveryProgramRow[] {
  const rows: DeliveryProgramRow[] = [];

  for (const m of milestones) {
    const complete = m.status === "complete" || Boolean(m.actualDate);
    const raw = m.actualDate ?? m.plannedDate ?? null;
    rows.push({
      projectId,
      projectName,
      label: m.milestoneName,
      date: raw,
      rag: deliveryRag(parsePlanDate(raw), today, complete),
      source: "milestone",
      overdue: isDeliveryOverdue({ date: raw, complete }, today),
      complete,
    });
  }

  const managedWorkItemIds = new Set<number>();
  for (const p of procurement) if (p.linkedWorkItemId != null) managedWorkItemIds.add(p.linkedWorkItemId);
  for (const p of procurement) {
    // Needed-on-site = the linked execution task's start date; fall back to the
    // task end, then the manual required date. This IS the canonical anchor date.
    const neededBy = p.taskStartDate ?? p.taskEndDate ?? p.requiredDate;
    const complete = ["received", "invoiced", "closed"].includes(p.status)
      || p.deliveryStatus === "delivered" || Boolean(p.deliveryActualDate);
    const plan = planDelivery(neededBy, p.leadTimeDays, p.orderDate, p.deliveryActualDate, today);
    rows.push({
      projectId,
      projectName,
      label: p.title,
      date: neededBy,
      // RAG = "will this delivery make its needed date". Prefer the lead-time
      // planner; when it can't assess (no lead time / not ordered) fall back to
      // the same target-date RAG the milestone/task rows use, so every row's
      // colour means the same thing and an overdue order still reads red.
      rag: plan.willMakeIt ?? deliveryRag(parsePlanDate(neededBy), today, complete),
      source: "procurement",
      overdue: isDeliveryOverdue({ date: neededBy, complete }, today),
      complete,
      id: p.id,
      editable: true,
      linkedWorkItemId: p.linkedWorkItemId,
      neededBy,
      leadTimeDays: p.leadTimeDays,
      orderDate: p.orderDate,
      orderBy: plan.orderBy,
      eta: plan.eta,
      willMakeIt: plan.willMakeIt,
      taskNo: p.taskNo,
      taskTitle: p.taskTitle,
      isLongLead: p.isLongLead ?? false,
    });
  }

  // Plan tasks whose name mentions "delivery" — the imported tracker's delivery
  // lines. Skip any already promoted to a managed order (deduped by work item).
  rows.push(...deliveryTaskRows(projectId, projectName, planTasks, today, managedWorkItemIds));
  rows.sort((a, b) => (parsePlanDate(a.date)?.getTime() ?? Infinity) - (parsePlanDate(b.date)?.getTime() ?? Infinity));
  return rows;
}

export async function getDeliveriesProgram(now: Date = new Date()): Promise<DeliveryProgramRow[]> {
  const today = startOfDay(now);
  // Same project universe as the board (Financial-Close-forward + terminal
  // Hold/Done) so all four Execution lenses show the same set. These lists use
  // active-only projects; the board additionally includes archived so a by-phase
  // filter can surface completed projects.
  const active = (await executionBoardRepository.getActiveProjects()).filter((p) => isBoardUniversePhase(p.phase));
  const ids = active.map((p) => p.id);
  const nameById = new Map(active.map((p) => [p.id, p.projectName]));
  const [milestones, procurement, tasksByProject] = await Promise.all([
    executionBoardRepository.getDeliveryMilestonesForProjects(ids),
    executionBoardRepository.getProcurementDeliveriesForProjects(ids),
    executionBoardRepository.getPlanTasksForProjects(ids),
  ]);
  const milestonesByProject = groupBy(milestones, (r) => r.projectId);
  const procurementByProject = groupBy(procurement, (r) => r.projectId);
  const out: DeliveryProgramRow[] = [];
  for (const id of ids) {
    out.push(...buildDeliveryRows(
      id, nameById.get(id) ?? "", milestonesByProject.get(id) ?? [], procurementByProject.get(id) ?? [], tasksByProject.get(id) ?? [], today,
    ));
  }
  out.sort((a, b) => (parsePlanDate(a.date)?.getTime() ?? Infinity) - (parsePlanDate(b.date)?.getTime() ?? Infinity));
  return out;
}

export async function getAllocationsProgram(): Promise<AllocationProgramRow[]> {
  // Same project universe as the board (active-only + Financial-Close-forward
  // phase filter) so all four Execution lenses show the same set.
  const active = (await executionBoardRepository.getActiveProjects()).filter((p) => isBoardUniversePhase(p.phase));
  const ids = active.map((p) => p.id);
  const [installers, userNames] = await Promise.all([
    executionBoardRepository.getInstallersForProjects(ids),
    executionBoardRepository.getUserNamesByIds(
      active.map((p) => p.pmUserId).filter((x): x is number => typeof x === "number"),
    ),
  ]);
  const byProject = groupBy(installers, (r) => r.projectId);
  return active.map((p) => ({
    projectId: p.id,
    projectName: p.projectName,
    phase: p.phase,
    installers: installerSummary(byProject.get(p.id) ?? []),
    pmName: (p.pmUserId != null ? userNames.get(p.pmUserId) : null) ?? p.pmText ?? null,
    pmUserId: p.pmUserId,
  }));
}
