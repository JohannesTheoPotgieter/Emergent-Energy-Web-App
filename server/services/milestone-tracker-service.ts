// ============================================================
// Milestone Tracker service
//
// Composes the payment-milestone tracker: payment milestones (inflows, from the
// revenue tracking sheet) linked to the plan tasks that make them invoiceable,
// and those tasks linked to the expenditure-breakdown cost lines (outflows).
// The task is the hub — a milestone's outflows roll up through its tasks.
//
// READ/COMPOSE only against finance; the only writes are the two link tables
// (handled by the repository). No finance number or formula is touched.
// ============================================================

import {
  milestoneTrackerRepository,
  type RevenueMilestoneRow,
  type CostLineRow,
  type MtPlanTaskRow,
} from "../repositories/milestone-tracker-repository";
import { executionBoardRepository } from "../repositories/execution-board-repository";
import {
  activityPlanTemplateRepository,
  type ActivityTemplateRule,
  type ActivityTemplateRow,
} from "../repositories/activity-plan-template-repository";
import { pctTo100 } from "../lib/kpi-formulas";

// ──────────────────────────────── shapes ─────────────────────────────────────

export type FlowState = "paid" | "invoiced" | "outstanding" | "overdue" | "flagged";
export type TaskState = "done" | "due" | "overdue";

export interface OutflowView {
  rowHash: string;
  description: string | null;
  costCategory: string | null;
  counterpartyName: string | null;
  amount: number | null;
  forecastPaymentDate: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  status: string;
  state: FlowState;
}

export interface LinkedTaskView {
  id: number;
  taskNo: string | null;
  title: string;
  workstream: string | null;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number | null;
  complete: boolean;
  state: TaskState;
  outflows: OutflowView[];
  /** Linked to a milestone but has no cost line attached. */
  noOutflow: boolean;
}

export interface MilestoneGaps {
  noTasks: boolean;
  noOutflow: boolean;
  overdue: boolean;
}

export interface MilestoneView {
  rowHash: string;
  milestoneNo: string | null;
  milestoneName: string | null;
  milestonePercent: number | null;
  amount: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  expectedPaymentDate: string | null;
  paidDate: string | null;
  status: string;
  state: FlowState;
  notes: string | null;
  tasks: LinkedTaskView[];
  outflows: OutflowView[];
  outflowTotal: number;
  tasksTotal: number;
  tasksComplete: number;
  readyToInvoice: boolean;
  gaps: MilestoneGaps;
}

export interface TaskPick {
  id: number;
  taskNo: string | null;
  title: string;
  workstream: string | null;
  endDate: string | null;
  percentComplete: number | null;
}

/** A predecessor of a plan task. `source` is "MANUAL" (Activity-Planning-owned,
 *  removable here) or "SMART_IMPORT" (from the workbook, read-only here). */
export interface TaskPredecessor {
  workItemId: number;
  source: string;
  complete: boolean;
}

/** A plan task in the Project Plan tab — the hub: the inflow milestones it
 *  unlocks, the outflow line items it incurs, and its dependency predecessors. */
export interface ActivityTaskNode {
  id: number;
  taskNo: string | null;
  title: string;
  workstream: string | null;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number | null; // 0..100
  complete: boolean;
  isMilestone: boolean;
  state: TaskState;
  predecessors: TaskPredecessor[];
  /** All predecessors (transitively) complete — the task is unblocked. */
  predecessorsComplete: boolean;
  linkedMilestoneHashes: string[];
  linkedCostHashes: string[];
}

/** A cost line in the Outflow line items tab, with the tasks that incur it. */
export interface OutflowItemView extends OutflowView {
  linkedTaskIds: number[];
}

/** A money-movement marker on a built activity's timeline. `realised` = actual
 *  (paid) movement; otherwise a forecast/expected date. */
export interface TimelineMarker {
  date: string; // yyyy-mm-dd
  amount: number | null;
  realised: boolean;
}

export type AxisState = "positive" | "negative" | "unknown";

/** One fully-built activity: an inflow milestone wired to plan task(s) and the
 *  outflows those tasks incur, with the work span + money dates and the two
 *  precomputed axes (schedule = work on time; cashflow = money-in before out). */
export interface TimelineActivity {
  projectId: number;
  projectName: string;
  milestoneRowHash: string;
  title: string;
  amount: number | null;
  state: FlowState;
  taskStart: string | null;
  taskEnd: string | null;
  tasksTotal: number;
  tasksComplete: number;
  overdueTaskCount: number;
  invoiceDate: string | null;
  inflow: TimelineMarker | null;
  outflows: TimelineMarker[];
  outflowTotal: number;
  scheduleState: AxisState;
  cashflowDays: number | null;
  cashflowState: AxisState;
}

export interface ProjectMilestoneDetail {
  project: { id: number; projectName: string };
  milestones: MilestoneView[];
  /** Project Plan tab — every plan task (the hub) with links + dependencies. */
  planTasks: ActivityTaskNode[];
  /** Outflow line items tab — every cost line with the tasks that incur it. */
  outflowItems: OutflowItemView[];
  availableTasks: TaskPick[];
  availableCostLines: OutflowView[];
  /** Fully-built activities (milestone → task[ → outflow]) for the Timeline tab. */
  activities: TimelineActivity[];
  summary: {
    milestoneCount: number;
    inflowTotal: number;
    inflowOutstanding: number;
    outflowTotal: number;
    gapCount: number;
    readyToInvoiceCount: number;
  };
}

