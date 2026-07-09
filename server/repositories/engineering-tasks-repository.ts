/**
 * Engineering Tasks repository — spine writes for the Task Manager (Phase 2).
 *
 * Writes `work_items` (workstream = ENG) DIRECTLY via Drizzle (not the retired
 * work-items adapter). Status transitions go through the single workflow
 * chokepoint (`task-workflow-guard`), which enforces the Done-gate. Every
 * mutation writes `work_item_status_history` + an audit event; assignments and
 * notifications use the canonical spine tables/services.
 */

import { and, eq, ne, or, isNull, asc, desc, inArray, count } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  workItems,
  workItemAssignments,
  workItemStatusHistory,
  workItemDependencies,
  workItemDocumentLinks,
  taskComments,
  taskCommentMentions,
  taskChecklists,
  taskChecklistItems,
  approvals,
  projectInfo,
  users,
} from "@shared/schema";
import {
  buildEngineeringTaskInsert,
  buildBulkEngineeringTaskInserts,
  buildStatusHistoryInsert,
  type BuildEngineeringTaskInput,
  type BuildBulkEngineeringTaskInput,
} from "../lib/engineering/task-builders";
import {
  buildTaskWorkflowContext,
  assertTaskWorkflowTransition,
  type TaskWorkflowMutationSource,
} from "../lib/task-workflow-guard";
import { recordAudit } from "../api/v2/services/audit-service";
import { listManagedDocumentsByProject, getManagedDocumentById } from "./managed-documents-repository";
import { getProjectDocumentLink } from "./project-document-register-repository";
import { isTaskComplete } from "@shared/task-status";
import { ApiError, conflict, notFound, badRequest, logApiError } from "../lib/api-error";
import { runInTransaction } from "../lib/drizzle-helpers";
import {
  derivePlanLink,
  effectiveEngineeringDueDate,
  type PlanLinkRelation,
  type DerivedPlanLink,
} from "@shared/engineering/plan-link";

export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemDocumentLinkRow = typeof workItemDocumentLinks.$inferSelect;

export interface EngineeringTaskFilters {
  projectId?: number;
  ownerUserId?: number;
  status?: string;
  taskTypeTag?: string;
  dueBefore?: string;
  limit?: number;
  offset?: number;
}

/** Hard cap on rows a single engineering-task list query returns, so an
 *  unbounded board fetch can't scan the whole table. Applied even when the
 *  caller asks for more. */
export const ENGINEERING_TASKS_MAX_LIMIT = 500;
/** Default page size when a caller doesn't specify one. */
export const ENGINEERING_TASKS_DEFAULT_LIMIT = 200;
/** Hard cap on option-list rows (projects / users) for the assignment dropdowns. */
export const ENGINEERING_OPTIONS_MAX = 1000;

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
  subtaskTotal: number;
  subtaskDone: number;
  // Project-plan link (derived). Present only when the task links a plan task.
  planLinkItemId: number | null;
  planLinkRelation: string | null;
  planLinkLeadDays: number | null;
  planItemTitle: string | null;
  /** The plan start ('before') or end ('after') date the due date is derived from. */
  planAnchorDate: string | null;
  /** Computed flag — due within 5 days or overdue and the task isn't complete. */
  planLinkUrgent: boolean;
}

// ── Plan-link derivation (read-time authoritative; see PATCH plan-link) ──────
// The DB-free derivation now lives in `@shared/engineering/plan-link`, the
// single source shared by the Task Manager list/detail AND the Engineering Home
// counts so a task's due/overdue can't diverge between surfaces. Re-exported
// here to keep this repository's public surface unchanged.
export { derivePlanLink, effectiveEngineeringDueDate };
export type { PlanLinkRelation, DerivedPlanLink };

/** A `work_items` row reads as a "plan" line when it's a milestone, links to a
 *  plan item, or sits in the PM workstream (same predicate as `classifyKind`).
 *  This is the canonical "project plan task" test for the plan-link feature. */
export function isPlanKind(row: {
  isMilestone: boolean | null;
  linkedPlanItemId: number | null;
  workstream: string;
}): boolean {
  return classifyKind(row) === "plan";
}

