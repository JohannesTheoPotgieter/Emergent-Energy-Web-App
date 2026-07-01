// ============================================================
// Execution Board service — program-wide delivery control tower.
//
// Composes the batched repository reads into the board + detail payloads.
// All schedule arithmetic is display-only and read VERBATIM from the latest
// import run (normalized_plan_tasks); nothing here writes any table.
//
// Pure threshold/selection logic lives in execution-board-math.ts (db-free,
// unit-tested). This module is the db-bound orchestration layer.
// ============================================================

import {
  executionBoardRepository,
  type InstallerRow,
  type ProcurementDeliveryRow,
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
  selectNextDelivery,
  summarizeEngineering,
  summarizeQuality,
  summarizeWorkstream,
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
 * Fallback Next-delivery from the program plan — the earliest open task whose
 * name mentions "delivery" (the imported tracker's delivery line). Used when a
 * project has no delivery-milestone / procurement record, so the board's
 * Next-delivery column reflects the plan the same way the Deliveries page does.
 */
function nextDeliveryFromPlan(tasks: PlanTask[], today: Date): NextDelivery | null {
  let best: { d: Date; raw: string; label: string } | null = null;
  for (const t of tasks) {
    if (!t.taskName || !t.taskName.toLowerCase().includes("delivery")) continue;
    if ((pctTo100(t.pctComplete) ?? 0) >= 100) continue;
    // A "delivery" is the task's completion, so key off the END date (with the
    // same actual/planned fallback chain as deliveryTaskRows) — the board's
    // Next-delivery column and the Deliveries page must agree on the date.
    const raw = t.endDate ?? t.actualEndDate ?? t.startDate ?? t.actualStartDate ?? null;
    const d = parsePlanDate(raw);
    if (!d) continue;
    if (!best || d < best.d) best = { d, raw: raw as string, label: t.taskName };
  }
  if (!best) return null;
  return { label: best.label, date: best.raw, rag: deliveryRag(best.d, today, false), source: "task" };
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

export interface InstallerSummary {
  count: number;
  primary: string | null;
  list: Array<{ id: number; counterpartyId: number; name: string | null; type: string | null; role: string | null; workPackage: string | null; scopeDescription: string | null }>;
}

export interface BoardRow {
  projectId: number;
  projectName: string;
  phase: string | null;
  sizeKwp: string | null;
  contractValue: string | null;
  schedule: ScheduleSnapshot & { importedAt: string | null };
  nextTask: NextTask | null;
  nextDelivery: NextDelivery | null;
  /** Per-project count of overdue deliveries — lets the client recompute the
   *  Overdue-deliveries KPI for the currently filtered (e.g. by-phase) subset. */
  overdueDeliveryCount: number;
  installers: InstallerSummary;
  pmUserId: number | null;
  pmName: string | null;
  pdUserId: number | null;
  pdName: string | null;
  engineering: WorkstreamSummary;
  quality: WorkstreamSummary;
  flags: ExecutionItemCounts;
  // Editable fields surfaced for the board's inline editors: RAG status
  // (canonical lifecycle RAG) + Edit Project Info modal.
  ragStatus: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  omHandoverDate: string | null;
  clientHandoverDate: string | null;
}

export interface BoardHeader {
  activeCount: number;
  behindCount: number;
  ragRed: number;
  ragAmber: number;
  ragGreen: number;
  weightedActual: number | null;
  weightedExpected: number | null;
  openFlags: number;
  overdueDeliveries: number;
}

export interface BoardResult {
  header: BoardHeader;
  rows: BoardRow[];
}

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
function isBoardUniversePhase(phase: string | null): boolean {
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

  const [installers, milestones, procurement, itemCounts] =
    await Promise.all([
      safe(executionBoardRepository.getInstallersForProjects(ids), [], "installers"),
      safe(executionBoardRepository.getDeliveryMilestonesForProjects(ids), [], "milestones"),
      safe(executionBoardRepository.getOpenProcurementForProjects(ids), [], "procurement"),
      safe(executionReviewRepository.getCountsByProjects(ids), new Map<number, ExecutionItemCounts>(), "item-counts"),
    ]);

  const installersByProject = groupBy(installers, (r) => r.projectId);
  const milestonesByProject = groupBy(milestones, (r) => r.projectId);
  const procurementByProject = groupBy(procurement, (r) => r.projectId);

  const userIds = active.flatMap((p) => [p.pmUserId, p.pdUserId]).filter((x): x is number => typeof x === "number");
  const userNames = await executionBoardRepository.getUserNamesByIds(userIds);

  const rows: BoardRow[] = [];
  let ragRed = 0, ragAmber = 0, ragGreen = 0, openFlags = 0, overdueDeliveries = 0;
  let actualSum = 0, expectedSum = 0, planned = 0;

  for (const p of active) {
    // EXP% is computed live from each task's ACTUAL dates (not the stale Excel
    // "Expected Status" formula cache) — see withComputedExpected.
    const tasks = withComputedExpected(tasksByProject.get(p.id) ?? [], today);
    const schedule = computeScheduleSnapshot(tasks);
    const deliveries = selectNextDelivery(milestonesByProject.get(p.id) ?? [], procurementByProject.get(p.id) ?? [], today);
    // Fall back to a plan task named "delivery" when there's no milestone/procurement record.
    const planDelivery = deliveries.next ? null : nextDeliveryFromPlan(tasks, today);
    const nextDelivery = deliveries.next ?? planDelivery;
    // Eng/QA roll up the plan's ENG / QUALITY workstreams (work_items) — the
    // dedicated modules aren't built yet, so the plan is the source of truth.
    const eng = summarizeWorkstream(tasks.filter((t) => t.workstream === "ENG"));
    const quality = summarizeWorkstream(tasks.filter((t) => t.workstream === "QUALITY"));
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
    const rowOverdueDeliveries = deliveries.overdueCount + (planDelivery?.rag === "red" ? 1 : 0);
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

export interface PlanTaskView {
  taskNo: string | null;
  taskName: string;
  phase: string | null;
  parentTaskNo: string | null;
  isMilestone: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  pctComplete: number | null;
  expectedPctComplete: number | null;
  slipDays: number | null;
  onCriticalPath: boolean;
  comment: string | null;
}

function computeSlip(plannedEnd: string | null, actualEnd: string | null, plannedStart: string | null, actualStart: string | null): number | null {
  const pe = parsePlanDate(plannedEnd);
  const ae = parsePlanDate(actualEnd);
  if (pe && ae) return diffDays(ae, pe);
  const ps = parsePlanDate(plannedStart);
  const as = parsePlanDate(actualStart);
  if (ps && as) return diffDays(as, ps);
  return null;
}

export interface ProjectDetail {
  project: {
    id: number;
    projectName: string;
    phase: string | null;
    sizeKwp: string | null;
    contractValue: string | null;
    pmUserId: number | null;
    pmName: string | null;
    pdUserId: number | null;
    pdName: string | null;
    latestUpdate: string | null;
    latestUpdateBy: string | null;
    latestUpdateAt: string | null;
  };
  schedule: ScheduleSnapshot & { importedAt: string | null; runId: number | null };
  criticalPath: CriticalPathResult;
  planTasks: PlanTaskView[];
  installers: InstallerRow[];
  deliveries: {
    milestones: ProjectDeliveryMilestone[];
    procurement: ProcurementDeliveryRow[];
    tasks: DeliveryProgramRow[];
    next: NextDelivery | null;
    overdueCount: number;
  };
  engineering: WorkstreamSummary;
  quality: WorkstreamSummary;
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

  const [userNames, latest] = await Promise.all([
    executionBoardRepository.getUserNamesByIds(
      [header.pmUserId, header.pdUserId].filter((x): x is number => typeof x === "number"),
    ),
    executionBoardRepository.getLatestUpdate(header.projectName),
  ]);
  // EXP% is computed live from each task's ACTUAL dates (not the stale Excel
  // "Expected Status" formula cache) — see withComputedExpected.
  const tasks = withComputedExpected(plan.tasks, today);
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
    // Eng/QA read the plan's ENG / QUALITY workstreams (work_items) — same as
    // the board — until the dedicated modules come online.
    engineering: summarizeWorkstream(tasks.filter((t) => t.workstream === "ENG")),
    quality: summarizeWorkstream(tasks.filter((t) => t.workstream === "QUALITY")),
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

export interface UpcomingProgramRow {
  projectId: number;
  projectName: string;
  taskNo: string | null;
  taskName: string;
  date: string | null;
  isMilestone: boolean;
}

export async function getUpcomingProgram(daysOut = 14, now: Date = new Date()): Promise<UpcomingProgramRow[]> {
  const today = startOfDay(now);
  const active = await executionBoardRepository.getActiveProjects();
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

export interface DeliveryProgramRow {
  projectId: number;
  projectName: string;
  label: string;
  date: string | null; // sort/anchor date — the needed-on-site date
  rag: ScheduleRag | null; // for procurement: the will-it-make-it signal
  source: "milestone" | "procurement" | "task";
  overdue: boolean;
  complete: boolean;
  // ── delivery planning (procurement orders only) ──
  id?: number; // procurement_items.id — present on editable rows
  editable?: boolean;
  linkedWorkItemId?: number | null;
  neededBy?: string | null; // from the linked execution task's start date
  leadTimeDays?: number | null;
  orderDate?: string | null;
  orderBy?: string | null; // latest safe order date = neededBy − leadTime
  eta?: string | null; // orderDate + leadTime, once ordered
  willMakeIt?: ScheduleRag | null;
  taskNo?: string | null;
  taskTitle?: string | null;
  isLongLead?: boolean;
}

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
      overdue: !complete && d != null && diffDays(d, today) < 0,
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

export async function getDeliveriesProgram(now: Date = new Date()): Promise<DeliveryProgramRow[]> {
  const today = startOfDay(now);
  const active = await executionBoardRepository.getActiveProjects();
  const ids = active.map((p) => p.id);
  const nameById = new Map(active.map((p) => [p.id, p.projectName]));
  const [milestones, procurement, tasksByProject] = await Promise.all([
    executionBoardRepository.getDeliveryMilestonesForProjects(ids),
    executionBoardRepository.getProcurementDeliveriesForProjects(ids),
    executionBoardRepository.getPlanTasksForProjects(ids),
  ]);
  const out: DeliveryProgramRow[] = [];

  for (const m of milestones) {
    const complete = m.status === "complete" || Boolean(m.actualDate);
    const raw = m.actualDate ?? m.plannedDate ?? null;
    const d = parsePlanDate(raw);
    out.push({
      projectId: m.projectId,
      projectName: nameById.get(m.projectId) ?? "",
      label: m.milestoneName,
      date: raw,
      rag: deliveryRag(d, today, complete),
      source: "milestone",
      overdue: !complete && d != null && diffDays(d, today) < 0,
      complete,
    });
  }
  for (const p of procurement) {
    // Needed-on-site = the linked execution task's start date; fall back to the
    // task end, then the manual required date.
    const neededBy = p.taskStartDate ?? p.taskEndDate ?? p.requiredDate;
    const complete = ["received", "invoiced", "closed"].includes(p.status)
      || p.deliveryStatus === "delivered" || Boolean(p.deliveryActualDate);
    const plan = planDelivery(neededBy, p.leadTimeDays, p.orderDate, p.deliveryActualDate, today);
    const nd = parsePlanDate(neededBy);
    out.push({
      projectId: p.projectId,
      projectName: nameById.get(p.projectId) ?? "",
      label: p.title,
      date: neededBy,
      // RAG = "will this delivery make its needed date". Prefer the lead-time
      // planner; when it can't assess (no lead time / not ordered) fall back to
      // the same target-date RAG the milestone/task rows use, so every row's
      // colour means the same thing and an overdue order still reads red.
      rag: plan.willMakeIt ?? deliveryRag(nd, today, complete),
      source: "procurement",
      overdue: !complete && nd != null && diffDays(nd, today) < 0,
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
  // lines (where most projects actually track deliveries). Skip any already
  // promoted to a managed order (deduped by the linked work item).
  const managedWorkItemIds = new Set<number>();
  for (const p of procurement) if (p.linkedWorkItemId != null) managedWorkItemIds.add(p.linkedWorkItemId);
  for (const [projectId, tasks] of tasksByProject) {
    out.push(...deliveryTaskRows(projectId, nameById.get(projectId) ?? "", tasks, today, managedWorkItemIds));
  }
  out.sort((a, b) => (parsePlanDate(a.date)?.getTime() ?? Infinity) - (parsePlanDate(b.date)?.getTime() ?? Infinity));
  return out;
}

export interface AllocationProgramRow {
  projectId: number;
  projectName: string;
  phase: string | null;
  installers: InstallerSummary;
  pmName: string | null;
  pmUserId: number | null;
}

export async function getAllocationsProgram(): Promise<AllocationProgramRow[]> {
  const active = await executionBoardRepository.getActiveProjects();
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