export interface MilestoneProgramRow {
  projectId: number;
  projectName: string;
  phase: string | null;
  milestoneCount: number;
  linkedMilestoneCount: number;
  inflowTotal: number;
  inflowOutstanding: number;
  outflowTotal: number;
  openInflowCount: number;
  openInflowAmount: number;
  openOutflowCount: number;
  openOutflowAmount: number;
  gapCount: number;
  readyToInvoiceCount: number;
  nextInflowDate: string | null;
}

export interface MilestoneProgram {
  rows: MilestoneProgramRow[];
  header: {
    projectCount: number;
    milestoneCount: number;
    inflowTotal: number;
    inflowOutstanding: number;
    outflowTotal: number;
    gapCount: number;
    readyToInvoiceCount: number;
  };
  /** Every fully-built activity across projects, for the monthly overlay. */
  activities: TimelineActivity[];
}

// ──────────────────────────────── helpers ────────────────────────────────────

function num(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const FLAGGED_REVENUE = new Set(["disputed", "written_off"]);

// An outflow (cost line) is "open" until it is paid.
function hasOpenOutflow(rows: CostLineRow[]): boolean {
  return rows.some((r) => r.status !== "paid");
}

/**
 * Inflow state from the milestone's "Payment Received Date", read by the
 * tracker's FONT-COLOUR convention (black = confirmed actual receipt, red =
 * forecast — owner rule 2026-06):
 *   black + today/past → paid (realised)    black + future → flagged ("paid" in
 *                                                              the future can't be)
 *   red + future       → not yet paid        red + past     → overdue (forecast lapsed)
 * With no received date it falls back to the invoice (invoiced / outstanding,
 * overdue once the expected payment date passes). written_off / disputed → flagged.
 * NOTE: this is the Milestone-Tracker view only — the frozen finance/cash paths
 * are unchanged; they still use the imported date to forecast the inflow.
 */
export function inflowState(m: {
  status: string;
  paidDate: string | null;
  paidDateConfirmed: boolean | null;
  inBankDate: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  expectedPaymentDate: string | null;
}, today: string): FlowState {
  if (FLAGGED_REVENUE.has(m.status)) return "flagged";
  // Receipt signal: the colour-coded "Payment Received Date", or an in-bank date
  // (no colour captured → treated as confirmed/actual).
  const receipt = m.paidDate ?? m.inBankDate;
  if (receipt) {
    const confirmed = m.paidDate ? m.paidDateConfirmed === true : true; // black = actual
    const future = receipt > today;
    if (confirmed) return future ? "flagged" : "paid";
    if (future) return m.invoiceNumber || m.invoiceDate ? "invoiced" : "outstanding";
    return "overdue";
  }
  const overdue = !!m.expectedPaymentDate && m.expectedPaymentDate < today;
  if (m.status === "invoiced" || m.invoiceNumber || m.invoiceDate) return overdue ? "overdue" : "invoiced";
  return overdue ? "overdue" : "outstanding";
}

/** Still to collect: not actually collected (paid) and not written off / disputed. */
function inflowOpen(m: { state: FlowState; status: string }): boolean {
  return m.state !== "paid" && !FLAGGED_REVENUE.has(m.status);
}

/**
 * Outflow (money-out) state for the Activity-Planning view, read by the
 * tracker's FONT-COLOUR convention on the "Paid date" cell (black = actual
 * payment, red = forecast — same owner rule as the inflow side):
 *   black + today/past → paid       black + future → flagged ("paid" ahead of time can't be)
 *   red   + future     → outstanding red   + past   → overdue (forecast lapsed, unpaid)
 * With no paid date it falls back to the cost-line status / forecast timing.
 * NOTE: this is the Activity-Planning view ONLY. The imported cost-line status
 * and the frozen finance/cash paths are unchanged — they still treat the
 * imported paid date as the cash event. The importer marks a line PAID whenever
 * a paid date exists (even a red forecast), which is why this view must re-read
 * the colour to avoid showing forecast/future payments as "Paid".
 */
export function outflowState(c: {
  status: string;
  paidDate: string | null;
  paidDateConfirmed: boolean | null;
  forecastPaymentDate: string | null;
}, today: string): FlowState {
  if (c.status === "disputed") return "flagged";
  if (c.paidDate) {
    const confirmed = c.paidDateConfirmed === true; // black = actual payment
    const future = c.paidDate > today;
    if (confirmed) return future ? "flagged" : "paid";
    // red / forecast paid date — NOT actually paid
    return future ? "outstanding" : "overdue";
  }
  const overdue = !!c.forecastPaymentDate && c.forecastPaymentDate < today;
  if (c.status === "invoiced" || c.status === "approved") return overdue ? "overdue" : "invoiced";
  return overdue ? "overdue" : "outstanding";
}

function taskState(pct: number | null, endDate: string | null, today: string): TaskState {
  if ((pct ?? 0) >= 100) return "done";
  if (endDate && endDate < today) return "overdue";
  return "due";
}

function toOutflowView(c: CostLineRow, today: string): OutflowView {
  return {
    rowHash: c.rowHash,
    description: c.description,
    costCategory: c.costCategory,
    counterpartyName: c.counterpartyName,
    amount: num(c.amountExVat),
    forecastPaymentDate: c.forecastPaymentDate,
    invoiceDate: c.invoiceDate,
    paidDate: c.paidDate,
    status: c.status,
    state: outflowState(c, today),
  };
}

// ──────────────────────────── per-project detail ─────────────────────────────

interface ProjectBundle {
  milestones: RevenueMilestoneRow[];
  costs: CostLineRow[];
  tasks: MtPlanTaskRow[];
  rmLinks: Array<{ revenueRowHash: string; workItemId: number }>;
  tcLinks: Array<{ workItemId: number; costRowHash: string }>;
  deps: Array<{ predecessorId: number; successorId: number; source: string }>;
}

/** Map of task id → "chain complete": the task is 100% AND every predecessor
 *  (transitively) is chain-complete. Cycle-guarded. Drives the dependency-aware
 *  "ready to invoice" and the unblocked/blocked status in the Project Plan tab. */
export function buildChainComplete(tasks: MtPlanTaskRow[], deps: ProjectBundle["deps"]): Map<number, boolean> {
  const complete = new Map<number, boolean>();
  for (const t of tasks) complete.set(t.id, (pctTo100(t.percentComplete) ?? 0) >= 100);
  const predsBySucc = new Map<number, number[]>();
  for (const d of deps) {
    const arr = predsBySucc.get(d.successorId) ?? [];
    arr.push(d.predecessorId);
    predsBySucc.set(d.successorId, arr);
  }
  const memo = new Map<number, boolean>();
  const chain = (id: number, seen: Set<number>): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return complete.get(id) ?? false; // cycle guard
    seen.add(id);
    let ok = complete.get(id) ?? false;
    if (ok) {
      for (const p of predsBySucc.get(id) ?? []) {
        if (!chain(p, seen)) { ok = false; break; }
      }
    }
    seen.delete(id);
    memo.set(id, ok);
    return ok;
  };
  const out = new Map<number, boolean>();
  for (const t of tasks) out.set(t.id, chain(t.id, new Set()));
  return out;
}

