import { useMemo } from "react";
import type { Task } from "@/components/tasks/types";

export type EngineeringDueDateFilter =
  | "all"
  | "overdue"
  | "today"
  | "this_week"
  | "no_due_date";

export type EngineeringWorkloadStateFilter =
  | "all"
  | "unassigned"
  | "blocked"
  | "review"
  | "approval"
  | "deliverable"
  | "microsoft_action";

export type EngineeringLinkedSourceFilter =
  | "all"
  | "project_linked"
  | "project_unlinked"
  | "microsoft_linked"
  | "microsoft_action_required";

interface Args {
  tasks: Task[];
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  projectFilter: string;
  searchTerm: string;
  dueDateFilter: EngineeringDueDateFilter;
  workloadStateFilter: EngineeringWorkloadStateFilter;
  linkedSourceFilter: EngineeringLinkedSourceFilter;
}

export interface EngineeringTaskMetrics {
  openTasks: Task[];
  overdueTasks: Task[];
  needsApprovalTasks: Task[];
  holdTasks: Task[];
  unassignedTasks: Task[];
  blockedTasks: Task[];
  reviewNeededTasks: Task[];
  approvalPendingTasks: Task[];
  projectLinkedDeliverableTasks: Task[];
  microsoftLinkedTasks: Task[];
  microsoftActionTasks: Task[];
}

