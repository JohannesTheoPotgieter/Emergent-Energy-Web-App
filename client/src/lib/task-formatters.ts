import { isTaskComplete } from "@shared/task-status";
import { taskPrioritySortOrder } from "@shared/task-priorities";
import {
  deriveDueLabel,
  getOwnerInitials,
  toIsoDate,
  type DueLabelUrgency,
} from "@shared/lib/engineering-ticket-view";
import type { Task } from "@/components/tasks/types";

const avatarColors = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

export function getInitials(name: string) {
  return getOwnerInitials(name) ?? "";
}

export function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

export function formatDateShort(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  } catch {
    return d;
  }
}

const SAST_TZ = "Africa/Johannesburg";

/** Today's calendar date in SAST as an ISO "YYYY-MM-DD" string (en-CA => ISO order). */
function todayIsoSAST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SAST_TZ });
}

/** The calendar date ("YYYY-MM-DD") of a due value, in SAST. A bare date string
 *  is already timezone-agnostic; a full timestamp is projected into SAST. */
function dueIsoSAST(dueDate: string): string {
  return dueDate.length <= 10 ? dueDate.slice(0, 10) : new Date(dueDate).toLocaleDateString("en-CA", { timeZone: SAST_TZ });
}

/** ISO date `days` after the given ISO date, using UTC arithmetic on the parts
 *  (timezone-safe — never touches local/UTC midnight of the input). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || isTaskComplete(status)) return false;
  // Date-only comparison in SAST: overdue only once the due DATE is strictly in
  // the past. A task due TODAY is not overdue — fixes the UTC-midnight
  // (new Date("YYYY-MM-DD")) vs local-now off-by-one.
  return dueIsoSAST(dueDate) < todayIsoSAST();
}

export function isDueThisWeek(dueDate: string | null, status: string) {
  if (!dueDate || isTaskComplete(status)) return false;
  const due = dueIsoSAST(dueDate);
  const today = todayIsoSAST();
  // Due within the next 7 calendar days, inclusive of today (date-only, SAST).
  return due >= today && due <= addDaysIso(today, 7);
}

export function daysLabel(d: string | null) {
  if (!d) return null;
  return deriveDueLabel(toIsoDate(d), false).label || null;
}

export const daysFromNow = daysLabel;

export type { DueLabelUrgency };

export function smartDueLabel(
  due: string | null | undefined,
  status?: string | null,
): { label: string; urgency: DueLabelUrgency } {
  return deriveDueLabel(toIsoDate(due ?? null), status ? isTaskComplete(status) : false);
}

/**
 * @deprecated Divergent taxonomy. Use `taskPrioritySortOrder` from
 * `@shared/task-priorities` (canonical Urgent/High/Med/Low). Retained as a
 * canonical-backed alias so any external importer keeps working.
 */
export const priorityOrder: Record<string, number> = {
  Urgent: taskPrioritySortOrder("Urgent"),
  High: taskPrioritySortOrder("High"),
  Med: taskPrioritySortOrder("Med"),
  Low: taskPrioritySortOrder("Low"),
};

export function sortTasksForColumn(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    // Plan-linked tasks whose derived deadline is near/overdue rank first.
    const aPlan = a.planLinkUrgent ? 0 : 1;
    const bPlan = b.planLinkUrgent ? 0 : 1;
    if (aPlan !== bPlan) return aPlan - bPlan;
    const aOverdue = isOverdue(a.dueDate, a.status) ? 0 : 1;
    const bOverdue = isOverdue(b.dueDate, b.status) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aPri = taskPrioritySortOrder(a.priority);
    const bPri = taskPrioritySortOrder(b.priority);
    if (aPri !== bPri) return aPri - bPri;
    const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return aDate - bDate;
  });
}
