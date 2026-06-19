// Client-side shapes for the Execution control tower. Mirror the payloads
// returned by server/services/execution-board-service.ts (kept in sync by the
// API tests). Client never imports server code directly.

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
  source: "milestone" | "procurement";
  blocker?: string | null;
}

export interface EngineeringSummary {
  total: number;
  blocked: number;
  inProgress: number;
  complete: number;
  openTasks: number;
  rag: Rag;
}

export interface QualitySummary {
  openTotal: number;
  critical: number;
  major: number;
  minor: number;
  observation: number;
  overdue: number;
  hasQcp: boolean;
  rag: Rag;
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
  flags: ItemCounts;
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

export interface InstallerRow {
  id: number;
  projectId: number;
  counterpartyId: number;
  counterpartyName: string | null;
  counterpartyType: string | null;
  workPackage: string | null;
  scopeDescription: string | null;
  status: string;
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
    next: NextDelivery | null;
    overdueCount: number;
  };
  engineering: EngineeringSummary;
  quality: QualitySummary;
}

export type ExecItemStatus = "open" | "flagged" | "actioned" | "closed";
export type ExecItemSeverity = "low" | "medium" | "high" | "critical";

export interface ExecutionReviewItem {
  id: number;
  projectId: number;
  category: string;
  title: string;
  detail: string | null;
  status: ExecItemStatus;
  severity: ExecItemSeverity;
  tags: string[];
  ownerUserId: number | null;
  dueDate: string | null;
  meetingDate: string | null;
  planTaskNo: string | null;
  planWorkItemId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpcomingProgramRow {
  projectId: number;
  projectName: string;
  taskNo: string | null;
  taskName: string;
  date: string | null;
  isMilestone: boolean;
}

export interface DeliveryProgramRow {
  projectId: number;
  projectName: string;
  label: string;
  date: string | null;
  rag: Rag;
  source: "milestone" | "procurement";
  overdue: boolean;
}

export interface AllocationProgramRow {
  projectId: number;
  projectName: string;
  phase: string | null;
  installers: InstallerSummary;
  pmName: string | null;
  pmUserId: number | null;
}

export interface AssignableUser {
  id: number;
  name: string;
  email?: string | null;
}

export interface SupplierListRow {
  id: number;
  name_canonical: string;
  type_default: string | null;
  role_tags?: string[];
}

// Small shared display helpers.
export function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

/** Tolerant parser for the text dates from the import (ISO or dd/mm/yyyy). */
export function parseExecDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseExecDate(s);
  if (!d) return String(s);
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

export function fmtMoney(v: string | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}
