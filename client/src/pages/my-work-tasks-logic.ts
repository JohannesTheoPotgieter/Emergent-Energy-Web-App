import { differenceInCalendarDays, isPast, parseISO, startOfDay } from "date-fns";

export type TaskLike = {
  dueAt?: string | null;
  status: string;
  _source: string;
  _trackingRole?: string | null;
  assignees?: string[] | null;
  owners?: string[] | null;
  resolvedAssignees?: Array<{ name?: string | null }> | null;
  resolvedOwners?: Array<{ name?: string | null }> | null;
};

export function getTaskAssigneeNames(task: TaskLike): string[] {
  const names = [
    ...(task.resolvedAssignees || []).map((u) => u?.name || "").filter(Boolean),
    ...(task.resolvedOwners || []).map((u) => u?.name || "").filter(Boolean),
    ...(task.assignees || []).filter(Boolean),
    ...(task.owners || []).filter(Boolean),
  ] as string[];
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
}

export function isTaskOverdue(task: TaskLike): boolean {
  if (!task.dueAt || ["complete", "done", "cancelled"].includes(task.status)) return false;
  try {
    return isPast(parseISO(task.dueAt));
  } catch {
    return false;
  }
}

export function isTaskDueSoon(task: TaskLike): boolean {
  if (!task.dueAt || ["complete", "done", "cancelled"].includes(task.status)) return false;
  try {
    const diff = differenceInCalendarDays(parseISO(task.dueAt), startOfDay(new Date()));
    return diff >= 0 && diff <= 3;
  } catch {
    return false;
  }
}

export function canReassignTask(task: TaskLike, role = ""): boolean {
  const isPrivileged = ["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "ENGINEERING_MANAGER"].includes(role);
  const isAssigneeContext = task._trackingRole === "assignee" || task._trackingRole === "both";
  switch (task._source) {
    case "personal":
      return true;
    case "operational":
      return isPrivileged || isAssigneeContext;
    case "plan":
    case "engineering_task":
    case "tr_register":
      return isPrivileged;
    case "quality_task":
      return isPrivileged || isAssigneeContext || ["QUALITY_MANAGER", "quality_manager"].includes(role);
    default:
      return false;
  }
}


export function compareTasksSmart(a: TaskLike & { priority?: string | null }, b: TaskLike & { priority?: string | null }): number {
  const priorityOrder: Record<string, number> = { critical: 0, urgent: 0, high: 1, normal: 2, med: 2, low: 3 };
  const aOverdue = isTaskOverdue(a) ? 1 : 0;
  const bOverdue = isTaskOverdue(b) ? 1 : 0;
  if (aOverdue !== bOverdue) return bOverdue - aOverdue;
  const aSoon = isTaskDueSoon(a) ? 1 : 0;
  const bSoon = isTaskDueSoon(b) ? 1 : 0;
  if (aSoon !== bSoon) return bSoon - aSoon;
  return (priorityOrder[(a.priority || "normal").toLowerCase()] ?? 2) - (priorityOrder[(b.priority || "normal").toLowerCase()] ?? 2);
}
