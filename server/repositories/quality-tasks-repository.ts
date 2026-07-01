import { listEngineeringWorkItems, type EngTask } from "../work-items-adapter";
import { buildUserMap } from "../user-resolver";
import {
  isQualityTaskRecord,
  matchesQualityTaskFilters,
  type QualityTaskFilters,
} from "../lib/quality-task-filters";

export interface QualityTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  discipline: "Quality";
  dueDate: string | Date | null;
  projectId: number | null;
  projectName: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  linkedQualityItemInstanceId: number | null;
  taskTypeTag: string | null;
}

export interface QualityTaskCounts {
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
  unassigned: number;
}

export interface QualityTaskListResult {
  tasks: QualityTask[];
  counts: QualityTaskCounts;
}

function deriveQualitySource(task: EngTask): string {
  const tag = task.taskTypeTag?.toLowerCase() ?? "";
  const title = task.title.toLowerCase();
  if (tag.includes("ncr") || title.includes("ncr") || title.includes("non-conformance")) return "ncr";
  if (tag.includes("evidence") || title.includes("evidence") || task.linkedQualityItemInstanceId) return "evidence";
  if (tag.includes("qa") || tag.includes("qc")) return "qa";
  return "quality";
}

function buildCounts(tasks: QualityTask[]): QualityTaskCounts {
  const now = Date.now();
  const byStatus: Record<string, number> = {};
  let overdue = 0;
  let unassigned = 0;

  for (const task of tasks) {
    const status = task.status || "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const due = task.dueDate ? new Date(task.dueDate).getTime() : Number.NaN;
    const closed = ["complete", "completed", "done", "closed", "cancelled", "canceled"].includes(status.toLowerCase());
    if (!Number.isNaN(due) && due < now && !closed) overdue += 1;
    if (!task.assigneeId) unassigned += 1;
  }

  return { total: tasks.length, byStatus, overdue, unassigned };
}

export async function listQualityTasks(filters: QualityTaskFilters): Promise<QualityTaskListResult> {
  const candidateTasks = await listEngineeringWorkItems({
    status: filters.status,
    ownerUserId: filters.ownerUserId,
    projectId: filters.projectId,
    // Include native QUALITY-workstream work items, not just ENG-lane ones that
    // happen to look like quality work. isQualityTaskRecord treats the QUALITY
    // workstream as authoritative.
    workstreams: ["ENG", "QUALITY"],
  });
  const userMap = await buildUserMap();

  const tasks = candidateTasks
    .filter(isQualityTaskRecord)
    .filter((task) => matchesQualityTaskFilters(task, filters))
    .map((task): QualityTask => {
      const assigneeId = task.ownerUserId ?? task.assigneeUserIds[0] ?? null;
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        source: deriveQualitySource(task),
        discipline: "Quality",
        dueDate: task.dueDate,
        projectId: task.projectId,
        projectName: task.projectName,
        assigneeId,
        assigneeName: assigneeId ? userMap.get(assigneeId)?.name ?? null : null,
        linkedQualityItemInstanceId: task.linkedQualityItemInstanceId,
        taskTypeTag: task.taskTypeTag,
      };
    });

  return {
    tasks,
    counts: buildCounts(tasks),
  };
}