/** Build the milestone views for one project from its already-fetched bundle. */
function buildMilestones(projectId: number, projectName: string, b: ProjectBundle, today: string): MilestoneView[] {
  const taskById = new Map(b.tasks.map((t) => [t.id, t]));
  const costByHash = new Map(b.costs.map((c) => [c.rowHash, c]));
  const chainComplete = buildChainComplete(b.tasks, b.deps);

  // task id -> linked cost rowHashes
  const costsByTask = new Map<number, string[]>();
  for (const l of b.tcLinks) {
    const arr = costsByTask.get(l.workItemId) ?? [];
    arr.push(l.costRowHash);
    costsByTask.set(l.workItemId, arr);
  }
  // milestone rowHash -> linked task ids
  const tasksByMilestone = new Map<string, number[]>();
  for (const l of b.rmLinks) {
    const arr = tasksByMilestone.get(l.revenueRowHash) ?? [];
    arr.push(l.workItemId);
    tasksByMilestone.set(l.revenueRowHash, arr);
  }

  return b.milestones.map((m) => {
    const taskIds = tasksByMilestone.get(m.rowHash) ?? [];
    const seenCost = new Set<string>();
    const tasks: LinkedTaskView[] = [];
    for (const tid of taskIds) {
      const t = taskById.get(tid);
      if (!t) continue;
      const costHashes = costsByTask.get(tid) ?? [];
      const outflows: OutflowView[] = [];
      for (const ch of costHashes) {
        const c = costByHash.get(ch);
        if (c) outflows.push(toOutflowView(c, today));
      }
      const pct = pctTo100(t.percentComplete);
      tasks.push({
        id: t.id,
        taskNo: t.taskNo,
        title: t.title,
        workstream: t.workstream,
        startDate: t.startDate,
        endDate: t.endDate,
        percentComplete: pct,
        complete: (pct ?? 0) >= 100,
        state: taskState(pct, t.endDate, today),
        outflows,
        noOutflow: outflows.length === 0,
      });
    }
    // milestone outflows = distinct cost lines across its tasks
    const outflows: OutflowView[] = [];
    for (const t of tasks) {
      for (const o of t.outflows) {
        if (seenCost.has(o.rowHash)) continue;
        seenCost.add(o.rowHash);
        outflows.push(o);
      }
    }
    const outflowTotal = outflows.reduce((s, o) => s + (o.amount ?? 0), 0);
    const tasksComplete = tasks.filter((t) => t.complete).length;
    const state = inflowState(m, today);
    // Chain-aware "ready to invoice": every linked task AND its whole predecessor
    // chain is complete, the milestone is still to collect, and no invoice has
    // been raised yet.
    const readyToInvoice =
      taskIds.length > 0 &&
      taskIds.every((id) => chainComplete.get(id) === true) &&
      !m.invoiceNumber && !m.invoiceDate &&
      inflowOpen({ state, status: m.status });
    const overdueGap = state === "overdue";
    return {
      rowHash: m.rowHash,
      milestoneNo: m.milestoneNo,
      milestoneName: m.milestoneName,
      milestonePercent: num(m.milestonePercent),
      amount: num(m.amountExVat),
      invoiceNumber: m.invoiceNumber,
      invoiceDate: m.invoiceDate,
      expectedPaymentDate: m.expectedPaymentDate,
      paidDate: m.paidDate,
      status: m.status,
      state,
      notes: m.milestoneNotes,
      tasks,
      outflows,
      outflowTotal,
      tasksTotal: tasks.length,
      tasksComplete,
      readyToInvoice,
      gaps: {
        noTasks: tasks.length === 0,
        noOutflow: outflows.length === 0,
        overdue: overdueGap,
      },
    };
  });
}