export async function listEngineeringTasks(filters: EngineeringTaskFilters = {}): Promise<EngineeringTaskListItem[]> {
  const conds = [eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)];
  if (filters.projectId != null) conds.push(eq(workItems.projectId, filters.projectId));
  if (filters.ownerUserId != null) conds.push(eq(workItems.ownerUserId, filters.ownerUserId));
  if (filters.status) conds.push(eq(workItems.status, filters.status));
  if (filters.taskTypeTag) conds.push(eq(workItems.taskTypeTag, filters.taskTypeTag));

  // Pagination with a HARD cap: bound the page even when a caller asks for more,
  // so a board fetch can't scan the whole table.
  const cap = Math.min(Math.max(1, filters.limit ?? ENGINEERING_TASKS_DEFAULT_LIMIT), ENGINEERING_TASKS_MAX_LIMIT);
  const offset = Math.max(0, filters.offset ?? 0);
  // NB: `dueBefore` is applied AFTER plan-link derivation (below), not as a SQL
  // predicate on the persisted `endDate` — for a plan-linked task the derived
  // due can differ from the stored date, so filtering the raw column would
  // include/exclude the wrong tasks.

  // Self-join the linked plan task so its dates feed read-time due-date
  // derivation (authoritative for plan-linked tasks — keeps the synced due date
  // correct if the plan task's date later moves).
  const planItems = alias(workItems, "plan_items");
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
      planLinkItemId: workItems.planLinkItemId,
      planLinkRelation: workItems.planLinkRelation,
      planLinkLeadDays: workItems.planLinkLeadDays,
      planItemTitle: planItems.title,
      planStart: planItems.startDate,
      planEnd: planItems.endDate,
    })
    .from(workItems)
    .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .leftJoin(planItems, eq(planItems.id, workItems.planLinkItemId))
    .where(and(...conds))
    // `id` is the deterministic tiebreaker so pages don't overlap when several
    // tasks share an `updatedAt`.
    .orderBy(desc(workItems.updatedAt), desc(workItems.id))
    .limit(cap)
    .offset(offset);

  const ids = rows.map((r: (typeof rows)[number]) => r.id);
  const docCounts = new Map<number, number>();
  const subtaskTotals = new Map<number, number>();
  const subtaskDone = new Map<number, number>();
  if (ids.length > 0) {
    const counts = await db
      .select({ workItemId: workItemDocumentLinks.workItemId, c: count() })
      .from(workItemDocumentLinks)
      .where(inArray(workItemDocumentLinks.workItemId, ids))
      .groupBy(workItemDocumentLinks.workItemId);
    for (const row of counts) docCounts.set(row.workItemId, Number(row.c));

    // Cheap subtask progress aggregate: one pass over the children of every
    // listed task. `parentId` is indexed (work_items_parent_id_idx).
    const subtaskRows = await db
      .select({ parentId: workItems.parentId, status: workItems.status })
      .from(workItems)
      .where(and(inArray(workItems.parentId, ids), isNull(workItems.deletedAt)));
    for (const sub of subtaskRows) {
      if (sub.parentId == null) continue;
      subtaskTotals.set(sub.parentId, (subtaskTotals.get(sub.parentId) ?? 0) + 1);
      if (isTaskComplete(sub.status)) {
        subtaskDone.set(sub.parentId, (subtaskDone.get(sub.parentId) ?? 0) + 1);
      }
    }
  }

  const items = rows.map((r: (typeof rows)[number]) => {
    const isPlanLinked = r.planLinkItemId != null;
    const derived = isPlanLinked
      ? derivePlanLink({
          relation: r.planLinkRelation,
          leadDays: r.planLinkLeadDays,
          planStart: r.planStart,
          planEnd: r.planEnd,
          taskStatus: r.status,
        })
      : null;
    return {
      id: r.id,
      title: r.title,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      taskTypeTag: r.taskTypeTag ?? null,
      status: r.status,
      priority: r.priority ?? null,
      // Plan-linked: read-time derived due date is authoritative; otherwise the
      // persisted endDate stands.
      endDate: isPlanLinked ? derived!.derivedDue : r.endDate ?? null,
      ownerUserId: r.ownerUserId ?? null,
      ownerName: r.ownerName ?? null,
      documentCount: docCounts.get(r.id) ?? 0,
      subtaskTotal: subtaskTotals.get(r.id) ?? 0,
      subtaskDone: subtaskDone.get(r.id) ?? 0,
      planLinkItemId: r.planLinkItemId ?? null,
      planLinkRelation: isPlanLinked ? r.planLinkRelation ?? null : null,
      planLinkLeadDays: isPlanLinked ? r.planLinkLeadDays ?? null : null,
      planItemTitle: isPlanLinked ? r.planItemTitle ?? null : null,
      planAnchorDate: derived?.planAnchorDate ?? null,
      planLinkUrgent: derived?.planLinkUrgent ?? false,
    };
  });

  // Due-before filter, applied to the effective (plan-link-derived) due date.
  if (filters.dueBefore) {
    const cutoff = filters.dueBefore;
    return items.filter((i: EngineeringTaskListItem) => i.endDate != null && i.endDate <= cutoff);
  }
  return items;
}

export interface EngineeringOptions {
  projects: { id: number; name: string }[];
  users: { id: number; name: string }[];
}

/** Assignment dropdown data (projects + users) for the Task Manager forms.
 *  Both lists are hard-capped (`ENGINEERING_OPTIONS_MAX`) so the options
 *  endpoint can't return an unbounded result set. */
export async function getEngineeringOptions(): Promise<EngineeringOptions> {
  const projects = await db
    .select({ id: projectInfo.id, name: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))
    .orderBy(projectInfo.projectName)
    .limit(ENGINEERING_OPTIONS_MAX);
  const userRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.name)
    .limit(ENGINEERING_OPTIONS_MAX);
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

/** A single ENG task with the plan-link derived fields + read-time due-date
 *  override applied (same authoritative derivation as `listEngineeringTasks`).
 *  `getEngineeringTask` stays the raw accessor for internal mutation paths. */
export type EngineeringTaskDetail = WorkItemRow & {
  planItemTitle: string | null;
  planAnchorDate: string | null;
  planLinkUrgent: boolean;
};

export async function getEngineeringTaskDetail(taskId: number): Promise<EngineeringTaskDetail | null> {
  const row = await getEngineeringTask(taskId);
  if (!row) return null;
  if (row.planLinkItemId == null) {
    return { ...row, planItemTitle: null, planAnchorDate: null, planLinkUrgent: false };
  }
  const [plan] = await db
    .select({ title: workItems.title, startDate: workItems.startDate, endDate: workItems.endDate })
    .from(workItems)
    .where(eq(workItems.id, row.planLinkItemId))
    .limit(1);
  const derived = derivePlanLink({
    relation: row.planLinkRelation,
    leadDays: row.planLinkLeadDays,
    planStart: plan?.startDate ?? null,
    planEnd: plan?.endDate ?? null,
    taskStatus: row.status,
  });
  return {
    ...row,
    // Read-time override: derived due date is authoritative for plan-linked tasks.
    endDate: derived.derivedDue,
    planItemTitle: plan?.title ?? null,
    planAnchorDate: derived.planAnchorDate,
    planLinkUrgent: derived.planLinkUrgent,
  };
}

async function assignOwner(workItemId: number, userId: number): Promise<void> {
  await db
    .insert(workItemAssignments)
    .values({ workItemId, userId, role: "OWNER" })
    .onConflictDoNothing();
}


