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

export type CalendarKind = "inflow" | "outflow" | "task";

export interface CalendarEvent {
  kind: CalendarKind;
  date: string; // yyyy-mm-dd anchor
  label: string;
  amount: number | null;
  state: FlowState | TaskState;
  projectId: number;
  projectName: string;
  rowHash?: string;
  taskId?: number;
}

export interface ProjectMilestoneDetail {
  project: { id: number; projectName: string };
  milestones: MilestoneView[];
  availableTasks: TaskPick[];
  availableCostLines: OutflowView[];
  calendar: CalendarEvent[];
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
  calendar: CalendarEvent[];
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

const PAID_REVENUE = new Set(["paid", "in_bank", "realised"]);
const FLAGGED_REVENUE = new Set(["disputed", "written_off"]);

// An inflow (revenue milestone) is "open" until it is settled — paid / in bank /
// realised — or written off. A "disputed" line is still open (money expected).
const SETTLED_REVENUE = new Set(["paid", "in_bank", "realised", "written_off"]);
// An outflow (cost line) is "open" until it is paid.
function hasOpenInflow(rows: RevenueMilestoneRow[]): boolean {
  return rows.some((r) => !SETTLED_REVENUE.has(r.status));
}
function hasOpenOutflow(rows: CostLineRow[]): boolean {
  return rows.some((r) => r.status !== "paid");
}

/** Inflow state from the revenue-line status + expected payment date. */
function inflowState(status: string, expectedDate: string | null, today: string): FlowState {
  if (FLAGGED_REVENUE.has(status)) return "flagged";
  if (PAID_REVENUE.has(status)) return "paid";
  const overdue = !!expectedDate && expectedDate < today;
  if (status === "invoiced") return overdue ? "overdue" : "invoiced";
  // planned
  return overdue ? "overdue" : "outstanding";
}

/** Outflow state from the cost-line status + forecast payment date. */
function outflowState(status: string, forecastDate: string | null, today: string): FlowState {
  if (status === "disputed") return "flagged";
  if (status === "paid") return "paid";
  const overdue = !!forecastDate && forecastDate < today;
  if (status === "invoiced" || status === "approved") return overdue ? "overdue" : "invoiced";
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
    state: outflowState(c.status, c.forecastPaymentDate, today),
  };
}

// ──────────────────────────── per-project detail ─────────────────────────────

interface ProjectBundle {
  milestones: RevenueMilestoneRow[];
  costs: CostLineRow[];
  tasks: MtPlanTaskRow[];
  rmLinks: Array<{ revenueRowHash: string; workItemId: number }>;
  tcLinks: Array<{ workItemId: number; costRowHash: string }>;
}

