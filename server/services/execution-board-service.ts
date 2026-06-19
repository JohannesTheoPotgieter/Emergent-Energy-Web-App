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
  type ScheduleSnapshot,
  type NextTask,
  type NextDelivery,
  type EngineeringSummary,
  type QualitySummary,
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
  list: Array<{ name: string | null; type: string | null; workPackage: string | null }>;
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
  installers: InstallerSummary;
  pmUserId: number | null;
  pmName: string | null;
  pdUserId: number | null;
  pdName: string | null;
  engineering: EngineeringSummary;
  quality: QualitySummary;
  flags: ExecutionItemCounts;
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

function installerSummary(rows: InstallerRow[]): InstallerSummary {
  return {
    count: rows.length,
    primary: rows[0]?.counterpartyName ?? null,
    list: rows.map((r) => ({ name: r.counterpartyName, type: r.counterpartyType, workPackage: r.workPackage })),
  };
}

export async function getBoard(now: Date = new Date()): Promise<BoardResult> {
  const today = startOfDay(now);
  const active = await executionBoardRepository.getActiveProjects();
  const ids = active.map((p) => p.id);

  const latestRuns = await safe(
    executionBoardRepository.getLatestRunIdsByProjects(ids),
    new Map<number, { runId: number; uploadedAt: Date | null }>(),
    "latest-runs",
  );
  const runIds = [...latestRuns.values()].map((v) => v.runId);
  const runToProject = new Map<number, number>();
  for (const [projectId, meta] of latestRuns) runToProject.set(meta.runId, projectId);
  const allTasks = await safe(executionBoardRepository.getPlanTasksByRunIds(runIds), [], "plan-tasks");
  const tasksByProject = groupBy(allTasks, (t) => (t.importRunId != null ? runToProject.get(t.importRunId) : undefined));

  const [installers, milestones, procurement, engStages, engOpenTasks, snagRows, qcSet, itemCounts] =
    await Promise.all([
      safe(executionBoardRepository.getInstallersForProjects(ids), [], "installers"),
      safe(executionBoardRepository.getDeliveryMilestonesForProjects(ids), [], "milestones"),
      safe(executionBoardRepository.getOpenProcurementForProjects(ids), [], "procurement"),
      safe(executionBoardRepository.getEngStagesForProjects(ids), [], "eng-stages"),
      safe(executionBoardRepository.getOpenEngTaskCounts(ids), new Map<number, number>(), "eng-tasks"),
      safe(executionBoardRepository.getSnagsForProjects(ids), [], "snags"),
      safe(executionBoardRepository.getQcLinkedProjectIds(ids), new Set<number>(), "qc-links"),
      safe(executionReviewRepository.getCountsByProjects(ids), new Map<number, ExecutionItemCounts>(), "item-counts"),
    ]);

  const installersByProject = groupBy(installers, (r) => r.projectId);
  const milestonesByProject = groupBy(milestones, (r) => r.projectId);
  const procurementByProject = groupBy(procurement, (r) => r.projectId);
  const engByProject = groupBy(engStages, (r) => r.projectId);
  const snagsByProject = groupBy(snagRows, (r) => r.projectId);

  const userIds = active.flatMap((p) => [p.pmUserId, p.pdUserId]).filter((x): x is number => typeof x === "number");
  const userNames = await executionBoardRepository.getUserNamesByIds(userIds);

  const rows: BoardRow[] = [];
  let ragRed = 0, ragAmber = 0, ragGreen = 0, openFlags = 0, overdueDeliveries = 0;
  let actualSum = 0, expectedSum = 0, planned = 0;

  for (const p of active) {
    const tasks = tasksByProject.get(p.id) ?? [];
    const schedule = computeScheduleSnapshot(tasks);
    const importedAt = latestRuns.get(p.id)?.uploadedAt ?? null;
    const deliveries = selectNextDelivery(milestonesByProject.get(p.id) ?? [], procurementByProject.get(p.id) ?? [], today);
    const eng = summarizeEngineering(engByProject.get(p.id) ?? [], engOpenTasks.get(p.id) ?? 0);
    const quality = summarizeQuality(snagsByProject.get(p.id) ?? [], qcSet.has(p.id), today);
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
    overdueDeliveries += deliveries.overdueCount;

    rows.push({
      projectId: p.id,
      projectName: p.projectName,
      phase: p.phase,
      sizeKwp: p.sizeKwp,
      contractValue: p.contractValue,
      schedule: { ...schedule, importedAt: importedAt ? importedAt.toISOString() : null },
      nextTask: selectNextTask(tasks, today, 14),
      nextDelivery: deliveries.next,
      installers: installerSummary(installersByProject.get(p.id) ?? []),
      pmUserId: p.pmUserId,
      pmName: (p.pmUserId != null ? userNames.get(p.pmUserId) : null) ?? p.pmText ?? null,
      pdUserId: p.pdUserId,
      pdName: (p.pdUserId != null ? userNames.get(p.pdUserId) : null) ?? p.pdText ?? null,
      engineering: eng,
      quality,
      flags,
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
  planTasks: PlanTaskView[];
  installers: InstallerRow[];
  deliveries: {
    milestones: ProjectDeliveryMilestone[];
    procurement: ProcurementDeliveryRow[];
    next: NextDelivery | null;
    overdueCount: number;
  };
  engineering: EngineeringSummary;
  quality: QualitySummary;
}

export async function getProjectDetail(projectId: number, now: Date = new Date()): Promise<ProjectDetail | null> {
  const today = startOfDay(now);
  const header = await executionBoardRepository.getProjectHeader(projectId);
  if (!header) return null;

  const [plan, installers, milestones, procurement, engStages, engOpen, snagRows, qcSet] = await Promise.all([
    executionBoardRepository.getPlanTasksForProject(projectId),
    executionBoardRepository.getInstallersForProjects([projectId]),
    executionBoardRepository.getDeliveryMilestonesForProjects([projectId]),
    executionBoardRepository.getOpenProcurementForProjects([projectId]),
    executionBoardRepository.getEngStagesForProjects([projectId]),
    executionBoardRepository.getOpenEngTaskCounts([projectId]),
    executionBoardRepository.getSnagsForProjects([projectId]),
    executionBoardRepository.getQcLinkedProjectIds([projectId]),
  ]);

  const [userNames, latest] = await Promise.all([
    executionBoardRepository.getUserNamesByIds(
      [header.pmUserId, header.pdUserId].filter((x): x is number => typeof x === "number"),
    ),
    executionBoardRepository.getLatestUpdate(header.projectName),
  ]);
  const schedule = computeScheduleSnapshot(plan.tasks);
  const deliveries = selectNextDelivery(milestones, procurement, today);

  const planTasks: PlanTaskView[] = plan.tasks.map((t) => ({
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
    planTasks,
    installers,
    deliveries: { milestones, procurement, next: deliveries.next, overdueCount: deliveries.overdueCount },
    engineering: summarizeEngineering(engStages, engOpen.get(projectId) ?? 0),
    quality: summarizeQuality(snagRows, qcSet.has(projectId), today),
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
  const latestRuns = await executionBoardRepository.getLatestRunIdsByProjects(ids);
  const runIds = [...latestRuns.values()].map((v) => v.runId);
  const runToProject = new Map<number, number>();
  for (const [projectId, meta] of latestRuns) runToProject.set(meta.runId, projectId);
  const allTasks = await executionBoardRepository.getPlanTasksByRunIds(runIds);
  const tasksByProject = groupBy(allTasks, (t) => (t.importRunId != null ? runToProject.get(t.importRunId) : undefined));
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
  date: string | null;
  rag: ScheduleRag | null;
  source: "milestone" | "procurement";
  overdue: boolean;
}

export async function getDeliveriesProgram(now: Date = new Date()): Promise<DeliveryProgramRow[]> {
  const today = startOfDay(now);
  const active = await executionBoardRepository.getActiveProjects();
  const ids = active.map((p) => p.id);
  const nameById = new Map(active.map((p) => [p.id, p.projectName]));
  const [milestones, procurement] = await Promise.all([
    executionBoardRepository.getDeliveryMilestonesForProjects(ids),
    executionBoardRepository.getOpenProcurementForProjects(ids),
  ]);
  const out: DeliveryProgramRow[] = [];
  for (const m of milestones) {
    const done = m.status === "complete" || Boolean(m.actualDate);
    if (done) continue;
    const d = parsePlanDate(m.plannedDate);
    out.push({
      projectId: m.projectId,
      projectName: nameById.get(m.projectId) ?? "",
      label: m.milestoneName,
      date: m.plannedDate ?? null,
      rag: deliveryRag(d, today, false),
      source: "milestone",
      overdue: d != null && diffDays(d, today) < 0,
    });
  }
  for (const p of procurement) {
    const d = parsePlanDate(p.requiredDate);
    out.push({
      projectId: p.projectId,
      projectName: nameById.get(p.projectId) ?? "",
      label: p.title,
      date: p.requiredDate,
      rag: deliveryRag(d, today, false),
      source: "procurement",
      overdue: d != null && diffDays(d, today) < 0,
    });
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