export async function createEngineeringTask(input: BuildEngineeringTaskInput, actorId: number): Promise<WorkItemRow> {
  const insert = buildEngineeringTaskInsert(input, actorId);
  // Atomic: the task, its OWNER assignment, and its first status-history row
  // commit together or not at all.
  const row = await runInTransaction(async (tx) => {
    const [created] = await tx.insert(workItems).values(insert).returning();
    if (insert.ownerUserId != null) {
      await tx
        .insert(workItemAssignments)
        .values({ workItemId: created.id, userId: insert.ownerUserId, role: "OWNER" })
        .onConflictDoNothing();
    }
    await tx
      .insert(workItemStatusHistory)
      .values(buildStatusHistoryInsert(created.id, null, created.status, actorId, "created"));
    return created;
  });
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
  if (inserts.length === 0) return [];
  // Atomic + set-based: one batched insert, one batched assignment insert, and
  // one batched status-history insert — three statements regardless of count,
  // and a mid-batch failure rolls the whole batch back (no partial creation).
  const rows = await runInTransaction(async (tx) => {
    const created: WorkItemRow[] = await tx.insert(workItems).values(inserts).returning();
    const assignments = created
      .filter((r) => r.ownerUserId != null)
      .map((r) => ({ workItemId: r.id, userId: r.ownerUserId as number, role: "OWNER" as const }));
    if (assignments.length > 0) {
      await tx.insert(workItemAssignments).values(assignments).onConflictDoNothing();
    }
    await tx
      .insert(workItemStatusHistory)
      .values(created.map((r) => buildStatusHistoryInsert(r.id, null, r.status, actorId, "created (bulk)")));
    return created;
  });
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

  // Dependency complete-guard: cannot reach a complete state while any
  // blocked-by (predecessor) task is still open. Reuses work_item_dependencies.
  if (isTaskComplete(newStatus)) {
    const blockers = await getIncompleteBlockers(taskId);
    if (blockers.length > 0) {
      throw conflict(
        `Cannot complete: blocked by ${blockers.length} incomplete task(s): ${blockers.map((b) => b.title).join(", ")}.`,
      );
    }
  }

  const context = await buildTaskWorkflowContext(taskId, current.status);
  assertTaskWorkflowTransition(context, newStatus, opts.source ?? "status_update");

  const completedAt = isTaskComplete(newStatus) ? new Date() : null;
  // Atomic: the status change and its history row commit together (or not at
  // all) so the two can never diverge on a mid-write failure.
  const updated = await runInTransaction(async (tx) => {
    const [row] = await tx
      .update(workItems)
      .set({ status: newStatus, completedAt, updatedAt: new Date() })
      .where(eq(workItems.id, taskId))
      .returning();
    await tx
      .insert(workItemStatusHistory)
      .values(buildStatusHistoryInsert(taskId, current.status, newStatus, actorId, opts.reason));
    return row;
  });

  // Audit is a post-commit side effect — error-isolated so a failed audit
  // never surfaces after the status change already committed.
  try {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.status_change",
      changesJson: { from: current.status, to: newStatus },
    });
  } catch (err) {
    logApiError("engineering.task.status_change.side_effects", err);
  }
  return updated;
}

/**
 * Reassign a task's owner. Updates `work_items.ownerUserId`, swaps the OWNER
 * assignment row, records an audit event, and notifies the new owner. Pass
 * `ownerUserId = null` to unassign. Returns null when the task isn't found.
 */
export async function reassignEngineeringTaskOwner(
  taskId: number,
  ownerUserId: number | null,
  actorId: number,
): Promise<WorkItemRow | null> {
  const current = await getEngineeringTask(taskId);
  if (!current) return null;
  if (current.ownerUserId === ownerUserId) return current;

  const [updated] = await db
    .update(workItems)
    .set({ ownerUserId, updatedAt: new Date() })
    .where(eq(workItems.id, taskId))
    .returning();

  // Swap the OWNER assignment row so the assignment table stays consistent.
  await db
    .delete(workItemAssignments)
    .where(and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.role, "OWNER")));
  if (ownerUserId != null) await assignOwner(taskId, ownerUserId);

  // Error-isolated post-commit side effect (audit only — a failed audit must
  // not surface after the owner change already committed).
  try {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.owner_change",
      changesJson: { from: current.ownerUserId ?? null, to: ownerUserId },
    });
  } catch (err) {
    logApiError("engineering.task.owner_change.side_effects", err);
  }
  return updated;
}

/**
 * Soft-delete a task (set deletedAt) and cascade the soft-delete to its direct
 * subtasks so nothing is orphaned. SharePoint documents are NOT touched — only
 * the task's link/metadata. Returns false when the task isn't found (or is
 * already deleted). Records an audit event.
 */
export async function softDeleteEngineeringTask(
  taskId: number,
  actorId: number,
): Promise<boolean> {
  const current = await getEngineeringTask(taskId);
  if (!current) return false;
  const now = new Date();
  // Atomic: cascade to direct subtasks AND the task itself commit together so a
  // mid-write failure can't leave a half-deleted tree (orphaned subtasks).
  await runInTransaction(async (tx) => {
    await tx
      .update(workItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(workItems.parentId, taskId), isNull(workItems.deletedAt)));
    await tx
      .update(workItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(workItems.id, taskId));
  });
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.deleted",
    changesJson: { title: current.title, projectId: current.projectId ?? null },
  });
  return true;
}

// ── Document links ────────────────────────────────────────────────────────

export async function listTaskDocumentLinks(taskId: number): Promise<WorkItemDocumentLinkRow[]> {
  return db
    .select()
    .from(workItemDocumentLinks)
    .where(eq(workItemDocumentLinks.workItemId, taskId))
    .orderBy(desc(workItemDocumentLinks.createdAt));
}

export interface DocumentCandidate {
  id: number;
  name: string;
  path: string;
}

/** Managed documents on the task's project, offered as link candidates for
 *  the Task Manager drawer picker (powers the Done-gate). */
