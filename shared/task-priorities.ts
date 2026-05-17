// Canonical priority vocabulary shared by the task board, dashboard, and any
// other surface that sorts or filters tasks.
//
// The DB-level schema (shared/schema/tasks.ts) stores one of four values:
// "Low" | "Med" | "High" | "Urgent". The UI renders "Med" as "Medium" for
// end users.
//
// Historical data sometimes contains "Critical" or "Medium" strings. Surfaces
// that render those values should normalise first via normalizeTaskPriority()
// so the row still gets a sensible border / badge instead of falling through
// to the default grey.

import { TASK_PRIORITIES } from "@shared/schema";

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_VALUES: readonly TaskPriority[] = TASK_PRIORITIES;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  Urgent: "Urgent",
  High: "High",
  Med: "Medium",
  Low: "Low",
};

export const DEFAULT_TASK_PRIORITY: TaskPriority = "Med";

/**
 * Map any priority string to a canonical TaskPriority. Unknown values
 * (legacy "Critical" / "Medium" rows, empty strings, null) collapse to
 * DEFAULT_TASK_PRIORITY so the UI never renders an unthemed row.
 */
export function normalizeTaskPriority(value: string | null | undefined): TaskPriority {
  if (!value) return DEFAULT_TASK_PRIORITY;
  const trimmed = value.trim();
  if ((TASK_PRIORITY_VALUES as readonly string[]).includes(trimmed)) {
    return trimmed as TaskPriority;
  }
  // Legacy aliases.
  if (trimmed === "Medium") return "Med";
  if (trimmed === "Critical") return "Urgent";
  return DEFAULT_TASK_PRIORITY;
}

export function taskPriorityLabel(value: string | null | undefined): string {
  return TASK_PRIORITY_LABELS[normalizeTaskPriority(value)];
}

// Canonical badge / border / sort treatments keyed by the four real
// priority values. Any divergent local map (Critical/Urgent/High/Medium/Low,
// Med vs Medium, etc.) must normalise through normalizeTaskPriority() first
// and read from these so a row never silently falls through to bg-muted.
export const TASK_PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  Urgent: "bg-red-600 text-white",
  High: "bg-amber-100 text-amber-700",
  Med: "bg-blue-100 text-blue-700",
  Low: "bg-muted text-muted-foreground",
};

export const TASK_PRIORITY_BORDER_CLASS: Record<TaskPriority, string> = {
  Urgent: "border-l-red-600",
  High: "border-l-amber-500",
  Med: "border-l-blue-400",
  Low: "border-l-gray-300",
};

// Lower number = higher urgency. Stable sort weight for board/list ordering.
export const TASK_PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  Urgent: 0,
  High: 1,
  Med: 2,
  Low: 3,
};

export function taskPriorityBadgeClass(value: string | null | undefined): string {
  return TASK_PRIORITY_BADGE_CLASS[normalizeTaskPriority(value)];
}

export function taskPriorityBorderClass(value: string | null | undefined): string {
  return TASK_PRIORITY_BORDER_CLASS[normalizeTaskPriority(value)];
}

export function taskPrioritySortOrder(value: string | null | undefined): number {
  return TASK_PRIORITY_SORT_ORDER[normalizeTaskPriority(value)];
}
