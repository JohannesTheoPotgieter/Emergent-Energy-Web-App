// ============================================================
// Execution Board — pure computation helpers (NO db imports).
//
// Split out from execution-board-service.ts so the thresholds + selection
// logic are unit-testable without a database. Only `import type` is used for
// the row shapes (erased at runtime), so importing this module never pulls in
// the repository / db layer.
// ============================================================

import { pctTo100, scheduleRagFromVariance, type ScheduleRag } from "../lib/kpi-formulas";
import type { ProjectDeliveryMilestone } from "@shared/schema";
import type {
  EngStageRow,
  SnagRow,
  ProcurementDeliveryRow,
} from "../repositories/execution-board-repository";

/**
 * Normalized plan-task shape the schedule/critical-path math operates on.
 * Sourced from `work_items` (the canonical Plan-tab table) — the imported
 * program plan lives there, not in the dead `normalized_plan_tasks` table.
 */
export interface PlanTask {
  /** work_items.id — present for delivery promotion (link an order to the task). */
  id?: number;
  taskNo: string | null;
  taskName: string;
  phase: string | null;
  workstream: string | null;
  startDate: string | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  durationDays: number | null;
  pctComplete: number | null;
  expectedPctComplete: number | null;
  isMilestone: boolean;
  parentTaskNo: string | null;
  comment: string | null;
}