export async function getDocumentCandidatesForTask(taskId: number): Promise<DocumentCandidate[]> {
  const task = await getEngineeringTask(taskId);
  if (!task || task.projectId == null) return [];
  const docs = await listManagedDocumentsByProject(task.projectId);
  return docs.map((d) => ({ id: d.id, name: d.name, path: d.path }));
}

const DOCUMENT_PROJECT_MISMATCH = (message: string): ApiError =>
  new ApiError(400, "DOCUMENT_PROJECT_MISMATCH", message);

export async function linkDocumentToTask(
  taskId: number,
  input: { managedDocumentId?: number | null; projectDocumentLinkId?: number | null; linkRole?: string },
  actorId: number,
): Promise<WorkItemDocumentLinkRow | null> {
  const task = await getEngineeringTask(taskId);
  if (!task) throw notFound("Task");

  // Project-scope guard (Batch 1): a linked document/link must belong to the
  // task's own project. Without this a document from another project could
  // satisfy the Done-gate. Enforced here (single chokepoint) so no caller can
  // bypass it. Coded ApiError so the client can surface a targeted message.
  if (task.projectId == null) {
    throw DOCUMENT_PROJECT_MISMATCH("Assign the task to a project before linking a document.");
  }
  if (input.managedDocumentId != null) {
    const doc = await getManagedDocumentById(input.managedDocumentId);
    if (!doc || doc.projectId !== task.projectId) {
      throw DOCUMENT_PROJECT_MISMATCH("That document isn't available on this task's project.");
    }
  }
  if (input.projectDocumentLinkId != null) {
    const link = await getProjectDocumentLink(task.projectId, input.projectDocumentLinkId);
    if (!link) {
      throw DOCUMENT_PROJECT_MISMATCH("That document link isn't available on this task's project.");
    }
  }

  const rows = await db
    .insert(workItemDocumentLinks)
    .values({
      workItemId: taskId,
      managedDocumentId: input.managedDocumentId ?? null,
      projectDocumentLinkId: input.projectDocumentLinkId ?? null,
      linkRole: input.linkRole ?? "output",
      createdByUserId: actorId,
    })
    .onConflictDoNothing()
    .returning();
  // Bare onConflictDoNothing() covers BOTH unique targets — (workItemId,
  // managedDocumentId) and the partial (workItemId, projectDocumentLinkId)
  // index. An empty result means this document is already linked to the task
  // — signal the route to return 409, not a duplicate row (or 500).
  if (rows.length === 0) return null;
  const row = rows[0];
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
// Seam routing lives in ./engineering-seam-repository (extracted for the
// EE-QA-015 file-size ratchet). Re-exported so callers importing the tasks-repo
// namespace (e.g. the seam route) are unaffected.
export { createSeamHandoff } from "./engineering-seam-repository";

// ── Subtasks (reuse work_items.parentId) ─────────────────────────────────────

export interface SubtaskListItem {
  id: number;
  title: string;
  status: string;
  ownerUserId: number | null;
  ownerName: string | null;
  endDate: string | null;
}

export async function listSubtasks(parentId: number): Promise<SubtaskListItem[]> {
  const rows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      status: workItems.status,
      ownerUserId: workItems.ownerUserId,
      ownerName: users.name,
      endDate: workItems.endDate,
    })
    .from(workItems)
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .where(and(eq(workItems.parentId, parentId), isNull(workItems.deletedAt)))
    .orderBy(asc(workItems.sortOrder), asc(workItems.id));
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    ownerUserId: r.ownerUserId ?? null,
    ownerName: r.ownerName ?? null,
    endDate: r.endDate ?? null,
  }));
}

/**
 * Create a child ENG work item under `parentId` (subtask). Inherits projectId
 * from the parent; status defaults to 'not_started'. Returns the new id.
 */
export async function createSubtask(parentId: number, title: string, actorId: number): Promise<{ id: number }> {
  const parent = await getEngineeringTask(parentId);
  if (!parent) throw notFound("Task");
  const [row] = await db
    .insert(workItems)
    .values({
      workstream: "ENG",
      source: "UI",
      title: title.trim(),
      status: "not_started",
      projectId: parent.projectId ?? null,
      parentId,
      createdBy: actorId,
    })
    .returning({ id: workItems.id });
  await db.insert(workItemStatusHistory).values(buildStatusHistoryInsert(row.id, null, "not_started", actorId, "subtask created"));
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(row.id),
    action: "engineering.task.subtask_create",
    changesJson: { parentId },
  });
  return { id: row.id };
}

// ── Checklists (reuse task_checklists + task_checklist_items) ─────────────────

export interface ChecklistItemOut {
  id: number;
  content: string;
  isDone: boolean;
  sortOrder: number;
}
export interface ChecklistOut {
  id: number;
  title: string;
  sortOrder: number;
  items: ChecklistItemOut[];
}

export async function listChecklists(taskId: number): Promise<ChecklistOut[]> {
  const lists = await db
    .select()
    .from(taskChecklists)
    .where(eq(taskChecklists.workItemId, taskId))
    .orderBy(asc(taskChecklists.sortOrder), asc(taskChecklists.id));
  if (lists.length === 0) return [];
  const listIds = lists.map((l: (typeof lists)[number]) => l.id);
  const items = await db
    .select()
    .from(taskChecklistItems)
    .where(inArray(taskChecklistItems.checklistId, listIds))
    .orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.id));
  const byList = new Map<number, ChecklistItemOut[]>();
  for (const it of items) {
    const arr = byList.get(it.checklistId) ?? [];
    arr.push({ id: it.id, content: it.content, isDone: it.isDone, sortOrder: it.sortOrder });
    byList.set(it.checklistId, arr);
  }
  return lists.map((l: (typeof lists)[number]) => ({
    id: l.id,
    title: l.title,
    sortOrder: l.sortOrder,
    items: byList.get(l.id) ?? [],
  }));
}

