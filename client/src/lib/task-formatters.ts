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

export function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || isTaskComplete(status)) return false;
  return new Date(dueDate) < new Date();
}

export function isDueThisWeek(dueDate: string | null, status: string) {
  if (!dueDate || isTaskComplete(status)) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return due >= now && due <= weekFromNow;
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
