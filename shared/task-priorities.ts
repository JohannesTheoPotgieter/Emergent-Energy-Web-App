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
