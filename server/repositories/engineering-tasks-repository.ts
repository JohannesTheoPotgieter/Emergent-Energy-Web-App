/**
 * Engineering Tasks repository — spine writes for the Task Manager (Phase 2).
 *
 * Writes `work_items` (workstream = ENG) DIRECTLY via Drizzle (not the retired
 * work-items adapter). Status transitions go through the single workflow
 * chokepoint (`task-workflow-guard`), which enforces the Done-gate. Every
 * mutation writes `work_item_status_history` + an audit event; assignments and
 * notifications use the canonical spine tables/services.
 */

import { and, eq, isNull, desc, lte, inArray, count } from "drizzle-orm";
import { db } from "../db";
import {
  workItems,
  workItemAssignments,
  workItemStatusHistory,
  workItemDependencies,
  workItemDocumentLinks,
  projectInfo,
  users,
} from "@shared/schema";
import {
  buildEngineeringTaskInsert,
  buildBulkEngineeringTaskInserts,
  buildSeamHandoffInsert,
  buildStatusHistoryInsert,
  type BuildEngineeringTaskInput,
  type BuildBulkEngineeringTaskInput,
  type BuildSeamHandoffInput,
} from "../lib/engineering/task-builders";
import {
  buildTaskWorkflowContext,
  assertTaskWorkflowTransition,
  type TaskWorkflowMutationSource,
} from "../lib/task-workflow-guard";
import { recordAudit } from "../api/v2/services/audit-service";
import { createNotification } from "../services/notification-service";
import { isTaskComplete } from "@shared/task-status";

export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemDocumentLinkRow = typeof workItemDocumentLinks.$inferSelect;

export interface EngineeringTaskFilters {
  projectId?: number;
  ownerUserId?: number;
  status?: string;
  taskTypeTag?: string;
  dueBefore?: string;
}

/** Enriched list row — names resolved server-side so the UI needs no
 *  cross-module calls under the Live-Ready ring fence. */
export interface EngineeringTaskListItem {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  taskTypeTag: string | null;
  status: string;
  priority: string | null;
  endDate: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  documentCount: number;
}

export async function listEngineeringTasks(filters: EngineeringTaskFilters = {}): Promise<EngineeringTaskListItem[]> {
  const conds = [eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)];
  if (filters.projectId != null) conds.push(eq(workItems.projectId, filters.projectId));
  if (filters.ownerUserId != null) conds.push(eq(workItems.ownerUserId, filters.ownerUserId));
  if (filters.status) conds.push(eq(workItems.status, filters.status));
  if (filters.taskTypeTag) conds.push(eq(workItems.taskTypeTag, filters.taskTypeTag));
  if (filters.dueBefore) conds.push(lte(workItems.endDate, filters.dueBefore));

  const rows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      projectId: workItems.projectId,
      projectName: projectInfo.projectName,
      taskTypeTag: workItems.taskTypeTag,
      status: workItems.status,
      priority: workItems.priority,
      endDate: workItems.endDate,
      ownerUserId: workItems.ownerUserId,
      ownerName: users.name,
    })
    .from(workItems)
    .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .where(and(...conds))
    .orderBy(desc(workItems.updatedAt));

  const ids = rows.map((r: (typeof rows)[number]) => r.id);
  const docCounts = new Map<number, number>();
  if (ids.length > 0) {
    const counts = await db
      .select({ workItemId: workItemDocumentLinks.workItemId, c: count() })
      .from(workItemDocumentLinks)
      .where(inArray(workItemDocumentLinks.workItemId, ids))
      .groupBy(workItemDocumentLinks.workItemId);
    for (const row of counts) docCounts.set(row.workItemId, Number(row.c));
  }

  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId ?? null,
    projectName: r.projectName ?? null,
    taskTypeTag: r.taskTypeTag ?? null,
    status: r.status,
    priority: r.priority ?? null,
    endDate: r.endDate ?? null,
    ownerUserId: r.ownerUserId ?? null,
    ownerName: r.ownerName ?? null,
    documentCount: docCounts.get(r.id) ?? 0,
  }));
}

export interface EngineeringOptions {
  projects: { id: number; name: string }[];
  users: { id: number; name: string }[];
}

/** Assignment dropdown data (projects + users) for the Task Manager forms. */
export async function getEngineeringOptions(): Promise<EngineeringOptions> {
  const projects = await db
    .select({ id: projectInfo.id, name: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))
    .orderBy(projectInfo.projectName);
  const userRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.name);
  return { projects, users: userRows };
}

export async function getEngineeringTask(taskId: number): Promise<WorkItemRow | null> {
  const [row] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, taskId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function assignOwner(workItemId: number, userId: number): Promise<void> {
  await db
    .insert(workItemAssignments)
    .values({ workItemId, userId, role: "OWNER" })
    .onConflictDoNothing();
}

export async function createEngineeringTask(input: BuildEngineeringTaskInput, actorId: number): Promise<WorkItemRow> {
  const insert = buildEngineeringTaskInsert(input, actorId);
  const [row] = await db.insert(workItems).values(insert).returning();
  if (insert.ownerUserId != null) await assignOwner(row.id, insert.ownerUserId);
  await db.insert(workItemStatusHistory).values(buildStatusHistoryInsert(row.id, null, row.status, actorId, "created"));
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(row.id),
    action: "engineering.task.create",
    changesJson: { taskTypeTag: insert.taskTypeTag, projectId: insert.projectId },
  });
  return row;
}