/** Build the milestone views for one project from its already-fetched bundle. */
function buildMilestones(projectId: number, projectName: string, b: ProjectBundle, today: string): MilestoneView[] {
  const taskById = new Map(b.tasks.map((t) => [t.id, t]));
  const costByHash = new Map(b.costs.map((c) => [c.rowHash, c]));

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
    const state = inflowState(m.status, m.expectedPaymentDate, today);
    const readyToInvoice = tasks.length > 0 && tasksComplete === tasks.length && m.status === "planned";
    const overdueGap =
      !PAID_REVENUE.has(m.status) && !FLAGGED_REVENUE.has(m.status) &&
      (!m.expectedPaymentDate || m.expectedPaymentDate < today);
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

function calendarFor(projectId: number, projectName: string, milestones: MilestoneView[], today: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const seenOutflow = new Set<string>();
  const seenTask = new Set<number>();
  for (const m of milestones) {
    const inDate = m.expectedPaymentDate ?? m.invoiceDate;
    if (inDate) {
      events.push({
        kind: "inflow", date: inDate, label: m.milestoneName || m.milestoneNo || "Milestone",
        amount: m.amount, state: m.state, projectId, projectName, rowHash: m.rowHash,
      });
    }
    for (const t of m.tasks) {
      if (!seenTask.has(t.id) && t.endDate) {
        seenTask.add(t.id);
        events.push({
          kind: "task", date: t.endDate, label: `${t.taskNo ? t.taskNo + " · " : ""}${t.title}`,
          amount: null, state: t.state, projectId, projectName, taskId: t.id,
        });
      }
      for (const o of t.outflows) {
        const d = o.forecastPaymentDate ?? o.invoiceDate ?? o.paidDate;
        if (d && !seenOutflow.has(o.rowHash)) {
          seenOutflow.add(o.rowHash);
          events.push({
            kind: "outflow", date: d, label: o.description || o.costCategory || "Cost",
            amount: o.amount, state: o.state, projectId, projectName, rowHash: o.rowHash,
          });
        }
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchBundle(projectId: number): Promise<ProjectBundle> {
  const [milestones, costs, tasks, rmLinks, tcLinks] = await Promise.all([
    milestoneTrackerRepository.getRevenueMilestonesForProjects([projectId]),
    milestoneTrackerRepository.getCostLinesForProjects([projectId]),
    milestoneTrackerRepository.getPlanTasksForProjects([projectId]),
    milestoneTrackerRepository.getMilestoneTaskLinksForProjects([projectId]),
    milestoneTrackerRepository.getTaskCostLinksForProjects([projectId]),
  ]);
  return { milestones, costs, tasks, rmLinks, tcLinks };
}

export async function getProjectMilestones(projectId: number, now: Date = new Date()): Promise<ProjectMilestoneDetail | null> {
  const header = await executionBoardRepository.getProjectHeader(projectId);
  if (!header) return null;
  const today = todayIso(now);
  const b = await fetchBundle(projectId);
  const milestones = buildMilestones(projectId, header.projectName, b, today);

  const inflowTotal = milestones.reduce((s, m) => s + (m.amount ?? 0), 0);
  const inflowOutstanding = milestones
    .filter((m) => !PAID_REVENUE.has(m.status) && !FLAGGED_REVENUE.has(m.status))
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

  return {
    project: { id: header.id, projectName: header.projectName },
    milestones,
    availableTasks: b.tasks.map((t) => ({
      id: t.id, taskNo: t.taskNo, title: t.title, workstream: t.workstream,
      endDate: t.endDate, percentComplete: pctTo100(t.percentComplete),
    })),
    availableCostLines: b.costs.map((c) => toOutflowView(c, today)),
    calendar: calendarFor(projectId, header.projectName, milestones, today),
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
  const nameById = new Map(active.map((p) => [p.id, p.projectName]));

  const [milestones, costs, tasks, rmLinks, tcLinks] = await Promise.all([
    milestoneTrackerRepository.getRevenueMilestonesForProjects(ids),
    milestoneTrackerRepository.getCostLinesForProjects(ids),
    milestoneTrackerRepository.getPlanTasksForProjects(ids),
    milestoneTrackerRepository.getMilestoneTaskLinksForProjects(ids),
    milestoneTrackerRepository.getTaskCostLinksForProjects(ids),
  ]);

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
  const calendar: CalendarEvent[] = [];
  let H_inflow = 0, H_outstanding = 0, H_outflow = 0, H_gaps = 0, H_ready = 0, H_ms = 0;

  for (const p of active) {
    const bundle: ProjectBundle = {
      milestones: mByP.get(p.id) ?? [],
      costs: cByP.get(p.id) ?? [],
      tasks: tByP.get(p.id) ?? [],
      rmLinks: rmByP.get(p.id) ?? [],
      tcLinks: tcByP.get(p.id) ?? [],
    };
    if (bundle.milestones.length === 0) continue; // no revenue milestones → not on the tracker
    // Only surface projects that still have open (unsettled / non-black) money —
    // an open inflow to collect or an open outflow to pay.
    if (!hasOpenInflow(bundle.milestones) && !hasOpenOutflow(bundle.costs)) continue;
    const views = buildMilestones(p.id, p.projectName, bundle, today);

    const inflowTotal = views.reduce((s, m) => s + (m.amount ?? 0), 0);
    const inflowOutstanding = views
      .filter((m) => !PAID_REVENUE.has(m.status) && !FLAGGED_REVENUE.has(m.status))
      .reduce((s, m) => s + (m.amount ?? 0), 0);
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
    // Open (unsettled / non-black) line items per project: inflows still to
    // collect, outflows still to pay.
    const openInflows = bundle.milestones.filter((m) => !SETTLED_REVENUE.has(m.status));
    const openInflowCount = openInflows.length;
    const openInflowAmount = openInflows.reduce((s, m) => s + (num(m.amountExVat) ?? 0), 0);
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
    calendar.push(...calendarFor(p.id, p.projectName, views, today));

    H_inflow += inflowTotal;
    H_outstanding += inflowOutstanding;
    H_outflow += outflowTotal;
    H_gaps += gapCount;
    H_ready += readyToInvoiceCount;
    H_ms += views.length;
  }

  // Worst-first: most gaps, then most outstanding inflow.
  rows.sort((a, b) => (b.gapCount - a.gapCount) || (b.inflowOutstanding - a.inflowOutstanding));
  calendar.sort((a, b) => a.date.localeCompare(b.date));

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
    calendar,
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
