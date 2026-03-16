export type WorkItemConversionTarget = "milestone" | "task";

export interface WorkItemRecord {
  id: number;
  projectId: number | null;
  title: string | null;
  isMilestone: boolean | null;
  duration: number | null;
  indentLevel: number | null;
  parentId: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkItemConversionRepo {
  getById(id: number): Promise<WorkItemRecord | null>;
  listByIds(ids: number[]): Promise<WorkItemRecord[]>;
  patchById(id: number, patch: Partial<WorkItemRecord>): Promise<void>;
}

export interface ConvertWorkItemParams {
  repo: WorkItemConversionRepo;
  workItemId: number;
  target: WorkItemConversionTarget;
  projectId?: number;
  subtaskWorkItemIds?: number[];
  now?: Date;
}

export class WorkItemConversionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "WorkItemConversionError";
  }
}

function requiredMilestoneFieldErrors(item: WorkItemRecord): string[] {
  const errors: string[] = [];
  if (!item.projectId) errors.push("projectId is required");
  if (!item.title || !item.title.trim()) errors.push("title is required");
  return errors;
}

export async function convertWorkItemTypeInPlace(params: ConvertWorkItemParams) {
  const { repo, workItemId, target, projectId, subtaskWorkItemIds = [], now = new Date() } = params;
  const item = await repo.getById(workItemId);
  if (!item || item.deletedAt) throw new WorkItemConversionError("Work item not found", 404);
  if (projectId && item.projectId !== projectId) {
    throw new WorkItemConversionError("Work item does not belong to this project", 400);
  }

  if (target === "milestone") {
    if (item.isMilestone) throw new WorkItemConversionError("Item is already a milestone", 409);
    const milestoneValidationErrors = requiredMilestoneFieldErrors(item);
    if (milestoneValidationErrors.length) {
      throw new WorkItemConversionError(`Cannot convert to milestone: ${milestoneValidationErrors.join(", ")}`);
    }

    await repo.patchById(workItemId, { isMilestone: true, duration: 0, updatedAt: now });

    const safeSubtaskIds = Array.from(new Set(subtaskWorkItemIds.filter((id) => id !== workItemId)));
    if (safeSubtaskIds.length > 0) {
      const subtaskRows = await repo.listByIds(safeSubtaskIds);
      const foundIds = new Set(subtaskRows.map((row) => row.id));
      const missingIds = safeSubtaskIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new WorkItemConversionError(`Cannot convert to milestone: linked work item(s) not found (${missingIds.join(", ")})`, 400);
      }

      const mismatchedProjectIds = subtaskRows.filter((row) => row.projectId !== item.projectId).map((row) => row.id);
      if (mismatchedProjectIds.length > 0) {
        throw new WorkItemConversionError(`Cannot convert to milestone: linked work item(s) are in another project (${mismatchedProjectIds.join(", ")})`, 400);
      }

      const parentIndent = item.indentLevel ?? 0;
      for (const subtask of subtaskRows) {
        await repo.patchById(subtask.id, { parentId: workItemId, indentLevel: parentIndent + 1, updatedAt: now });
      }
    }
  } else {
    if (!item.isMilestone) throw new WorkItemConversionError("Item is already a regular task", 409);
    await repo.patchById(workItemId, { isMilestone: false, duration: item.duration && item.duration > 0 ? item.duration : 1, updatedAt: now });
  }

  return {
    workItemId,
    target,
    message: target === "milestone" ? "Converted to milestone" : "Converted to task",
  };
}
