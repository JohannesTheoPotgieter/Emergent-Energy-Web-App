/**
 * Engineering task filter constants + per-user view localStorage helpers.
 *
 * Extracted from the monolithic EngineeringTasksPage.tsx (UI/UX audit X5
 * module split). This is the real implementation; the orchestrator and the
 * legacy `EngineeringTaskFilters.tsx` barrel both re-export from here.
 *
 * Pure data + localStorage only — no React, no behaviour change.
 */

import type {
  EngineeringDueDateFilter,
  EngineeringLinkedSourceFilter,
  EngineeringWorkloadStateFilter,
} from "@/hooks/useEngineeringTaskFilters";
import type { EngDefaultView } from "@/components/tasks/types";
import {
  TASK_PRIORITY_VALUES,
  TASK_PRIORITY_BADGE_CLASS,
  TASK_PRIORITY_BORDER_CLASS,
  type TaskPriority,
} from "@shared/task-priorities";

export const PRIORITIES: readonly TaskPriority[] = TASK_PRIORITY_VALUES;

export const DUE_DATE_FILTER_OPTIONS: { value: EngineeringDueDateFilter; label: string }[] = [
  { value: "all", label: "All Due Dates" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "this_week", label: "Due In 7 Days" },
  { value: "no_due_date", label: "No Due Date" },
];

export const WORKLOAD_STATE_OPTIONS: { value: EngineeringWorkloadStateFilter; label: string }[] = [
  { value: "all", label: "All Work States" },
  { value: "unassigned", label: "Unassigned" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review Needed" },
  { value: "approval", label: "QC Review Pending" },
  { value: "deliverable", label: "Project Deliverables" },
  { value: "microsoft_action", label: "Microsoft Actions" },
];

export const LINKED_SOURCE_OPTIONS: { value: EngineeringLinkedSourceFilter; label: string }[] = [
  { value: "all", label: "All Linked Sources" },
  { value: "project_linked", label: "Project Linked" },
  { value: "project_unlinked", label: "No Project Link" },
  { value: "microsoft_linked", label: "Microsoft Linked" },
  { value: "microsoft_action_required", label: "Microsoft Action Required" },
];

// Canonical priority treatments — re-exported from @shared/task-priorities
// so divergent local taxonomies can't silently fall through to bg-muted.
// Look these up via normalizeTaskPriority(task.priority) or the
// taskPriorityBadgeClass()/taskPriorityBorderClass() helper functions.
export const priorityColors: Record<TaskPriority, string> = TASK_PRIORITY_BADGE_CLASS;
export const priorityBorderColors: Record<TaskPriority, string> = TASK_PRIORITY_BORDER_CLASS;

export const SAVED_FILTERS: {
  label: string;
  filter: {
    status?: string;
    dueDateFilter?: EngineeringDueDateFilter;
    workloadStateFilter?: EngineeringWorkloadStateFilter;
    linkedSourceFilter?: EngineeringLinkedSourceFilter;
  };
}[] = [
  { label: "Overdue", filter: { dueDateFilter: "overdue" } },
  { label: "Unassigned", filter: { workloadStateFilter: "unassigned" } },
  { label: "Blocked", filter: { workloadStateFilter: "blocked" } },
  { label: "Review Needed", filter: { workloadStateFilter: "review" } },
  { label: "QC Review Pending", filter: { workloadStateFilter: "approval" } },
  { label: "Deliverables", filter: { workloadStateFilter: "deliverable" } },
  { label: "Microsoft Linked", filter: { linkedSourceFilter: "microsoft_linked" } },
];

export function getSavedMyName(): string {
  return localStorage.getItem("eng_my_name") || "";
}

export function setSavedMyName(name: string) {
  localStorage.setItem("eng_my_name", name);
}

export function getEngViewKey(userId?: number): string {
  return `eng_default_view_${userId || "default"}`;
}

export function getSavedEngDefaultView(userId?: number): EngDefaultView | null {
  try {
    const raw = localStorage.getItem(getEngViewKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const validViews = ["board", "list", "projects", "mytasks"];
    if (!validViews.includes(parsed.viewMode)) parsed.viewMode = "board";
    return parsed;
  } catch {
    return null;
  }
}

export function saveEngDefaultView(view: EngDefaultView, userId?: number) {
  localStorage.setItem(getEngViewKey(userId), JSON.stringify(view));
}

export function clearEngDefaultView(userId?: number) {
  localStorage.removeItem(getEngViewKey(userId));
}
