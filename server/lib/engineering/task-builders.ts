/**
 * Pure builders for engineering work-item inserts (no DB, no IO).
 *
 * Centralises the shape of a spine `work_items` row created by the Engineering
 * delivery surface (workstream = ENG) so the repository's DB writes and the
 * unit tests agree on the payload. Keeps the "tracked item" contract for tasks
 * and seam handoffs verifiable without a database.
 */

import {
  ENGINEERING_TASK_TYPE_LABELS,
  type EngineeringTaskTypeTag,
  type EngineeringSeamTaskTypeTag,
} from "@shared/engineering/delivery-task-catalog";

export const DEFAULT_TASK_STATUS = "not_started";

/** The columns the engineering surface sets when inserting a work_items row. */
export interface EngineeringTaskInsert {
  workstream: "ENG";
  source: "UI";
  title: string;
  description: string | null;
  taskTypeTag: string | null;
  priority: string | null;
  status: string;
  projectId: number | null;
  ownerUserId: number | null;
  endDate: string | null;
  createdBy: number;
}

export interface BuildEngineeringTaskInput {
  title: string;
  description?: string | null;
  taskTypeTag?: string | null;
  priority?: string | null;
  projectId?: number | null;
  ownerUserId?: number | null;
  endDate?: string | null;
  status?: string;
}

export function buildEngineeringTaskInsert(input: BuildEngineeringTaskInput, actorId: number): EngineeringTaskInsert {
  return {
    workstream: "ENG",
    source: "UI",
    title: input.title.trim(),
    description: input.description ?? null,
    taskTypeTag: input.taskTypeTag ?? null,
    priority: input.priority ?? null,
    status: input.status ?? DEFAULT_TASK_STATUS,
    projectId: input.projectId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    endDate: input.endDate ?? null,
    createdBy: actorId,
  };
}

export interface BuildBulkEngineeringTaskInput {
  projectId?: number | null;
  taskTypeTags: EngineeringTaskTypeTag[];
  ownerUserId?: number | null;
  dueDate?: string | null;
}

/** One task per catalog type, titled from the catalog label. */
export function buildBulkEngineeringTaskInserts(input: BuildBulkEngineeringTaskInput, actorId: number): EngineeringTaskInsert[] {
  return input.taskTypeTags.map((tag) =>
    buildEngineeringTaskInsert(
      {
        title: ENGINEERING_TASK_TYPE_LABELS[tag],
        taskTypeTag: tag,
        projectId: input.projectId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        endDate: input.dueDate ?? null,
      },
      actorId,
    ),
  );
}

export interface BuildSeamHandoffInput {
  seamType: EngineeringSeamTaskTypeTag;
  toOwnerUserId: number;
  title: string;
  note?: string | null;
  projectId?: number | null;
  dueDate?: string | null;
}

/** A seam handoff is a tracked ENG work item owned by the recipient. */
export function buildSeamHandoffInsert(input: BuildSeamHandoffInput, actorId: number): EngineeringTaskInsert {
  return buildEngineeringTaskInsert(
    {
      title: input.title,
      description: input.note ?? null,
      taskTypeTag: input.seamType,
      projectId: input.projectId ?? null,
      ownerUserId: input.toOwnerUserId,
      endDate: input.dueDate ?? null,
    },
    actorId,
  );
}

export interface StatusHistoryInsert {
  workItemId: number;
  oldStatus: string | null;
  newStatus: string;
  changedBy: number;
  reason: string | null;
}

export function buildStatusHistoryInsert(
  workItemId: number,
  oldStatus: string | null,
  newStatus: string,
  changedBy: number,
  reason?: string | null,
): StatusHistoryInsert {
  return { workItemId, oldStatus, newStatus, changedBy, reason: reason ?? null };
}