export async function createChecklist(taskId: number, title: string): Promise<{ id: number }> {
  const [maxRow] = await db
    .select({ m: count() })
    .from(taskChecklists)
    .where(eq(taskChecklists.workItemId, taskId));
  const [row] = await db
    .insert(taskChecklists)
    .values({ workItemId: taskId, title: title.trim(), sortOrder: Number(maxRow?.m ?? 0) })
    .returning({ id: taskChecklists.id });
  return { id: row.id };
}

/** Confirm a checklist belongs to the given task (404 otherwise). */
async function assertChecklistOnTask(taskId: number, checklistId: number): Promise<void> {
  const [row] = await db
    .select({ id: taskChecklists.id })
    .from(taskChecklists)
    .where(and(eq(taskChecklists.id, checklistId), eq(taskChecklists.workItemId, taskId)))
    .limit(1);
  if (!row) throw notFound("Checklist");
}

export async function deleteChecklist(taskId: number, checklistId: number): Promise<void> {
  await assertChecklistOnTask(taskId, checklistId);
  // task_checklist_items cascades on checklist delete.
  await db.delete(taskChecklists).where(eq(taskChecklists.id, checklistId));
}

export async function addChecklistItem(taskId: number, checklistId: number, content: string): Promise<{ id: number }> {
  await assertChecklistOnTask(taskId, checklistId);
  const [maxRow] = await db
    .select({ m: count() })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.checklistId, checklistId));
  const [row] = await db
    .insert(taskChecklistItems)
    .values({ checklistId, content: content.trim(), sortOrder: Number(maxRow?.m ?? 0) })
    .returning({ id: taskChecklistItems.id });
  return { id: row.id };
}

/** Confirm a checklist item hangs off a checklist that belongs to the task. */
async function assertChecklistItemOnTask(taskId: number, itemId: number): Promise<void> {
  const [row] = await db
    .select({ id: taskChecklistItems.id })
    .from(taskChecklistItems)
    .innerJoin(taskChecklists, eq(taskChecklists.id, taskChecklistItems.checklistId))
    .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklists.workItemId, taskId)))
    .limit(1);
  if (!row) throw notFound("Checklist item");
}

export async function updateChecklistItem(
  taskId: number,
  itemId: number,
  patch: { isDone?: boolean; content?: string },
): Promise<void> {
  await assertChecklistItemOnTask(taskId, itemId);
  const set: { isDone?: boolean; content?: string } = {};
  if (patch.isDone !== undefined) set.isDone = patch.isDone;
  if (patch.content !== undefined) set.content = patch.content.trim();
  if (Object.keys(set).length === 0) return;
  await db.update(taskChecklistItems).set(set).where(eq(taskChecklistItems.id, itemId));
}

export async function deleteChecklistItem(taskId: number, itemId: number): Promise<void> {
  await assertChecklistItemOnTask(taskId, itemId);
  await db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, itemId));
}

// ── Comments + @mentions (reuse task_comments + task_comment_mentions) ────────

export interface CommentOut {
  id: number;
  body: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: Date;
  mentions: { userId: number; name: string | null }[];
}

export async function listComments(taskId: number): Promise<CommentOut[]> {
  const rows = await db
    .select({
      id: taskComments.id,
      body: taskComments.body,
      authorId: taskComments.authorId,
      authorName: users.name,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(eq(taskComments.workItemId, taskId))
    .orderBy(asc(taskComments.createdAt));
  if (rows.length === 0) return [];

  const commentIds = rows.map((r: (typeof rows)[number]) => r.id);
  const mentionRows = await db
    .select({
      commentId: taskCommentMentions.commentId,
      userId: taskCommentMentions.mentionedUserId,
      name: users.name,
    })
    .from(taskCommentMentions)
    .leftJoin(users, eq(users.id, taskCommentMentions.mentionedUserId))
    .where(inArray(taskCommentMentions.commentId, commentIds));
  const byComment = new Map<number, { userId: number; name: string | null }[]>();
  for (const m of mentionRows) {
    const arr = byComment.get(m.commentId) ?? [];
    arr.push({ userId: m.userId, name: m.name ?? null });
    byComment.set(m.commentId, arr);
  }

  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    body: r.body,
    authorId: r.authorId ?? null,
    authorName: r.authorName ?? null,
    createdAt: r.createdAt,
    mentions: byComment.get(r.id) ?? [],
  }));
}

/**
 * Insert a comment, persist @mention rows, and notify each mentioned user
 * (other than the author) through the canonical notification service.
 */
export async function createComment(
  taskId: number,
  body: string,
  mentionedUserIds: number[],
  actorId: number,
): Promise<{ id: number }> {
  const task = await getEngineeringTask(taskId);
  if (!task) throw notFound("Task");

  const [comment] = await db
    .insert(taskComments)
    .values({ workItemId: taskId, authorId: actorId, body: body.trim() })
    .returning({ id: taskComments.id });

  // De-dupe, drop the author, and keep only real users on this row's mentions.
  const uniqueMentions = Array.from(new Set(mentionedUserIds)).filter((uid) => uid > 0);
  if (uniqueMentions.length > 0) {
    await db
      .insert(taskCommentMentions)
      .values(uniqueMentions.map((uid) => ({ commentId: comment.id, mentionedUserId: uid })))
      .onConflictDoNothing();
  }

  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.comment_create",
    changesJson: { commentId: comment.id, mentions: uniqueMentions },
  });
  return { id: comment.id };
}

// ── Assignees (reuse work_item_assignments; OWNER stays work_items.ownerUserId)

export interface AssigneeOut {
  userId: number;
  name: string | null;
  role: string;
}

export async function listAssignees(taskId: number): Promise<AssigneeOut[]> {
  const rows = await db
    .select({ userId: workItemAssignments.userId, name: users.name, role: workItemAssignments.role })
    .from(workItemAssignments)
    .leftJoin(users, eq(users.id, workItemAssignments.userId))
    .where(eq(workItemAssignments.workItemId, taskId))
    .orderBy(asc(workItemAssignments.id));
  return rows.map((r: (typeof rows)[number]) => ({ userId: r.userId, name: r.name ?? null, role: r.role }));
}

