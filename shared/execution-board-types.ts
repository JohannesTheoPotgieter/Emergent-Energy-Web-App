// ============================================================
// Execution control-tower — canonical wire payload types.
//
// SINGLE source of truth for the JSON shapes the Execution board / detail /
// program endpoints return. The server (server/services/execution-board-*.ts,
// server/repositories/execution-board-repository.ts) and the client
// (client/src/lib/execution-types.ts) both import these — neither redefines
// them, so the two sides cannot drift.
//
// Pure types only (no runtime, no drizzle/server imports) so the client can
// import them freely.
// ============================================================

/** Red / amber / green schedule signal (null = not assessable). Matches the
 *  server's `ScheduleRag | null`. */
export type Rag = "green" | "amber" | "red" | null;

export interface ScheduleSnapshot {
  actualPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  rag: Rag;
  leafCount: number;
  hasPlan: boolean;
}

export interface NextTask {
  taskNo: string | null;
  taskName: string;
  date: string | null;
  isMilestone: boolean;
}

export interface NextDelivery {
  label: string;
  date: string | null;
  rag: Rag;
  source: "milestone" | "procurement" | "task";
  blocker?: string | null;
}

/**
 * Eng/QA roll-up shown in the board's Eng and QA columns. Sourced from the real
 * Engineering / Quality module when the project has data there, otherwise from
 * the program plan's ENG / QUALITY workstreams (work_items).
 */
export interface WorkstreamSummary {
  total: number;
  complete: number;
  inProgress: number;
  notStarted: number;
  actualPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  rag: Rag;
  hasPlan: boolean;
}

export interface ItemCounts {
  open: number;
  flagged: number;
  actioned: number;
  closed: number;
  total: number;
}

export interface InstallerSummary {
  count: number;
  primary: string | null;
  list: Array<{ id: number; counterpartyId: number; name: string | null; type: string | null; role: string | null; workPackage: string | null; scopeDescription: string | null }>;
}

export interface InstallerRow {
  id: number;
  projectId: number;
  counterpartyId: number;
  counterpartyName: string | null;
  counterpartyType: string | null;
  role: string | null;
  workPackage: string | null;
  scopeDescription: string | null;
  status: string;
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
  /** Per-project overdue-delivery count — lets the client recompute the
   *  Overdue-deliveries KPI for the currently filtered (e.g. by-phase) subset. */
  overdueDeliveryCount: number;
  installers: InstallerSummary;
  pmUserId: number | null;
  pmName: string | null;
  pdUserId: number | null;
  pdName: string | null;
  engineering: WorkstreamSummary;
  quality: WorkstreamSummary;
  flags: ItemCounts;
  // Editable fields for the board's inline editors. ragStatus is the canonical
  // lifecycle RAG.
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

export interface CriticalPathTask {
  taskNo: string;
  taskName: string;
  start: string | null;
  end: string | null;
  durationDays: number;
}

export interface CriticalPathResult {
  criticalTaskNos: string[];
  chain: CriticalPathTask[];
  projectStart: string | null;
  projectFinish: string | null;
  spanDays: number | null;
  datedTaskCount: number;
}

export interface DeliveryMilestone {
  id: number;
  projectId: number;
  milestoneName: string;
  plannedDate: string | null;
  actualDate: string | null;
  status: string;
  blocker: string | null;
}

export interface ProcurementDelivery {
  id: number;
  projectId: number;
  title: string;
  status: string;
  requiredDate: string | null;
  supplierId: number | null;
  progressPercent: number | null;
}

export interface DeliveryProgramRow {
  projectId: number;
  projectName: string;
  label: string;
  date: string | null; // sort/anchor date — the needed-on-site date
  rag: Rag;
  source: "milestone" | "procurement" | "task";
  overdue: boolean;
  complete: boolean;
  // ── delivery planning (procurement orders only) ──
  id?: number;
  editable?: boolean;
  linkedWorkItemId?: number | null;
  neededBy?: string | null;
  leadTimeDays?: number | null;
  orderDate?: string | null;
  orderBy?: string | null;
  eta?: string | null;
  willMakeIt?: Rag;
  taskNo?: string | null;
  taskTitle?: string | null;
  isLongLead?: boolean;
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
    milestones: DeliveryMilestone[];
    procurement: ProcurementDelivery[];
    tasks: DeliveryProgramRow[];
    next: NextDelivery | null;
    overdueCount: number;
  };
  engineering: WorkstreamSummary;
  quality: WorkstreamSummary;
}

export interface UpcomingProgramRow {
  projectId: number;
  projectName: string;
  taskNo: string | null;
  taskName: string;
  date: string | null;
  isMilestone: boolean;
}

export interface AllocationProgramRow {
  projectId: number;
  projectName: string;
  phase: string | null;
  installers: InstallerSummary;
  pmName: string | null;
  pmUserId: number | null;
}

export interface WorkItemPick {
  id: number;
  taskNo: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
}
