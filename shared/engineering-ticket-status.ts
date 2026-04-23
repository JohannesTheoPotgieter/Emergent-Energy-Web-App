import { TASK_STATUSES, type TaskStatus } from "./schema/tasks";
import { TASK_STATUS_META } from "./task-status";

export const ENGINEERING_TICKET_STATUSES = TASK_STATUSES;
export type EngineeringTicketStatus = TaskStatus;

export const TICKET_BLOCKED_STATUSES: readonly EngineeringTicketStatus[] = ["hold"] as const;
// At the ticket level, only `complete` is terminal. `qc_approved` is the
// engineering-board's "QC pass" sub-state but a ticket isn't truly closed
// until it reaches `complete`. Keep this list aligned with the SQL terminal
// synonyms below.
export const TICKET_DONE_FOR_REPORTING: readonly EngineeringTicketStatus[] = ["complete"] as const;
export const TICKET_APPROVAL_STATUSES: readonly EngineeringTicketStatus[] = [
  "needs_approval", "qc_approved", "provide_feedback", "operational_approval",
] as const;

const LEGACY_TO_CANONICAL: Record<string, EngineeringTicketStatus> = {
  "draft": "to_do",
  "to do": "to_do",
  "to_do": "to_do",
  "todo": "to_do",
  "not started": "not_started",
  "not_started": "not_started",
  "in progress": "in_progress",
  "in_progress": "in_progress",
  "on hold": "hold",
  "on_hold": "hold",
  "hold": "hold",
  "blocked": "hold",
  "completed": "complete",
  "complete": "complete",
  "done": "complete",
  "closed": "complete",
  "resolved": "complete",
  "cancelled": "complete",
  "canceled": "complete",
  "qc approved": "qc_approved",
  "qc_approved": "qc_approved",
  "needs approval": "needs_approval",
  "needs_approval": "needs_approval",
  "provide feedback": "provide_feedback",
  "provide_feedback": "provide_feedback",
  "operational approval": "operational_approval",
  "operational_approval": "operational_approval",
  "projects assistance": "projects_assistance",
  "projects_assistance": "projects_assistance",
};

export function normalizeEngineeringTicketStatus(raw: string | null | undefined): EngineeringTicketStatus {
  if (!raw) return "to_do";
  const key = raw.trim().toLowerCase();
  if (LEGACY_TO_CANONICAL[key]) return LEGACY_TO_CANONICAL[key];
  if ((TASK_STATUSES as readonly string[]).includes(key)) return key as EngineeringTicketStatus;
  return "to_do";
}

export function isEngineeringTicketStatus(value: string): value is EngineeringTicketStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function getEngineeringTicketStatusLabel(value: string | null | undefined): string {
  const canonical = normalizeEngineeringTicketStatus(value);
  return TASK_STATUS_META[canonical]?.label ?? canonical;
}

export function getEngineeringTicketStatusBadgeClass(value: string | null | undefined): string {
  const canonical = normalizeEngineeringTicketStatus(value);
  return TASK_STATUS_META[canonical]?.badgeClass ?? "bg-muted text-foreground";
}

export function isTicketDoneForReporting(value: string | null | undefined): boolean {
  return (TICKET_DONE_FOR_REPORTING as readonly string[]).includes(normalizeEngineeringTicketStatus(value));
}

export function isTicketBlocked(value: string | null | undefined): boolean {
  return (TICKET_BLOCKED_STATUSES as readonly string[]).includes(normalizeEngineeringTicketStatus(value));
}

export function isTicketInApproval(value: string | null | undefined): boolean {
  return (TICKET_APPROVAL_STATUSES as readonly string[]).includes(normalizeEngineeringTicketStatus(value));
}

export function isTicketActive(value: string | null | undefined): boolean {
  return !isTicketDoneForReporting(value);
}

/**
 * Synonym list used in raw SQL `LOWER(...) IN (...)` filters to keep the
 * dashboard queries resilient during the legacy → canonical transition.
 * Both old free-form values (Draft / In Progress / Completed / On Hold /
 * Cancelled) and new canonical values are recognised. Once production data
 * is fully migrated and tests confirm zero legacy values, the legacy
 * synonyms can be dropped here without touching call sites.
 */
export const SQL_DONE_FOR_REPORTING_SYNONYMS = [
  "complete", "completed", "closed", "resolved", "done",
] as const;

export const SQL_TERMINAL_SYNONYMS = [
  ...SQL_DONE_FOR_REPORTING_SYNONYMS,
  "cancelled", "canceled",
] as const;

export const SQL_BLOCKED_SYNONYMS = ["hold", "blocked", "on_hold", "on hold"] as const;

export const SQL_APPROVAL_SYNONYMS = [
  "needs_approval", "needs approval",
  "qc_approved", "qc approved",
  "provide_feedback", "provide feedback",
  "operational_approval", "operational approval",
] as const;

export const ENGINEERING_TICKET_DEFAULT_STATUS: EngineeringTicketStatus = "to_do";