/** The money-out date of an outflow (payment, not invoice): forecast → paid →
 *  invoice, mirroring the per-milestone GP timing in the client. */
function outflowMoneyDate(o: OutflowView): string | null {
  return o.forecastPaymentDate ?? o.paidDate ?? o.invoiceDate;
}

/**
 * Build the fully-built activities for a project's already-computed milestone
 * views. A built activity is a milestone with at least one linked task; the
 * outflows its tasks incur are carried as money-out markers. Both axes reuse
 * the existing logic — SCHEDULE = no linked task overdue (the task done/due/
 * overdue state already on the view); CASHFLOW = amount-weighted money-out date
 * minus the money-in date (+ve ⇒ cash lands first), the same timing the
 * milestone GP card shows.
 */
function buildActivities(projectId: number, projectName: string, milestones: MilestoneView[]): TimelineActivity[] {
  const out: TimelineActivity[] = [];
  for (const m of milestones) {
    if (m.tasks.length === 0) continue; // not built yet — no work wired

    // work span across the linked tasks
    const starts = m.tasks.map((t) => t.startDate ?? t.endDate).filter((d): d is string => !!d);
    const ends = m.tasks.map((t) => t.endDate ?? t.startDate).filter((d): d is string => !!d);
    const taskStart = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null;
    const taskEnd = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null;
    const overdueTaskCount = m.tasks.filter((t) => t.state === "overdue").length;
    const tasksComplete = m.tasks.filter((t) => t.complete).length;
    const scheduleState: AxisState = overdueTaskCount > 0 ? "negative" : "positive";

    // money-in marker (expected/received)
    const inDate = m.expectedPaymentDate ?? m.paidDate ?? m.invoiceDate;
    const inflow: TimelineMarker | null = inDate
      ? { date: inDate, amount: m.amount, realised: m.state === "paid" }
      : null;

    // money-out markers (distinct outflows incurred by the activity's tasks)
    const outflows: TimelineMarker[] = [];
    let outflowTotal = 0;
    for (const o of m.outflows) {
      outflowTotal += o.amount ?? 0;
      const d = outflowMoneyDate(o);
      if (d) outflows.push({ date: d, amount: o.amount, realised: o.state === "paid" });
    }

    // cashflow timing: amount-weighted money-out date − money-in date, in days
    let cashflowDays: number | null = null;
    if (inDate) {
      const inMs = Date.parse(inDate);
      let wsum = 0, dsum = 0;
      for (const o of m.outflows) {
        const d = outflowMoneyDate(o);
        const amt = o.amount ?? 0;
        const ms = d ? Date.parse(d) : NaN;
        if (Number.isFinite(ms) && amt > 0) { wsum += amt; dsum += ms * amt; }
      }
      if (wsum > 0 && Number.isFinite(inMs)) cashflowDays = Math.round((dsum / wsum - inMs) / 86_400_000);
    }
    const cashflowState: AxisState = cashflowDays == null ? "unknown" : cashflowDays >= 0 ? "positive" : "negative";

    out.push({
      projectId,
      projectName,
      milestoneRowHash: m.rowHash,
      title: m.milestoneName || m.milestoneNo || "Milestone",
      amount: m.amount,
      state: m.state,
      taskStart,
      taskEnd,
      tasksTotal: m.tasks.length,
      tasksComplete,
      overdueTaskCount,
      invoiceDate: m.invoiceDate,
      inflow,
      outflows,
      outflowTotal,
      scheduleState,
      cashflowDays,
      cashflowState,
    });
  }
  // earliest money-in first; activities without a money-in date sort last
  return out.sort((a, b) => (a.inflow?.date ?? "9999").localeCompare(b.inflow?.date ?? "9999"));
}

async function fetchBundle(projectId: number): Promise<ProjectBundle> {
  const [milestones, costs, tasks, rmLinks, tcLinks] = await Promise.all([
    milestoneTrackerRepository.getRevenueMilestonesForProjects([projectId]),
    milestoneTrackerRepository.getCostLinesForProjects([projectId]),
    milestoneTrackerRepository.getPlanTasksForProjects([projectId]),
    milestoneTrackerRepository.getMilestoneTaskLinksForProjects([projectId]),
    milestoneTrackerRepository.getTaskCostLinksForProjects([projectId]),
  ]);
  const deps = await milestoneTrackerRepository.getDependenciesByWorkItemIds(tasks.map((t) => t.id));
  return { milestones, costs, tasks, rmLinks, tcLinks, deps };
}

/** Build the Project Plan tab (every task with its links + dependencies) and the
 *  Outflow line items tab (every cost line with the tasks that incur it). */
