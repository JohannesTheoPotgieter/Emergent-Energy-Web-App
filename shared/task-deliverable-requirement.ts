export const DELIVERABLE_REQUIRED_TAG = "DELIVERABLE_REQUIRED";

export type DeliverableRequirementTaskLike = {
  linkedDeliverableId?: number | null;
  taskTypeTag?: string | null;
  tags?: string[] | null;
};

export function hasDeliverableRequirementTag(tags?: string[] | null): boolean {
  return (tags || []).some((tag) => String(tag || "").trim().toUpperCase() === DELIVERABLE_REQUIRED_TAG);
}

export function hasDeliverableRequirementFlag(task: DeliverableRequirementTaskLike): boolean {
  return (
    !!task.linkedDeliverableId ||
    String(task.taskTypeTag || "").toUpperCase().includes("DELIVERABLE") ||
    hasDeliverableRequirementTag(task.tags)
  );
}

export function withDeliverableRequirementTag(tags: string[] | null | undefined, required: boolean): string[] | null {
  const existing = (tags || []).filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  const withoutFlag = existing.filter((tag) => tag.trim().toUpperCase() !== DELIVERABLE_REQUIRED_TAG);

  if (!required) {
    return withoutFlag.length > 0 ? withoutFlag : null;
  }

  return [...withoutFlag, DELIVERABLE_REQUIRED_TAG];
}