export async function addAssignee(
  taskId: number,
  userId: number,
  role: "ASSIGNEE" | "REVIEWER" | "VIEWER",
  actorId: number,
): Promise<void> {
  const task = await getEngineeringTask(taskId);
  if (!task) throw notFound("Task");
  await db
    .insert(workItemAssignments)
    .values({ workItemId: taskId, userId, role })
    .onConflictDoNothing();
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.assignee_add",
    changesJson: { userId, role },
  });
}

/** Remove a non-owner assignment. The OWNER row is managed via the owner PATCH. */
export async function removeAssignee(taskId: number, userId: number, actorId: number): Promise<boolean> {
  const deleted = await db
    .delete(workItemAssignments)
    .where(
      and(
        eq(workItemAssignments.workItemId, taskId),
        eq(workItemAssignments.userId, userId),
        ne(workItemAssignments.role, "OWNER"),
      ),
    )
    .returning({ id: workItemAssignments.id });
  if (deleted.length > 0) {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.assignee_remove",
      changesJson: { userId },
    });
  }
  return deleted.length > 0;
}

// ── Dependencies (reuse work_item_dependencies; FS only; same project) ────────

export interface DependencyOut {
  depId: number;
  taskId: number;
  title: string;
  status: string;
  kind: "task" | "plan";
}

/** A work_items row reads as a "plan" line when it's a milestone, links to a
 *  plan item, or sits in the PM workstream; otherwise it's a "task". */
function classifyKind(row: { isMilestone: boolean | null; linkedPlanItemId: number | null; workstream: string }): "task" | "plan" {
  if (row.isMilestone || row.linkedPlanItemId != null || row.workstream === "PM") return "plan";
  return "task";
}

export async function listDependencies(taskId: number): Promise<{ blockedBy: DependencyOut[]; blocks: DependencyOut[] }> {
  const rows = await db
    .select({
      depId: workItemDependencies.id,
      predecessorId: workItemDependencies.predecessorId,
      successorId: workItemDependencies.successorId,
    })
    .from(workItemDependencies)
    .where(
      and(
        isNull(workItemDependencies.deletedAt),
        or(eq(workItemDependencies.successorId, taskId), eq(workItemDependencies.predecessorId, taskId)),
      ),
    );
  if (rows.length === 0) return { blockedBy: [], blocks: [] };

  const otherIds = Array.from(
    new Set<number>(rows.map((r: (typeof rows)[number]) => (r.successorId === taskId ? r.predecessorId : r.successorId))),
  );
  const itemRows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      status: workItems.status,
      isMilestone: workItems.isMilestone,
      linkedPlanItemId: workItems.linkedPlanItemId,
      workstream: workItems.workstream,
    })
    .from(workItems)
    .where(inArray(workItems.id, otherIds));
  const itemMap = new Map<number, (typeof itemRows)[number]>();
  for (const it of itemRows) itemMap.set(it.id, it);

  const blockedBy: DependencyOut[] = [];
  const blocks: DependencyOut[] = [];
  for (const r of rows) {
    const otherId = r.successorId === taskId ? r.predecessorId : r.successorId;
    const item = itemMap.get(otherId);
    if (!item) continue;
    const dep: DependencyOut = {
      depId: r.depId,
      taskId: item.id,
      title: item.title,
      status: item.status,
      kind: classifyKind(item),
    };
    if (r.successorId === taskId) blockedBy.push(dep);
    else blocks.push(dep);
  }
  return { blockedBy, blocks };
}

export interface DependencyCandidate {
  id: number;
  title: string;
  kind: "task" | "plan";
  status: string;
}

/**
 * Other Engineering/plan work_items on the same project that this task may
 * depend on. Excludes self, the parent, this task's subtasks, already-linked
 * rows, and rows that would form an immediate cycle (already a successor).
 */
export async function listDependencyCandidates(taskId: number): Promise<DependencyCandidate[]> {
  const task = await getEngineeringTask(taskId);
  if (!task || task.projectId == null) return [];

  // Rows already linked in either direction (active links only).
  const links = await db
    .select({ predecessorId: workItemDependencies.predecessorId, successorId: workItemDependencies.successorId })
    .from(workItemDependencies)
    .where(
      and(
        isNull(workItemDependencies.deletedAt),
        or(eq(workItemDependencies.successorId, taskId), eq(workItemDependencies.predecessorId, taskId)),
      ),
    );
  const linked = new Set<number>();
  for (const l of links) {
    linked.add(l.predecessorId === taskId ? l.successorId : l.predecessorId);
  }

  // Subtasks of this task (children) — excluded.
  const children = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.parentId, taskId), isNull(workItems.deletedAt)));
  const excluded = new Set<number>([taskId, ...linked, ...children.map((c: (typeof children)[number]) => c.id)]);
  if (task.parentId != null) excluded.add(task.parentId);

  const rows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      status: workItems.status,
      isMilestone: workItems.isMilestone,
      linkedPlanItemId: workItems.linkedPlanItemId,
      workstream: workItems.workstream,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, task.projectId),
        isNull(workItems.deletedAt),
        inArray(workItems.workstream, ["ENG", "PM"]),
      ),
    )
    .orderBy(asc(workItems.title));

  return rows
    .filter((r: (typeof rows)[number]) => !excluded.has(r.id))
    .map((r: (typeof rows)[number]) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      kind: classifyKind(r),
    }));
}

// ── Plan link (derive an engineering task's due date from a plan task) ────────