function buildPlanAndOutflows(b: ProjectBundle, today: string): { planTasks: ActivityTaskNode[]; outflowItems: OutflowItemView[] } {
  const completeById = new Map(b.tasks.map((t) => [t.id, (pctTo100(t.percentComplete) ?? 0) >= 100]));
  const chainComplete = buildChainComplete(b.tasks, b.deps);
  // task id -> predecessors
  const predsByTask = new Map<number, TaskPredecessor[]>();
  for (const d of b.deps) {
    const arr = predsByTask.get(d.successorId) ?? [];
    arr.push({ workItemId: d.predecessorId, source: d.source, complete: completeById.get(d.predecessorId) ?? false });
    predsByTask.set(d.successorId, arr);
  }
  // task id -> linked milestone hashes / cost hashes
  const msByTask = new Map<number, string[]>();
  for (const l of b.rmLinks) {
    const arr = msByTask.get(l.workItemId) ?? [];
    arr.push(l.revenueRowHash);
    msByTask.set(l.workItemId, arr);
  }
  const costByTask = new Map<number, string[]>();
  const tasksByCost = new Map<string, number[]>();
  for (const l of b.tcLinks) {
    (costByTask.get(l.workItemId) ?? costByTask.set(l.workItemId, []).get(l.workItemId)!).push(l.costRowHash);
    (tasksByCost.get(l.costRowHash) ?? tasksByCost.set(l.costRowHash, []).get(l.costRowHash)!).push(l.workItemId);
  }

  const planTasks: ActivityTaskNode[] = b.tasks
    .slice()
    .sort((a, z) => (a.taskNo ?? "").localeCompare(z.taskNo ?? "", undefined, { numeric: true }))
    .map((t) => {
      const preds = predsByTask.get(t.id) ?? [];
      return {
        id: t.id,
        taskNo: t.taskNo,
        title: t.title,
        workstream: t.workstream,
        startDate: t.startDate,
        endDate: t.endDate,
        percentComplete: pctTo100(t.percentComplete),
        complete: completeById.get(t.id) ?? false,
        isMilestone: t.isMilestone,
        state: taskState(pctTo100(t.percentComplete), t.endDate, today),
        predecessors: preds,
        predecessorsComplete: preds.every((p) => chainComplete.get(p.workItemId) === true),
        linkedMilestoneHashes: msByTask.get(t.id) ?? [],
        linkedCostHashes: costByTask.get(t.id) ?? [],
      };
    });

  const outflowItems: OutflowItemView[] = b.costs.map((c) => ({
    ...toOutflowView(c, today),
    linkedTaskIds: tasksByCost.get(c.rowHash) ?? [],
  }));

  return { planTasks, outflowItems };
}

export async function getProjectMilestones(projectId: number, now: Date = new Date()): Promise<ProjectMilestoneDetail | null> {
  const header = await executionBoardRepository.getProjectHeader(projectId);
  if (!header) return null;
  const today = todayIso(now);
  const b = await fetchBundle(projectId);
  const milestones = buildMilestones(projectId, header.projectName, b, today);

  const inflowTotal = milestones.reduce((s, m) => s + (m.amount ?? 0), 0);
  const inflowOutstanding = milestones
    .filter(inflowOpen)
    .reduce((s, m) => s + (m.amount ?? 0), 0);
  // distinct linked outflows across the whole project
  const linkedCostHashes = new Set<string>();
  for (const m of milestones) for (const o of m.outflows) linkedCostHashes.add(o.rowHash);
  const costByHash = new Map(b.costs.map((c) => [c.rowHash, c]));
  const outflowTotal = [...linkedCostHashes].reduce((s, h) => s + (num(costByHash.get(h)?.amountExVat ?? null) ?? 0), 0);
  const gapCount = milestones.reduce(
    (s, m) => s + (m.gaps.noTasks ? 1 : 0) + (m.gaps.noOutflow ? 1 : 0) + (m.gaps.overdue ? 1 : 0) + m.tasks.filter((t) => t.noOutflow).length,
    0,
  );
  const readyToInvoiceCount = milestones.filter((m) => m.readyToInvoice).length;
  const { planTasks, outflowItems } = buildPlanAndOutflows(b, today);

  return {
    project: { id: header.id, projectName: header.projectName },
    milestones,
    planTasks,
    outflowItems,
    availableTasks: b.tasks.map((t) => ({
      id: t.id, taskNo: t.taskNo, title: t.title, workstream: t.workstream,
      endDate: t.endDate, percentComplete: pctTo100(t.percentComplete),
    })),
    availableCostLines: b.costs.map((c) => toOutflowView(c, today)),
    activities: buildActivities(projectId, header.projectName, milestones),
    summary: { milestoneCount: milestones.length, inflowTotal, inflowOutstanding, outflowTotal, gapCount, readyToInvoiceCount },
  };
}

// ──────────────────────────── program overview ───────────────────────────────