export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Tolerant parser for the text dates stored in normalized_plan_tasks. */
export function parsePlanDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return startOfDay(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return startOfDay(new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Expected progress as of `today`, derived from a task's ACTUAL start→end
 * dates — the live, deterministic replacement for the Excel "Expected Status"
 * column.
 *
 * Owner decision 2026-06-23: expected progress is measured against the ACTUAL
 * timeline (when the task really started / is due to finish), not the original
 * plan. The tracker's Expected Status is a volatile (TODAY-based) formula whose
 * Excel cache goes stale on save; we compute it ourselves instead — the linear
 * fraction of the actual start→end span elapsed, clamped to [0,1]. Returns null
 * when the actual dates are missing so the caller can fall back.
 *
 *   today >= end                     → 1   (completion checked first so a
 *                                            same-day milestone reads 100%)
 *   today <= start                   → 0
 *   otherwise (today - start)/(end - start)
 */
export function expectedProgressFromDates(
  start: string | null,
  end: string | null,
  today: Date,
): number | null {
  const s = parsePlanDate(start);
  const e = parsePlanDate(end);
  if (!s || !e) return null;
  const t = today.getTime();
  // Completion check first so a same-day milestone (start == end == today)
  // reads as 100% expected rather than 0%.
  if (t >= e.getTime()) return 1;
  if (t <= s.getTime()) return 0;
  const span = e.getTime() - s.getTime();
  if (span <= 0) return 1;
  return (t - s.getTime()) / span;
}

/**
 * Return the tasks with `expectedPctComplete` replaced by the date-derived
 * expected progress (0–1), computed from each task's ACTUAL start→end dates, so
 * every downstream read — schedule snapshot, RAG, workstream summaries and the
 * detail EXP% column — is live and never depends on the Excel formula cache.
 * When a task has no actual dates we keep the imported value so nothing is lost.
 * ACT% (pct_complete) is never touched — it stays verbatim from the tracker.
 */
export function withComputedExpected(tasks: PlanTask[], today: Date): PlanTask[] {
  return tasks.map((t) => {
    const computed = expectedProgressFromDates(t.actualStartDate, t.actualEndDate, today);
    return computed == null ? t : { ...t, expectedPctComplete: computed };
  });
}


export interface ScheduleSnapshot {
  actualPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  rag: ScheduleRag | null;
  leafCount: number;
  hasPlan: boolean;
}

function leafTasks(tasks: PlanTask[]): PlanTask[] {
  const parentSet = new Set(
    tasks.map((t) => t.parentTaskNo).filter((p): p is string => Boolean(p)),
  );
  const leaves = tasks.filter((t) => t.taskNo != null && !parentSet.has(t.taskNo));
  return leaves.length > 0 ? leaves : tasks;
}

/**
 * Duration-weighted average of leaf pct_complete / expected_pct_complete —
 * mirrors the Excel top-row rollup. A "leaf" is a task whose task_no is not
 * the parent of any other task in the same run.
 */
export function computeScheduleSnapshot(tasks: PlanTask[]): ScheduleSnapshot {
  if (!tasks.length) {
    return { actualPct: null, expectedPct: null, variance: null, rag: null, leafCount: 0, hasPlan: false };
  }
  const leaves = leafTasks(tasks);
  let actualWeighted = 0;
  let expectedWeighted = 0;
  let sumDur = 0;
  for (const t of leaves) {
    const durRaw = t.durationDays == null ? 1 : Number(t.durationDays);
    const dur = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : 1;
    actualWeighted += (pctTo100(t.pctComplete) ?? 0) * dur;
    expectedWeighted += (pctTo100(t.expectedPctComplete) ?? 0) * dur;
    sumDur += dur;
  }
  const actualPct = sumDur > 0 ? Math.round((actualWeighted / sumDur) * 10) / 10 : null;
  const expectedPct = sumDur > 0 ? Math.round((expectedWeighted / sumDur) * 10) / 10 : null;
  const variance =
    actualPct != null && expectedPct != null ? Math.round((actualPct - expectedPct) * 10) / 10 : null;
  return {
    actualPct,
    expectedPct,
    variance,
    rag: scheduleRagFromVariance(actualPct, expectedPct),
    leafCount: leaves.length,
    hasPlan: true,
  };
}

export interface NextTask {
  taskNo: string | null;
  taskName: string;
  date: string | null;
  isMilestone: boolean;
}

/** Earliest incomplete leaf task starting within [today, today+daysOut]. */
export function selectNextTask(
  tasks: PlanTask[],
  today: Date,
  daysOut = 14,
): NextTask | null {
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysOut);
  const parentSet = new Set(
    tasks.map((t) => t.parentTaskNo).filter((p): p is string => Boolean(p)),
  );
  let best: { task: PlanTask; date: Date } | null = null;
  for (const t of tasks) {
    if (t.taskNo != null && parentSet.has(t.taskNo)) continue; // parents excluded
    if ((pctTo100(t.pctComplete) ?? 0) >= 100) continue; // complete
    const start = parsePlanDate(t.startDate) ?? parsePlanDate(t.actualStartDate);
    if (!start) continue;
    if (start < today || start > horizon) continue;
    if (!best || start < best.date) best = { task: t, date: start };
  }
  if (!best) return null;
  return {
    taskNo: best.task.taskNo ?? null,
    taskName: best.task.taskName,
    date: best.task.startDate ?? best.task.actualStartDate ?? null,
    isMilestone: Boolean(best.task.isMilestone),
  };
}

export function deliveryRag(date: Date | null, today: Date, done: boolean): ScheduleRag | null {
  if (done) return "green";
  if (!date) return null;
  const d = diffDays(date, today);
  if (d < 0) return "red";
  if (d <= 7) return "amber";
  return "green";
}

export interface NextDelivery {
  label: string;
  date: string | null;
  rag: ScheduleRag | null;
  source: "milestone" | "procurement" | "task";
  blocker?: string | null;
}

export interface DeliveriesResult {
  next: NextDelivery | null;
  overdueCount: number;
}

/** Earliest open delivery (milestone or procurement) + count of overdue ones. */
export function selectNextDelivery(
  milestones: ProjectDeliveryMilestone[],
  procurement: ProcurementDeliveryRow[],
  today: Date,
): DeliveriesResult {
  type Cand = {
    label: string;
    date: Date | null;
    raw: string | null;
    done: boolean;
    source: "milestone" | "procurement";
    blocker?: string | null;
  };
  const cands: Cand[] = [];
  for (const m of milestones) {
    const done = m.status === "complete" || Boolean(m.actualDate);
    cands.push({
      label: m.milestoneName,
      date: parsePlanDate(m.plannedDate),
      raw: m.plannedDate ?? null,
      done,
      source: "milestone",
      blocker: m.blocker,
    });
  }
  for (const p of procurement) {
    cands.push({
      label: p.title,
      date: parsePlanDate(p.requiredDate),
      raw: p.requiredDate,
      done: false,
      source: "procurement",
    });
  }
  let overdueCount = 0;
  let best: Cand | null = null;
  for (const c of cands) {
    if (c.done || !c.date) continue;
    if (diffDays(c.date, today) < 0) overdueCount += 1;
    if (!best || (best.date && c.date < best.date)) best = c;
  }
  const next: NextDelivery | null = best
    ? {
        label: best.label,
        date: best.raw,
        rag: deliveryRag(best.date, today, best.done),
        source: best.source,
        blocker: best.blocker ?? null,
      }
    : null;
  return { next, overdueCount };
}

/**
 * Roll-up of a single plan workstream (ENG or QUALITY) read straight from the
 * imported program plan (work_items). Used by the board's Eng/QA columns until
 * the dedicated Engineering / Quality modules come online — so the columns
 * reflect the plan rather than empty module tables. Counts are over leaf tasks;
 * actual/expected are the same duration-weighted % as the schedule column,
 * scoped to the workstream, and the RAG is schedule-variance based.
 */
export interface WorkstreamSummary {
  total: number;
  complete: number;
  inProgress: number;
  notStarted: number;
  actualPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  rag: ScheduleRag | null;
  hasPlan: boolean;
}

export function summarizeWorkstream(tasks: PlanTask[]): WorkstreamSummary {
  const snap = computeScheduleSnapshot(tasks);
  const leaves = leafTasks(tasks);
  let complete = 0, inProgress = 0, notStarted = 0;
  for (const t of leaves) {
    const pct = pctTo100(t.pctComplete) ?? 0;
    if (pct >= 100) complete += 1;
    else if (pct > 0) inProgress += 1;
    else notStarted += 1;
  }
  return {
    total: snap.hasPlan ? leaves.length : 0,
    complete,
    inProgress,
    notStarted,
    actualPct: snap.actualPct,
    expectedPct: snap.expectedPct,
    variance: snap.variance,
    rag: snap.rag,
    hasPlan: snap.hasPlan,
  };
}

export interface EngineeringSummary {
  total: number;
  blocked: number;
  inProgress: number;
  complete: number;
  openTasks: number;
  rag: ScheduleRag | null;
}

export function summarizeEngineering(stages: EngStageRow[], openTasks: number): EngineeringSummary {
  const total = stages.length;
  const blocked = stages.filter((s) => s.status === "blocked").length;
  const inProgress = stages.filter((s) => s.status === "in_progress" || s.status === "ready_for_review").length;
  const complete = stages.filter((s) => s.status === "complete").length;
  let rag: ScheduleRag | null = null;
  if (total > 0) {
    if (blocked > 0) rag = "red";
    else if (complete === total) rag = "green";
    else rag = "amber";
  }
  return { total, blocked, inProgress, complete, openTasks, rag };
}

export interface QualitySummary {
  openTotal: number;
  critical: number;
  major: number;
  minor: number;
  observation: number;
  overdue: number;
  hasQcp: boolean;
  rag: ScheduleRag | null;
}

const CLOSED_SNAG_STATUSES = new Set(["resolved", "verified", "closed"]);

export function summarizeQuality(rows: SnagRow[], hasQcp: boolean, today: Date): QualitySummary {
  const open = rows.filter((s) => !CLOSED_SNAG_STATUSES.has(s.status ?? "open"));
  const bySev = (sev: string) => open.filter((s) => (s.severity ?? "minor") === sev).length;
  const critical = bySev("critical");
  const major = bySev("major");
  const minor = bySev("minor");
  const observation = bySev("observation");
  const overdue = open.filter((s) => {
    const d = parsePlanDate(s.dueDate);
    return d != null && diffDays(d, today) < 0;
  }).length;
  let rag: ScheduleRag | null = null;
  if (rows.length > 0 || hasQcp) {
    if (critical > 0) rag = "red";
    else if (major > 0 || overdue > 0) rag = "amber";
    else rag = "green";
  }
  return { openTotal: open.length, critical, major, minor, observation, overdue, hasQcp, rag };
}

// ──────────────────────────── critical path (date-driven) ────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inclusive whole-day span between two midnight-aligned dates (min 1). */
function spanDaysInclusive(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

export interface CriticalPathTask {
  taskNo: string;
  taskName: string;
  start: string | null;
  end: string | null;
  durationDays: number;
}

export interface CriticalPathResult {
  /** task_no of every task on the critical path. */
  criticalTaskNos: string[];
  /** Ordered start→finish chain. */
  chain: CriticalPathTask[];
  projectStart: string | null;
  projectFinish: string | null;
  spanDays: number | null;
  /** Number of dated leaf tasks considered. */
  datedTaskCount: number;
}

/**
 * Critical path derived purely from dates (the import has no explicit
 * predecessor links). A task may precede another when it finishes at/before
 * the other starts; the critical path is the maximum total-duration chain of
 * such non-overlapping leaf tasks that ends at the project's finish date.
 *
 * Uses PLANNED dates (start_date/end_date), falling back to actual dates when
 * a planned date is missing. Parents/summary rows are excluded (leaves only).
 */
export function computeCriticalPath(tasks: PlanTask[]): CriticalPathResult {
  const parentSet = new Set(
    tasks.map((t) => t.parentTaskNo).filter((p): p is string => Boolean(p)),
  );

  interface Node {
    taskNo: string;
    taskName: string;
    startRaw: string | null;
    endRaw: string | null;
    start: Date;
    end: Date;
    dur: number;
  }
  const nodes: Node[] = [];
  for (const t of tasks) {
    if (t.taskNo == null || parentSet.has(t.taskNo)) continue; // leaves only
    const startRaw = t.startDate ?? t.actualStartDate ?? null;
    const endRaw = t.endDate ?? t.actualEndDate ?? null;
    const start = parsePlanDate(startRaw);
    const end = parsePlanDate(endRaw);
    if (!start || !end || end < start) continue;
    nodes.push({ taskNo: t.taskNo, taskName: t.taskName, startRaw, endRaw, start, end, dur: spanDaysInclusive(start, end) });
  }

  if (nodes.length === 0) {
    return { criticalTaskNos: [], chain: [], projectStart: null, projectFinish: null, spanDays: null, datedTaskCount: 0 };
  }

  // Sort by end asc (then start asc) so every predecessor is processed first.
  nodes.sort((a, b) => a.end.getTime() - b.end.getTime() || a.start.getTime() - b.start.getTime());
  const n = nodes.length;
  const longest = new Array<number>(n).fill(0);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestPrev = -1;
    for (let j = 0; j < i; j++) {
      if (nodes[j].end.getTime() <= nodes[i].start.getTime() && longest[j] > best) {
        best = longest[j];
        bestPrev = j;
      }
    }
    longest[i] = best + nodes[i].dur;
    prev[i] = bestPrev;
  }

  // The critical path ends at the project finish (latest end date); break ties
  // toward the longer accumulated chain.
  let finishIdx = 0;
  for (let i = 1; i < n; i++) {
    const better =
      nodes[i].end.getTime() > nodes[finishIdx].end.getTime() ||
      (nodes[i].end.getTime() === nodes[finishIdx].end.getTime() && longest[i] > longest[finishIdx]);
    if (better) finishIdx = i;
  }

  const chainIdx: number[] = [];
  for (let k = finishIdx; k !== -1; k = prev[k]) chainIdx.push(k);
  chainIdx.reverse();

  const chain: CriticalPathTask[] = chainIdx.map((idx) => ({
    taskNo: nodes[idx].taskNo,
    taskName: nodes[idx].taskName,
    start: nodes[idx].startRaw,
    end: nodes[idx].endRaw,
    durationDays: nodes[idx].dur,
  }));

  const projectStart = nodes.reduce((min, x) => (x.start < min ? x.start : min), nodes[0].start);
  const projectFinish = nodes[finishIdx].end;

  return {
    criticalTaskNos: chain.map((c) => c.taskNo),
    chain,
    projectStart: isoDate(projectStart),
    projectFinish: isoDate(projectFinish),
    spanDays: spanDaysInclusive(projectStart, projectFinish),
    datedTaskCount: n,
  };
}