export interface PlanCandidate {
  id: number;
  title: string;
  kind: "task" | "plan";
  status: string;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Plan-kind work_items on the same project this task can link to (so its due
 * date derives from the plan task's date). Reuses the `classifyKind` / same
 * query shape as `listDependencyCandidates`, but returns only plan-kind rows,
 * excludes self, and includes start/end dates so the client can preview the
 * derived due date before committing.
 */
export async function listPlanCandidates(taskId: number): Promise<PlanCandidate[]> {
  const task = await getEngineeringTask(taskId);
  if (!task || task.projectId == null) return [];

  const rows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      status: workItems.status,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      isMilestone: workItems.isMilestone,
      linkedPlanItemId: workItems.linkedPlanItemId,
      workstream: workItems.workstream,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, task.projectId),
        isNull(workItems.deletedAt),
        inArray(workItems.workstream, ["ENG", "PM"]),
      ),
    )
    .orderBy(asc(workItems.title));

  return rows
    .filter((r: (typeof rows)[number]) => r.id !== taskId && isPlanKind(r))
    .map((r: (typeof rows)[number]) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
      kind: classifyKind(r),
    }));
}

/**
 * Set, change, or clear an engineering task's project-plan link.
 *   - `planItemId = null` clears the link (planLinkItemId/relation/leadDays) and
 *     leaves the persisted endDate as-is.
 *   - Otherwise the plan item must be a plan-kind work_item on the SAME project
 *     (not self) — rejected with badRequest otherwise. The link is persisted and
 *     `endDate` is set to the derived due date (or left as-is when the needed
 *     plan date is missing / derivedDue is null). Read paths re-derive endDate so
 *     it stays synced if the plan task's date later moves.
 */
export async function setPlanLink(
  taskId: number,
  input: { planItemId: number | null; relation?: PlanLinkRelation; leadDays?: number },
  actorId: number,
): Promise<EngineeringTaskDetail | null> {
  const task = await getEngineeringTask(taskId);
  if (!task) return null;

  if (input.planItemId == null) {
    await db
      .update(workItems)
      .set({ planLinkItemId: null, planLinkRelation: null, planLinkLeadDays: null, updatedAt: new Date() })
      .where(eq(workItems.id, taskId));
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.plan_link_clear",
      changesJson: { previousPlanItemId: task.planLinkItemId ?? null },
    });
    return getEngineeringTaskDetail(taskId);
  }

  if (input.planItemId === taskId) throw badRequest("A task can't link to itself.");
  const relation: PlanLinkRelation = input.relation ?? "after";
  const leadDays = input.leadDays ?? 5;

  const [plan] = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      isMilestone: workItems.isMilestone,
      linkedPlanItemId: workItems.linkedPlanItemId,
      workstream: workItems.workstream,
    })
    .from(workItems)
    .where(and(eq(workItems.id, input.planItemId), isNull(workItems.deletedAt)))
    .limit(1);
  if (!plan) throw notFound("Plan task");
  if (task.projectId == null || plan.projectId !== task.projectId) {
    throw badRequest("The plan task must be on the same project.");
  }
  if (!isPlanKind(plan)) throw badRequest("That work item isn't a project-plan task.");

  const derived = derivePlanLink({
    relation,
    leadDays,
    planStart: plan.startDate ?? null,
    planEnd: plan.endDate ?? null,
    taskStatus: task.status,
  });

  const set: Partial<typeof workItems.$inferInsert> = {
    planLinkItemId: input.planItemId,
    planLinkRelation: relation,
    planLinkLeadDays: leadDays,
    updatedAt: new Date(),
  };
  // Persist the synced due date when derivable; leave endDate untouched when the
  // plan task has no usable date (read paths still show "no date" for it).
  if (derived.derivedDue != null) set.endDate = derived.derivedDue;
  await db.update(workItems).set(set).where(eq(workItems.id, taskId));

  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.plan_link_set",
    changesJson: { planItemId: input.planItemId, relation, leadDays, derivedDue: derived.derivedDue },
  });
  return getEngineeringTaskDetail(taskId);
}

/** Tasks that block `taskId` (its blockedBy predecessors) that are not yet
 *  complete — drives the complete-guard. */
async function getIncompleteBlockers(taskId: number): Promise<{ id: number; title: string }[]> {
  const rows = await db
    .select({ id: workItems.id, title: workItems.title, status: workItems.status })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItems.id, workItemDependencies.predecessorId))
    .where(
      and(
        eq(workItemDependencies.successorId, taskId),
        isNull(workItemDependencies.deletedAt),
        isNull(workItems.deletedAt),
      ),
    );
  return rows
    .filter((r: (typeof rows)[number]) => !isTaskComplete(r.status))
    .map((r: (typeof rows)[number]) => ({ id: r.id, title: r.title }));
}

/**
 * Create a 'FS' dependency: `dependsOnTaskId` (predecessor) blocks `taskId`
 * (successor). Rejects self-links, duplicates, and a direct cycle (the
 * dependency already exists in the opposite direction).
 */
export async function addDependency(taskId: number, dependsOnTaskId: number, actorId: number): Promise<{ id: number }> {
  if (taskId === dependsOnTaskId) throw badRequest("A task can't depend on itself.");
  const task = await getEngineeringTask(taskId);
  if (!task) throw notFound("Task");
  const [dependsOn] = await db
    .select({ id: workItems.id, projectId: workItems.projectId })
    .from(workItems)
    .where(and(eq(workItems.id, dependsOnTaskId), isNull(workItems.deletedAt)))
    .limit(1);
  if (!dependsOn) throw notFound("Dependency task");
  if (task.projectId != null && dependsOn.projectId !== task.projectId) {
    throw badRequest("Dependencies must be on the same project.");
  }

  const existing = await db
    .select({ predecessorId: workItemDependencies.predecessorId, successorId: workItemDependencies.successorId })
    .from(workItemDependencies)
    .where(
      and(
        isNull(workItemDependencies.deletedAt),
        or(
          and(eq(workItemDependencies.predecessorId, dependsOnTaskId), eq(workItemDependencies.successorId, taskId)),
          and(eq(workItemDependencies.predecessorId, taskId), eq(workItemDependencies.successorId, dependsOnTaskId)),
        ),
      ),
    );
  for (const e of existing) {
    if (e.predecessorId === dependsOnTaskId && e.successorId === taskId) {
      throw badRequest("That dependency already exists.");
    }
    // Opposite direction already linked → adding this would create a direct cycle.
    throw badRequest("That would create a circular dependency.");
  }

  const [row] = await db
    .insert(workItemDependencies)
    .values({ predecessorId: dependsOnTaskId, successorId: taskId, depType: "FS", source: "MANUAL" })
    .returning({ id: workItemDependencies.id });
  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.dependency_add",
    changesJson: { dependsOnTaskId, depId: row.id },
  });
  return { id: row.id };
}