export async function getMilestoneProgram(now: Date = new Date()): Promise<MilestoneProgram> {
  const today = todayIso(now);
  // includeArchived — same universe as the board, so the phase filter can reach
  // every project in a phase (incl. completed/archived ones with open money).
  const active = await executionBoardRepository.getActiveProjects(true);
  const ids = active.map((p) => p.id);

  const [milestones, costs, tasks, rmLinks, tcLinks] = await Promise.all([
    milestoneTrackerRepository.getRevenueMilestonesForProjects(ids),
    milestoneTrackerRepository.getCostLinesForProjects(ids),
    milestoneTrackerRepository.getPlanTasksForProjects(ids),
    milestoneTrackerRepository.getMilestoneTaskLinksForProjects(ids),
    milestoneTrackerRepository.getTaskCostLinksForProjects(ids),
  ]);
  // Dependencies across all projects' tasks (for chain-aware ready-to-invoice).
  const allDeps = await milestoneTrackerRepository.getDependenciesByWorkItemIds(tasks.map((t) => t.id));
  const taskProjectById = new Map(tasks.map((t) => [t.id, t.projectId]));
  const depsByProject = new Map<number, ProjectBundle["deps"]>();
  for (const d of allDeps) {
    const pid = taskProjectById.get(d.successorId);
    if (pid == null) continue;
    const arr = depsByProject.get(pid) ?? [];
    arr.push({ predecessorId: d.predecessorId, successorId: d.successorId, source: d.source });
    depsByProject.set(pid, arr);
  }

  const group = <T extends { projectId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const arr = m.get(r.projectId) ?? [];
      arr.push(r);
      m.set(r.projectId, arr);
    }
    return m;
  };
  const mByP = group(milestones);
  const cByP = group(costs);
  const tByP = group(tasks);
  const rmByP = group(rmLinks);
  const tcByP = group(tcLinks);

  const rows: MilestoneProgramRow[] = [];
  const activities: TimelineActivity[] = [];
  let H_inflow = 0, H_outstanding = 0, H_outflow = 0, H_gaps = 0, H_ready = 0, H_ms = 0;

  for (const p of active) {
    const bundle: ProjectBundle = {
      milestones: mByP.get(p.id) ?? [],
      costs: cByP.get(p.id) ?? [],
      tasks: tByP.get(p.id) ?? [],
      rmLinks: rmByP.get(p.id) ?? [],
      tcLinks: tcByP.get(p.id) ?? [],
      deps: depsByProject.get(p.id) ?? [],
    };
    if (bundle.milestones.length === 0) continue; // no revenue milestones → not on the tracker
    const views = buildMilestones(p.id, p.projectName, bundle, today);
    const openInflowViews = views.filter(inflowOpen);
    // Only surface projects that still have open money — an inflow still to
    // collect (colour-aware: a future/forecast receipt date is NOT collected) or
    // an outflow still to pay.
    if (openInflowViews.length === 0 && !hasOpenOutflow(bundle.costs)) continue;

    const inflowTotal = views.reduce((s, m) => s + (m.amount ?? 0), 0);
    const inflowOutstanding = openInflowViews.reduce((s, m) => s + (m.amount ?? 0), 0);
    const linkedCostHashes = new Set<string>();
    for (const m of views) for (const o of m.outflows) linkedCostHashes.add(o.rowHash);
    const costByHash = new Map(bundle.costs.map((c) => [c.rowHash, c]));
    const outflowTotal = [...linkedCostHashes].reduce((s, h) => s + (num(costByHash.get(h)?.amountExVat ?? null) ?? 0), 0);
    const gapCount = views.reduce(
      (s, m) => s + (m.gaps.noTasks ? 1 : 0) + (m.gaps.noOutflow ? 1 : 0) + (m.gaps.overdue ? 1 : 0) + m.tasks.filter((t) => t.noOutflow).length,
      0,
    );
    const readyToInvoiceCount = views.filter((m) => m.readyToInvoice).length;
    const linkedMilestoneCount = views.filter((m) => m.tasks.length > 0).length;
    // Open line items per project: inflows still to collect (colour-aware — a
    // future/forecast receipt date is NOT collected), outflows still to pay.
    const openInflowCount = openInflowViews.length;
    const openInflowAmount = openInflowViews.reduce((s, m) => s + (m.amount ?? 0), 0);
    const openOutflows = bundle.costs.filter((c) => c.status !== "paid");
    const openOutflowCount = openOutflows.length;
    const openOutflowAmount = openOutflows.reduce((s, c) => s + (num(c.amountExVat) ?? 0), 0);
    const upcoming = views
      .map((m) => m.expectedPaymentDate)
      .filter((d): d is string => !!d && d >= today)
      .sort();

    rows.push({
      projectId: p.id,
      projectName: p.projectName,
      phase: p.phase,
      milestoneCount: views.length,
      linkedMilestoneCount,
      inflowTotal,
      inflowOutstanding,
      outflowTotal,
      openInflowCount,
      openInflowAmount,
      openOutflowCount,
      openOutflowAmount,
      gapCount,
      readyToInvoiceCount,
      nextInflowDate: upcoming[0] ?? null,
    });
    activities.push(...buildActivities(p.id, p.projectName, views));

    H_inflow += inflowTotal;
    H_outstanding += inflowOutstanding;
    H_outflow += outflowTotal;
    H_gaps += gapCount;
    H_ready += readyToInvoiceCount;
    H_ms += views.length;
  }

  // Worst-first: most gaps, then most outstanding inflow.
  rows.sort((a, b) => (b.gapCount - a.gapCount) || (b.inflowOutstanding - a.inflowOutstanding));
  activities.sort((a, b) => (a.inflow?.date ?? "9999").localeCompare(b.inflow?.date ?? "9999"));

  return {
    rows,
    header: {
      projectCount: rows.length,
      milestoneCount: H_ms,
      inflowTotal: H_inflow,
      inflowOutstanding: H_outstanding,
      outflowTotal: H_outflow,
      gapCount: H_gaps,
      readyToInvoiceCount: H_ready,
    },
    activities,
  };
}

