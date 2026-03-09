import { TASK_STATUSES as SCHEMA_TASK_STATUSES, type TaskStatus } from "./schema";

export const TASK_STATUSES = [...SCHEMA_TASK_STATUSES] as readonly TaskStatus[];

export type TaskStatusViewType = "board" | "list" | "mytasks" | "approval" | "execution" | "all";

interface TaskStatusMeta {
  label: string;
  badgeClass: string;
  columnClass: string;
  barClass: string;
  stateType: "execution" | "approval";
  completeForExecution: boolean;
  completeForReporting: boolean;
}

export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  "TO DO": {
    label: "TO DO",
    badgeClass: "bg-muted text-foreground",
    columnClass: "border-t-gray-400",
    barClass: "bg-gray-400",
    stateType: "execution",
    completeForExecution: false,
    completeForReporting: false,
  },
  "IN PROGRESS": {
    label: "IN PROGRESS",
    badgeClass: "bg-blue-100 text-blue-700",
    columnClass: "border-t-blue-500",
    barClass: "bg-blue-500",
    stateType: "execution",
    completeForExecution: false,
    completeForReporting: false,
  },
  "HOLD": {
    label: "HOLD",
    badgeClass: "bg-red-100 text-red-700",
    columnClass: "border-t-red-500",
    barClass: "bg-red-500",
    stateType: "execution",
    completeForExecution: false,
    completeForReporting: false,
  },
  "PROJECTS ASSISTANCE": {
    label: "PROJECTS ASSISTANCE",
    badgeClass: "bg-cyan-100 text-cyan-700",
    columnClass: "border-t-cyan-500",
    barClass: "bg-cyan-500",
    stateType: "execution",
    completeForExecution: false,
    completeForReporting: false,
  },
  "NEEDS APPROVAL": {
    label: "NEEDS APPROVAL",
    badgeClass: "bg-amber-100 text-amber-700",
    columnClass: "border-t-amber-500",
    barClass: "bg-amber-500",
    stateType: "approval",
    completeForExecution: false,
    completeForReporting: false,
  },
  "QC APPROVED": {
    label: "QC APPROVED",
    badgeClass: "bg-emerald-100 text-emerald-700",
    columnClass: "border-t-emerald-500",
    barClass: "bg-emerald-500",
    stateType: "approval",
    completeForExecution: false,
    completeForReporting: true,
  },
  "PROVIDE FEEDBACK": {
    label: "PROVIDE FEEDBACK",
    badgeClass: "bg-purple-100 text-purple-700",
    columnClass: "border-t-purple-500",
    barClass: "bg-purple-500",
    stateType: "approval",
    completeForExecution: false,
    completeForReporting: false,
  },
  "OPERATIONAL APPROVAL": {
    label: "OPERATIONAL APPROVAL",
    badgeClass: "bg-indigo-100 text-indigo-700",
    columnClass: "border-t-indigo-500",
    barClass: "bg-indigo-500",
    stateType: "approval",
    completeForExecution: false,
    completeForReporting: false,
  },
  "COMPLETE": {
    label: "COMPLETE",
    badgeClass: "bg-green-100 text-green-700",
    columnClass: "border-t-green-500",
    barClass: "bg-green-500",
    stateType: "execution",
    completeForExecution: true,
    completeForReporting: true,
  },
};

export const TASK_STATUS_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  "TO DO": ["IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL", "COMPLETE"],
  "IN PROGRESS": ["TO DO", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL", "COMPLETE"],
  "HOLD": ["TO DO", "IN PROGRESS", "PROJECTS ASSISTANCE", "NEEDS APPROVAL"],
  "PROJECTS ASSISTANCE": ["TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL"],
  "NEEDS APPROVAL": ["PROVIDE FEEDBACK", "QC APPROVED", "OPERATIONAL APPROVAL", "IN PROGRESS"],
  "PROVIDE FEEDBACK": ["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "HOLD"],
  "QC APPROVED": ["COMPLETE", "IN PROGRESS", "OPERATIONAL APPROVAL"],
  "OPERATIONAL APPROVAL": ["QC APPROVED", "PROVIDE FEEDBACK", "IN PROGRESS", "COMPLETE"],
  "COMPLETE": ["TO DO", "IN PROGRESS", "HOLD"],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (SCHEMA_TASK_STATUSES as readonly string[]).includes(value);
}

export function getTaskStatusLabel(status: string): string {
  return isTaskStatus(status) ? TASK_STATUS_META[status].label : status;
}

export function getTaskStatusBadgeClass(status: string): string {
  return isTaskStatus(status) ? TASK_STATUS_META[status].badgeClass : "bg-muted text-foreground";
}

export function getTaskStatusColumnClass(status: string): string {
  return isTaskStatus(status) ? TASK_STATUS_META[status].columnClass : "border-t-gray-300";
}

export function getTaskStatusBarClass(status: string): string {
  return isTaskStatus(status) ? TASK_STATUS_META[status].barClass : "bg-gray-300";
}

export function isTaskComplete(status: string): boolean {
  return isTaskStatus(status) ? TASK_STATUS_META[status].completeForExecution : false;
}

export function isTaskCompleteForReporting(status: string): boolean {
  return isTaskStatus(status) ? TASK_STATUS_META[status].completeForReporting : false;
}

export function isApprovalState(status: string): boolean {
  return isTaskStatus(status) ? TASK_STATUS_META[status].stateType === "approval" : false;
}

export function isExecutionState(status: string): boolean {
  return isTaskStatus(status) ? TASK_STATUS_META[status].stateType === "execution" : false;
}

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isTaskStatus(from) || !isTaskStatus(to)) return true;
  return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? true;
}

export function getVisibleStatusesForView(viewType: TaskStatusViewType): TaskStatus[] {
  if (viewType === "approval") return SCHEMA_TASK_STATUSES.filter((s) => isApprovalState(s));
  if (viewType === "execution") return SCHEMA_TASK_STATUSES.filter((s) => isExecutionState(s));
  return [...SCHEMA_TASK_STATUSES];
}