export async function removeDependency(taskId: number, depId: number, actorId: number): Promise<boolean> {
  // Soft-delete (the table carries deletedAt). Only allow removing a row that
  // touches this task in either direction.
  const updated = await db
    .update(workItemDependencies)
    .set({ deletedAt: new Date(), deletedBy: actorId })
    .where(
      and(
        eq(workItemDependencies.id, depId),
        isNull(workItemDependencies.deletedAt),
        or(eq(workItemDependencies.successorId, taskId), eq(workItemDependencies.predecessorId, taskId)),
      ),
    )
    .returning({ id: workItemDependencies.id });
  if (updated.length > 0) {
    await recordAudit({
      userId: actorId,
      entityType: "work_item",
      entityId: String(taskId),
      action: "engineering.task.dependency_remove",
      changesJson: { depId },
    });
  }
  return updated.length > 0;
}

// ── Sign-off (reuse approvals; durable approver + timestamp) ──────────────────

export interface SignOffOut {
  id: number;
  kind: string;
  decision: string;
  decidedByName: string | null;
  decidedAt: Date | null;
  note: string | null;
}

const SIGN_OFF_PREFIX = "engineering_task_";
const SIGN_OFF_SUFFIX = "_sign_off";

export async function listSignOffs(taskId: number): Promise<SignOffOut[]> {
  const rows = await db
    .select({
      id: approvals.id,
      approvalType: approvals.approvalType,
      status: approvals.status,
      decidedByName: users.name,
      decidedAt: approvals.decidedAt,
      decisionNote: approvals.decisionNote,
    })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.decidedBy))
    .where(
      and(
        eq(approvals.relatedEntityType, "work_item"),
        eq(approvals.relatedEntityId, taskId),
        isNull(approvals.deletedAt),
      ),
    )
    .orderBy(desc(approvals.id));
  return rows
    .filter(
      (r: (typeof rows)[number]) =>
        r.approvalType != null && r.approvalType.startsWith(SIGN_OFF_PREFIX) && r.approvalType.endsWith(SIGN_OFF_SUFFIX),
    )
    .map((r: (typeof rows)[number]) => ({
      id: r.id,
      kind: r.approvalType!.slice(SIGN_OFF_PREFIX.length, r.approvalType!.length - SIGN_OFF_SUFFIX.length),
      decision: r.status,
      decidedByName: r.decidedByName ?? null,
      decidedAt: r.decidedAt ?? null,
      note: r.decisionNote ?? null,
    }));
}

/**
 * Record a sign-off decision: transition the task status per the contract (QC
 * approve → `qc_approved`, operational approve → `complete`, reject →
 * `provide_feedback`), then record the decision against the `approvals` table
 * and post a summary comment. The transition runs FIRST, through the workflow
 * chokepoint with the `approval_action` source, so the deliverable/document
 * Done-gates and the dependency complete-guard still apply and an illegal
 * sign-off is rejected before any approval row is written.
 */
export async function recordSignOff(
  taskId: number,
  decision: "approved" | "rejected",
  kind: "qc" | "operational",
  note: string | undefined,
  actorId: number,
): Promise<{ id: number }> {
  const task = await getEngineeringTask(taskId);
  if (!task) throw notFound("Task");
  if (task.projectId == null) throw badRequest("Sign-off requires the task to belong to a project.");

  // Resolve the target status per the sign-off contract.
  let targetStatus: string | null = null;
  if (decision === "rejected") {
    targetStatus = "provide_feedback";
  } else if (kind === "qc") {
    targetStatus = "qc_approved";
  } else {
    targetStatus = "complete";
  }

  // Apply the guard-gated transition FIRST. A sign-off IS an approval action,
  // so it uses the `approval_action` source (exempt from the "use Send for
  // Approval" gate and the complete gate) — while the deliverable/document
  // Done-gates and the dependency complete-guard still apply. Running it before
  // any approval / comment / audit row is written means an illegal sign-off is
  // rejected cleanly, leaving no orphaned sign-off record behind.
  if (targetStatus && targetStatus !== task.status) {
    await transitionEngineeringTaskStatus(taskId, targetStatus, actorId, {
      source: "approval_action",
      reason: `${kind} sign-off ${decision}`,
    });
  }

  const now = new Date();
  const approvalType = `${SIGN_OFF_PREFIX}${kind}${SIGN_OFF_SUFFIX}`;
  const [row] = await db
    .insert(approvals)
    .values({
      type: approvalType,
      title: `Engineering ${kind} sign-off: ${task.title}`,
      status: decision,
      requestedBy: actorId,
      decidedBy: actorId,
      decidedAt: now,
      decisionNote: note ?? null,
      relatedEntityType: "work_item",
      relatedEntityId: taskId,
      approvalType,
      projectId: task.projectId,
    })
    .returning({ id: approvals.id });

  // Summary comment (reuse the comment surface — no mentions/notifications).
  await db.insert(taskComments).values({
    workItemId: taskId,
    authorId: actorId,
    body: `${kind === "qc" ? "QC" : "Operational"} sign-off: ${decision}${note ? ` — ${note}` : ""}.`,
  });

  await recordAudit({
    userId: actorId,
    entityType: "work_item",
    entityId: String(taskId),
    action: "engineering.task.sign_off",
    changesJson: { kind, decision, approvalId: row.id, targetStatus },
  });
  return { id: row.id };
}
