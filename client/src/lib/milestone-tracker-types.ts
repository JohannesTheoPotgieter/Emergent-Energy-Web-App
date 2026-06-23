// Client-side shapes for the Milestone Tracker. Mirror the payloads returned by
// server/services/milestone-tracker-service.ts (kept in sync by the API tests).

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

export interface TaskPredecessor {
  workItemId: number;
  source: string; // "MANUAL" (removable) | "SMART_IMPORT" (from the workbook)
  complete: boolean;
}

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
  predecessorsComplete: boolean;
  linkedMilestoneHashes: string[];
  linkedCostHashes: string[];
}

export interface OutflowItemView extends OutflowView {
  linkedTaskIds: number[];
}

/** A money-movement marker on a built activity's timeline row. `realised` = it
 *  is an ACTUAL movement (paid), otherwise a forecast/expected date. */
export interface TimelineMarker {
  date: string; // yyyy-mm-dd
  amount: number | null;
  realised: boolean;
}

export type AxisState = "positive" | "negative" | "unknown";

/**
 * One fully-built activity = an inflow milestone wired to plan task(s) (and the
 * outflows those tasks incur). It carries the work span + the money dates so a
 * timeline / monthly overlay can show, at a glance, whether it is SCHEDULE
 * positive (work on time) and CASHFLOW positive (money-in lands before money-out).
 */
export interface TimelineActivity {
  projectId: number;
  projectName: string;
  milestoneRowHash: string;
  title: string;
  amount: number | null; // inflow (money-in) amount
  state: FlowState; // inflow state
  // the work span (plan tasks)
  taskStart: string | null;
  taskEnd: string | null;
  tasksTotal: number;
  tasksComplete: number;
  overdueTaskCount: number;
  // money-in
  invoiceDate: string | null;
  inflow: TimelineMarker | null; // expected/received money-in
  // money-out (the outflows incurred by the activity's tasks)
  outflows: TimelineMarker[];
  outflowTotal: number;
  // axes (precomputed server-side from the existing task + timing logic)
  scheduleState: AxisState; // work on time?
  cashflowDays: number | null; // +ve = money-in before money-out
  cashflowState: AxisState;
}

export interface ProjectMilestoneDetail {
  project: { id: number; projectName: string };
  milestones: MilestoneView[];
  planTasks: ActivityTaskNode[];
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

// ── shared display helpers ──
export const money = (n: number | null | undefined): string =>
  n == null ? "—" : `R${Math.round(n).toLocaleString("en-ZA")}`;

export const FLOW_STATE_STYLE: Record<FlowState, { label: string; cls: string; dot: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  invoiced: { label: "Invoiced", cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  outstanding: { label: "Outstanding", cls: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  flagged: { label: "Flagged", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
};

export const TASK_STATE_STYLE: Record<TaskState, { label: string; cls: string; dot: string }> = {
  done: { label: "Done", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  due: { label: "Due", cls: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
};