export async function bulkCreateEngineeringTasks(input: BuildBulkEngineeringTaskInput, actorId: number): Promise<WorkItemRow[]> {
  const inserts = buildBulkEngineeringTaskInserts(input, actorId);
  const rows: WorkItemRow[] = [];
  for (const ins of inserts) {
    const [row] = await db.insert(workItems).values(ins).returning();
    if (ins.ownerUserId != null) await assignOwner(row.id, ins.ownerUserId);
    await db.insert(workItemStatusHistory).values(buildStatusHistoryInsert(row.id, null, row.status, actorId, "created (bulk)"));
    rows.push(row);
  }
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    action: "engineering.task.bulk_create",
    changesJson: { count: rows.length, ids: rows.map((r) => r.id) },
  });
  return rows;
}

/**
 * Transition a task's status through the single workflow chokepoint. Throws
 * `TaskWorkflowGuardError` if the Done-gate (no Done without a linked document)
 * or another workflow rule blocks it. Returns null when the task isn't found.
 */
export async function transitionEngineeringTaskStatus(
  taskId: number,
  newStatus: string,
  actorId: number,
  opts: { reason?: string; source?: TaskWorkflowMutationSource } = {},
): Promise<WorkItemRow | null> {
  const current = await getEngineeringTask(taskId);
  if (!current) return null;

  const context = await buildTaskWorkflowContext(taskId, current.status);
  assertTaskWorkflowTransition(context, newStatus, opts.source ?? "status_update");

  const completedAt = isTaskComplete(newStatus) ? new Date() : null;
  const [updated] = await db
    .update(workItems)
    .set({ status: newStatus, completedAt, updatedAt: new Date() })
    .where(eq(workItems.id, taskId))
    .returning();

  await db.insert(workItemStatusHistory).values(buildStatusHistoryInsert(taskId, current.status, newStatus, actorId, opts.reason));
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.status_change",
    changesJson: { from: current.status, to: newStatus },
  });
  if (updated.ownerUserId != null && updated.ownerUserId !== actorId) {
    await createNotification({
      recipientUserId: updated.ownerUserId,
      eventType: "engineering.task.status_changed",
      title: `Task status: ${updated.title}`,
      body: `Status changed to "${newStatus}".`,
      projectId: updated.projectId ?? undefined,
      linkedTaskId: updated.id,
      relatedEntityType: "work_item",
      relatedEntityId: updated.id,
    });
  }
  return updated;
}

// ── Document links ────────────────────────────────────────────────────────

export async function listTaskDocumentLinks(taskId: number): Promise<WorkItemDocumentLinkRow[]> {
  return db
    .select()
    .from(workItemDocumentLinks)
    .where(eq(workItemDocumentLinks.workItemId, taskId))
    .orderBy(desc(workItemDocumentLinks.createdAt));
}

export async function linkDocumentToTask(
  taskId: number,
  input: { managedDocumentId?: number | null; projectDocumentLinkId?: number | null; linkRole?: string },
  actorId: number,
): Promise<WorkItemDocumentLinkRow> {
  const [row] = await db
    .insert(workItemDocumentLinks)
    .values({
      workItemId: taskId,
      managedDocumentId: input.managedDocumentId ?? null,
      projectDocumentLinkId: input.projectDocumentLinkId ?? null,
      linkRole: input.linkRole ?? "output",
      createdByUserId: actorId,
    })
    .returning();
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.document_link",
    changesJson: { managedDocumentId: row.managedDocumentId, projectDocumentLinkId: row.projectDocumentLinkId },
  });
  return row;
}

export async function unlinkDocumentFromTask(taskId: number, linkId: number, actorId: number): Promise<boolean> {
  const deleted = await db
    .delete(workItemDocumentLinks)
    .where(and(eq(workItemDocumentLinks.id, linkId), eq(workItemDocumentLinks.workItemId, taskId)))
    .returning({ id: workItemDocumentLinks.id });
  if (deleted.length > 0) {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.document_unlink",
      changesJson: { linkId },
    });
  }
  return deleted.length > 0;
}

// ── Seam handoffs ───────────────────────────────────────────────────────────

/**
 * Create a tracked seam handoff: a spine ENG work item owned by the recipient
 * (Keith / Construction Manager), with a due date, a notification, an audit
 * event, an initial status-history row, and a dependency back-link to the
 * originating task. Reuses canonical tables — no parallel handoff entity.
 */
export async function createSeamHandoff(
  input: BuildSeamHandoffInput & { fromTaskId?: number | null },
  actorId: number,
): Promise<WorkItemRow> {
  const insert = buildSeamHandoffInsert(input, actorId);
  const [row] = await db.insert(workItems).values(insert).returning();
  await assignOwner(row.id, input.toOwnerUserId);
  await db.insert(workItemStatusHistory).values(buildStatusHistoryInsert(row.id, null, row.status, actorId, "seam handoff created"));
  if (input.fromTaskId != null) {
    await db.insert(workItemDependencies).values({
      predecessorId: input.fromTaskId,
      successorId: row.id,
      depType: "FS",
      source: "MANUAL",
    });
  }
  await createNotification({
    recipientUserId: input.toOwnerUserId,
    eventType: "engineering.seam.assigned",
    title: `Handoff to you: ${row.title}`,
    body: input.note ?? `A ${input.seamType} item was handed to you.`,
    projectId: row.projectId ?? undefined,
    linkedTaskId: row.id,
    relatedEntityType: "work_item",
    relatedEntityId: row.id,
  });
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(row.id),
    action: "engineering.seam.create",
    changesJson: { seamType: input.seamType, fromTaskId: input.fromTaskId ?? null, toOwnerUserId: input.toOwnerUserId },
  });
  return row;
}
