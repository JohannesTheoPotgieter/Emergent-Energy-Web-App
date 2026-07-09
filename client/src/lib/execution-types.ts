// Client-side surface for the Execution control tower. The payload SHAPES are
// the canonical wire types in @shared/execution-board-types — imported by BOTH
// the server and this file, so the client cannot drift from the server. This
// module re-exports them and adds the client-only types + display helpers.

export type {
  Rag,
  ScheduleSnapshot,
  NextTask,
  NextDelivery,
  WorkstreamSummary,
  ItemCounts,
  InstallerSummary,
  InstallerRow,
  BoardRow,
  BoardHeader,
  BoardResult,
  PlanTaskView,
  CriticalPathTask,
  CriticalPathResult,
  DeliveryMilestone,
  ProcurementDelivery,
  ProjectDetail,
  UpcomingProgramRow,
  DeliveryProgramRow,
  AllocationProgramRow,
  WorkItemPick,
} from "@shared/execution-board-types";

/** Allocation role a subcontractor plays on a project — mirrors
 *  SUBCONTRACTOR_ROLES in shared/schema/projects.ts. */
export const SUBCONTRACTOR_ROLES = ["Installer", "Supplier", "EPC", "Electrical", "Civil", "Logistics", "O&M", "Other"] as const;

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
