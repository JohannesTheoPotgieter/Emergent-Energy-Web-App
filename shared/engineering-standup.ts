import { isTaskComplete } from "./task-status";

export type StandupGroupKey = "overdue" | "dueSoon" | "onHold" | "inProgress" | "unassigned" | "everythingElse";

export interface StandupTaskLike {
  id: number;
  status: string;
  dueDate: string | null;
  ownerUserId?: number | null;
  assigneeUserIds?: number[] | null;
  assignees?: string[] | null;
  resolvedOwner?: { id: number; name: string } | null;
  resolvedAssignees?: Array<{ id: number; name: string }> | null;
}

export interface BucketedStandup<TTask extends StandupTaskLike> {
  groups: Record<StandupGroupKey, TTask[]>;
  assigneeCounts: Record<StandupGroupKey, number>;
}

const HOLD_STATUSES = new Set(["HOLD", "ON HOLD"]);
const IN_PROGRESS_STATUSES = new Set(["IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK", "PROJECTS ASSISTANCE", "OPERATIONAL APPROVAL"]);

function normalizedStatus(status: string): string {
  return status.trim().toUpperCase();
}

export function isUnassignedTask(task: StandupTaskLike): boolean {
  const hasResolvedAssignees = (task.resolvedAssignees || []).some((a) => !!a?.name);
  const hasTextAssignees = (task.assignees || []).some((a) => !!a?.trim());
  const hasIds = (task.assigneeUserIds?.length || 0) > 0;
  return !hasResolvedAssignees && !hasTextAssignees && !hasIds && !task.resolvedOwner?.id && !task.ownerUserId;
}

export function classifyStandupGroup(task: StandupTaskLike, todayIso: string, dueSoonDays = 7): StandupGroupKey {
  const status = normalizedStatus(task.status);
  if (isTaskComplete(status)) return "everythingElse";

  if (HOLD_STATUSES.has(status)) return "onHold";
  if (task.dueDate && task.dueDate < todayIso) return "overdue";

  if (task.dueDate) {
    const dueSoonDate = new Date(`${todayIso}T00:00:00.000Z`);
    dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + dueSoonDays);
    const dueSoonIso = dueSoonDate.toISOString().split("T")[0];
    if (task.dueDate <= dueSoonIso) return "dueSoon";
  }

  if (IN_PROGRESS_STATUSES.has(status)) return "inProgress";
  if (isUnassignedTask(task)) return "unassigned";
  return "everythingElse";
}

export function bucketEngineeringStandupTasks<TTask extends StandupTaskLike>(
  tasks: TTask[],
  todayIso: string,
  dueSoonDays = 7,
): BucketedStandup<TTask> {
  const groups: Record<StandupGroupKey, TTask[]> = {
    overdue: [],
    dueSoon: [],
    onHold: [],
    inProgress: [],
    unassigned: [],
    everythingElse: [],
  };

  for (const task of tasks) {
    if (isTaskComplete(normalizedStatus(task.status))) continue;
    const key = classifyStandupGroup(task, todayIso, dueSoonDays);
    groups[key].push(task);
  }

  const assigneeCounts = Object.fromEntries(
    (Object.keys(groups) as StandupGroupKey[]).map((key) => {
      const labels = new Set(groups[key].map((task) => (isUnassignedTask(task) ? "Unassigned" : "Assigned")));
      return [key, labels.size === 0 ? 0 : labels.size];
    }),
  ) as Record<StandupGroupKey, number>;

  return { groups, assigneeCounts };
}