// ──────────────────────────────── link writes ────────────────────────────────

export class MilestoneLinkError extends Error {}

export async function linkMilestoneTask(projectId: number, revenueRowHash: string, workItemId: number, userId: number | null): Promise<void> {
  const [revOk, taskOk] = await Promise.all([
    milestoneTrackerRepository.revenueRowExists(projectId, revenueRowHash),
    milestoneTrackerRepository.taskBelongsToProject(projectId, workItemId),
  ]);
  if (!revOk) throw new MilestoneLinkError("Milestone not found for this project");
  if (!taskOk) throw new MilestoneLinkError("Task not found for this project");
  await milestoneTrackerRepository.addMilestoneTaskLink({ projectId, revenueRowHash, workItemId, createdBy: userId });
}

export async function unlinkMilestoneTask(projectId: number, revenueRowHash: string, workItemId: number): Promise<void> {
  await milestoneTrackerRepository.removeMilestoneTaskLink({ projectId, revenueRowHash, workItemId });
}

export async function linkTaskCost(projectId: number, workItemId: number, costRowHash: string, userId: number | null): Promise<void> {
  const [taskOk, costOk] = await Promise.all([
    milestoneTrackerRepository.taskBelongsToProject(projectId, workItemId),
    milestoneTrackerRepository.costRowExists(projectId, costRowHash),
  ]);
  if (!taskOk) throw new MilestoneLinkError("Task not found for this project");
  if (!costOk) throw new MilestoneLinkError("Cost line not found for this project");
  await milestoneTrackerRepository.addTaskCostLink({ projectId, workItemId, costRowHash, createdBy: userId });
}

export async function unlinkTaskCost(projectId: number, workItemId: number, costRowHash: string): Promise<void> {
  await milestoneTrackerRepository.removeTaskCostLink({ projectId, workItemId, costRowHash });
}

// ──────────────────────── task dependencies (MANUAL overlay) ──────────────────

export async function linkTaskDependency(projectId: number, predecessorId: number, successorId: number, userId: number | null): Promise<void> {
  if (predecessorId === successorId) throw new MilestoneLinkError("A task can't depend on itself");
  const [predOk, succOk] = await Promise.all([
    milestoneTrackerRepository.taskBelongsToProject(projectId, predecessorId),
    milestoneTrackerRepository.taskBelongsToProject(projectId, successorId),
  ]);
  if (!predOk || !succOk) throw new MilestoneLinkError("Task not found for this project");

  // Cycle guard: adding predecessor→successor must not close a loop, i.e. the
  // predecessor must not already (transitively) depend on the successor.
  const tasks = await milestoneTrackerRepository.getPlanTasksForProjects([projectId]);
  const deps = await milestoneTrackerRepository.getDependenciesByWorkItemIds(tasks.map((t) => t.id));
  const predsBySucc = new Map<number, number[]>();
  for (const d of deps) {
    const arr = predsBySucc.get(d.successorId) ?? [];
    arr.push(d.predecessorId);
    predsBySucc.set(d.successorId, arr);
  }
  const reaches = (from: number, target: number): boolean => {
    const seen = new Set<number>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of predsBySucc.get(cur) ?? []) stack.push(p);
    }
    return false;
  };
  if (reaches(predecessorId, successorId)) throw new MilestoneLinkError("That dependency would create a cycle");

  await milestoneTrackerRepository.addManualDependency({ predecessorId, successorId, createdBy: userId });
}

export async function unlinkTaskDependency(projectId: number, predecessorId: number, successorId: number): Promise<void> {
  // Only MANUAL edges are removable here — imported edges are owned by the workbook.
  const [predOk, succOk] = await Promise.all([
    milestoneTrackerRepository.taskBelongsToProject(projectId, predecessorId),
    milestoneTrackerRepository.taskBelongsToProject(projectId, successorId),
  ]);
  if (!predOk || !succOk) throw new MilestoneLinkError("Task not found for this project");
  await milestoneTrackerRepository.removeManualDependency({ predecessorId, successorId });
}

// ──────────────────────── activity-plan link templates ───────────────────────
//
// A template is a set of keyword rules captured from an already-linked project,
// re-applied to a new project by matching milestone / task / outflow text. Build
// once, apply per new project. Reuses the existing link writes (idempotent).

const TEMPLATE_STOPWORDS = new Set([
  "the", "and", "of", "for", "to", "a", "an", "on", "in", "at", "by", "with", "or",
  "payment", "milestone", "deposit", "stage", "phase", "amp", "inv", "no",
]);

/** Significant lowercase keywords from a row's text (drops stopwords, pure
 *  numbers and <3-char tokens). Falls back to the whole phrase if nothing keeps. */
function templateKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  const toks = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const kept = toks.filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TEMPLATE_STOPWORDS.has(t));
  const uniq = [...new Set(kept)];
  if (uniq.length > 0) return uniq;
  const phrase = text.toLowerCase().trim();
  return phrase ? [phrase] : [];
}

function matchesAnyKeyword(text: string | null | undefined, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false;
  const t = text.toLowerCase();
  return keywords.some((k) => k && t.includes(k));
}

/** Derive template rules from a project's existing links — one rule per milestone
 *  that has linked tasks, capturing keywords for the milestone, its tasks and
 *  their outflows. */