function normalizeText(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function toIsoDate(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes("T") ? trimmed.split("T")[0] : trimmed;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function weekEndIso(baseIso: string): string {
  const base = new Date(`${baseIso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + 7);
  return base.toISOString().split("T")[0];
}

function isTaskCompleteStatus(task: Task): boolean {
  return normalizeText(task.status) === "complete";
}

function taskAssigneeNames(task: Task): string[] {
  if ((task.assignees || []).length > 0) return (task.assignees || []).filter(Boolean);
  return (task.resolvedAssignees || []).map((user) => user.name).filter(Boolean);
}

function taskFlags(task: Task) {
  const status = normalizeText(task.status);
  const assigneeNames = taskAssigneeNames(task);
  const isBlocked = task.isBlocked === true || status === "hold" || !!task.holdReason || !!task.blockedType;
  const isApprovalPending =
    task.isApprovalPending === true || status === "needs approval" || status === "operational approval";
  const isReviewNeeded = task.isReviewNeeded === true || status === "provide feedback";
  const isUnassigned =
    task.isUnassigned === true ||
    (assigneeNames.length === 0 && (task.assigneeUserIds?.length || 0) === 0 && !task.ownerUserId);
  const projectLinkedDeliverableCount = task.projectLinkedDeliverableCount || 0;
  const microsoftActionRequiredCount = task.microsoftActionRequiredCount || 0;
  const hasMicrosoftContext =
    task.hasMicrosoftContext === true ||
    microsoftActionRequiredCount > 0 ||
    (task.relatedMicrosoftItems?.length || 0) > 0;

  return {
    assigneeNames,
    isBlocked,
    isApprovalPending,
    isReviewNeeded,
    isUnassigned,
    projectLinkedDeliverableCount,
    microsoftActionRequiredCount,
    hasMicrosoftContext,
  };
}

function matchesDueDateFilter(task: Task, filter: EngineeringDueDateFilter): boolean {
  if (filter === "all") return true;

  const dueDate = toIsoDate(task.dueDate);
  const today = todayIso();
  if (filter === "no_due_date") return !dueDate;
  if (!dueDate || isTaskCompleteStatus(task)) return false;

  if (filter === "overdue") return dueDate < today;
  if (filter === "today") return dueDate === today;
  if (filter === "this_week") return dueDate >= today && dueDate <= weekEndIso(today);
  return true;
}

function matchesWorkloadStateFilter(task: Task, filter: EngineeringWorkloadStateFilter): boolean {
  if (filter === "all") return true;
  const flags = taskFlags(task);

  switch (filter) {
    case "unassigned":
      return flags.isUnassigned;
    case "blocked":
      return flags.isBlocked;
    case "review":
      return flags.isReviewNeeded;
    case "approval":
      return flags.isApprovalPending;
    case "deliverable":
      return flags.projectLinkedDeliverableCount > 0;
    case "microsoft_action":
      return flags.microsoftActionRequiredCount > 0;
    default:
      return true;
  }
}

function matchesLinkedSourceFilter(task: Task, filter: EngineeringLinkedSourceFilter): boolean {
  if (filter === "all") return true;
  const flags = taskFlags(task);

  switch (filter) {
    case "project_linked":
      return !!task.projectName;
    case "project_unlinked":
      return !task.projectName;
    case "microsoft_linked":
      return flags.hasMicrosoftContext;
    case "microsoft_action_required":
      return flags.microsoftActionRequiredCount > 0;
    default:
      return true;
  }
}

export function filterEngineeringTasks({
  tasks,
  statusFilter,
  priorityFilter,
  assigneeFilter,
  projectFilter,
  searchTerm,
  dueDateFilter,
  workloadStateFilter,
  linkedSourceFilter,
}: Args): Task[] {
  return tasks.filter((task) => {
    const flags = taskFlags(task);

    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
    if (assigneeFilter !== "all" && !flags.assigneeNames.includes(assigneeFilter)) return false;
    if (projectFilter !== "all" && (task.projectName || "") !== projectFilter) return false;
    if (!matchesDueDateFilter(task, dueDateFilter)) return false;
    if (!matchesWorkloadStateFilter(task, workloadStateFilter)) return false;
    if (!matchesLinkedSourceFilter(task, linkedSourceFilter)) return false;

    if (searchTerm) {
      const term = normalizeText(searchTerm);
      const searchPool = [
        task.title,
        task.projectName,
        task.description,
        task.externalTaskId,
        task.sourceContextLabel,
        task.deliverableContextLabel,
        ...flags.assigneeNames,
        ...(task.projectLinkedDeliverables || []).map((item) => item.title),
        ...(task.relatedMicrosoftItems || []).flatMap((item) => [item.title, item.type]),
      ]
        .filter(Boolean)
        .map((value) => normalizeText(String(value)));

      if (!searchPool.some((value) => value.includes(term))) return false;
    }

    return true;
  });
}

export function deriveEngineeringTaskMetrics(tasks: Task[]): EngineeringTaskMetrics {
  const openTasks = tasks.filter((task) => !isTaskCompleteStatus(task));
  const overdueTasks = openTasks.filter((task) => {
    const dueDate = toIsoDate(task.dueDate);
    return !!dueDate && dueDate < todayIso();
  });
  const holdTasks = openTasks.filter((task) => normalizeText(task.status) === "hold");
  const blockedTasks = openTasks.filter((task) => taskFlags(task).isBlocked);
  const reviewNeededTasks = openTasks.filter((task) => taskFlags(task).isReviewNeeded);
  const approvalPendingTasks = openTasks.filter((task) => taskFlags(task).isApprovalPending);
  const unassignedTasks = openTasks.filter((task) => taskFlags(task).isUnassigned);
  const projectLinkedDeliverableTasks = openTasks.filter((task) => (task.projectLinkedDeliverableCount || 0) > 0);
  const microsoftLinkedTasks = openTasks.filter((task) => taskFlags(task).hasMicrosoftContext);
  const microsoftActionTasks = openTasks.filter((task) => (task.microsoftActionRequiredCount || 0) > 0);

  return {
    openTasks,
    overdueTasks,
    needsApprovalTasks: approvalPendingTasks,
    holdTasks,
    unassignedTasks,
    blockedTasks,
    reviewNeededTasks,
    approvalPendingTasks,
    projectLinkedDeliverableTasks,
    microsoftLinkedTasks,
    microsoftActionTasks,
  };
}

export function useEngineeringTaskFilters({
  tasks,
  statusFilter,
  priorityFilter,
  assigneeFilter,
  projectFilter,
  searchTerm,
  dueDateFilter,
  workloadStateFilter,
  linkedSourceFilter,
}: Args) {
  const filtered = useMemo(
    () =>
      filterEngineeringTasks({
        tasks,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        projectFilter,
        searchTerm,
        dueDateFilter,
        workloadStateFilter,
        linkedSourceFilter,
      }),
    [
      assigneeFilter,
      dueDateFilter,
      linkedSourceFilter,
      priorityFilter,
      projectFilter,
      searchTerm,
      statusFilter,
      tasks,
      workloadStateFilter,
    ],
  );

  const metrics = useMemo(() => deriveEngineeringTaskMetrics(filtered), [filtered]);

  return {
    filtered,
    ...metrics,
  };
}