function buildTemplateRulesFromBundle(b: ProjectBundle): ActivityTemplateRule[] {
  const costByHash = new Map(b.costs.map((c) => [c.rowHash, c]));
  const costsByTask = new Map<number, string[]>();
  for (const l of b.tcLinks) {
    const c = costByHash.get(l.costRowHash);
    const arr = costsByTask.get(l.workItemId) ?? [];
    const text = c?.description ?? c?.costCategory;
    if (text) arr.push(text);
    costsByTask.set(l.workItemId, arr);
  }
  const taskById = new Map(b.tasks.map((t) => [t.id, t]));
  const tasksByMilestone = new Map<string, number[]>();
  for (const l of b.rmLinks) {
    const arr = tasksByMilestone.get(l.revenueRowHash) ?? [];
    arr.push(l.workItemId);
    tasksByMilestone.set(l.revenueRowHash, arr);
  }
  const milestoneByHash = new Map(b.milestones.map((m) => [m.rowHash, m]));
  const rules: ActivityTemplateRule[] = [];
  for (const [rowHash, taskIds] of tasksByMilestone) {
    const m = milestoneByHash.get(rowHash);
    if (!m) continue;
    const mKw = templateKeywords(m.milestoneName);
    const taskKw = new Set<string>();
    const outflowKw = new Set<string>();
    for (const tid of taskIds) {
      const t = taskById.get(tid);
      if (t) templateKeywords(t.title).forEach((k) => taskKw.add(k));
      for (const d of costsByTask.get(tid) ?? []) templateKeywords(d).forEach((k) => outflowKw.add(k));
    }
    if (mKw.length === 0 || taskKw.size === 0) continue;
    rules.push({
      label: m.milestoneName || m.milestoneNo || "Milestone",
      milestoneKeywords: mKw,
      taskKeywords: [...taskKw],
      outflowKeywords: [...outflowKw],
    });
  }
  return rules;
}

export async function listActivityTemplates(): Promise<ActivityTemplateRow[]> {
  return activityPlanTemplateRepository.list();
}

export async function deleteActivityTemplate(id: number): Promise<void> {
  return activityPlanTemplateRepository.softDelete(id);
}

/** Hand-edit a template's name and/or keyword rules. */
export async function updateActivityTemplate(
  id: number,
  patch: { name?: string; description?: string | null; rules?: ActivityTemplateRule[] },
): Promise<ActivityTemplateRow> {
  const updated = await activityPlanTemplateRepository.update(id, patch);
  if (!updated) throw new MilestoneLinkError("Template not found");
  return updated;
}

/** Capture an already-linked project's links as a reusable template. */
export async function createTemplateFromProject(projectId: number, name: string, description: string | null, userId: number | null): Promise<ActivityTemplateRow> {
  const b = await fetchBundle(projectId);
  const rules = buildTemplateRulesFromBundle(b);
  if (rules.length === 0) throw new MilestoneLinkError("This project has no milestone→task links to capture yet — link some first.");
  return activityPlanTemplateRepository.create({ name, description, rules, createdBy: userId });
}

export interface ApplyTemplateResult {
  milestoneTaskLinks: number;
  taskCostLinks: number;
  rulesMatched: number;
  rulesTotal: number;
}

/** Apply a template's keyword rules to a project, creating the matched links
 *  (skips links that already exist). */
export async function applyTemplateToProject(projectId: number, templateId: number, userId: number | null): Promise<ApplyTemplateResult> {
  const tpl = await activityPlanTemplateRepository.getById(templateId);
  if (!tpl) throw new MilestoneLinkError("Template not found");
  const b = await fetchBundle(projectId);
  const existingMt = new Set(b.rmLinks.map((l) => `${l.revenueRowHash}::${l.workItemId}`));
  const existingTc = new Set(b.tcLinks.map((l) => `${l.workItemId}::${l.costRowHash}`));
  const toMt: Array<{ revenueRowHash: string; workItemId: number }> = [];
  const toTc: Array<{ workItemId: number; costRowHash: string }> = [];
  let rulesMatched = 0;

  for (const rule of tpl.rules) {
    const ms = b.milestones.filter((m) => matchesAnyKeyword(m.milestoneName, rule.milestoneKeywords));
    const ts = b.tasks.filter((t) => matchesAnyKeyword(t.title, rule.taskKeywords));
    const os = b.costs.filter((c) => matchesAnyKeyword(c.description ?? c.costCategory, rule.outflowKeywords));
    if (ms.length > 0 && ts.length > 0) rulesMatched++;
    for (const m of ms) for (const t of ts) {
      const key = `${m.rowHash}::${t.id}`;
      if (!existingMt.has(key)) { existingMt.add(key); toMt.push({ revenueRowHash: m.rowHash, workItemId: t.id }); }
    }
    for (const t of ts) for (const c of os) {
      const key = `${t.id}::${c.rowHash}`;
      if (!existingTc.has(key)) { existingTc.add(key); toTc.push({ workItemId: t.id, costRowHash: c.rowHash }); }
    }
  }

  for (const l of toMt) await milestoneTrackerRepository.addMilestoneTaskLink({ projectId, ...l, createdBy: userId });
  for (const l of toTc) await milestoneTrackerRepository.addTaskCostLink({ projectId, ...l, createdBy: userId });
  return { milestoneTaskLinks: toMt.length, taskCostLinks: toTc.length, rulesMatched, rulesTotal: tpl.rules.length };
}
