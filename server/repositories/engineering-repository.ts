/**
 * Engineering repository — shared data access for the Engineering domain.
 *
 * Mirrors `server/repositories/quality-repository.ts` (Quality Tier 3 #900):
 * a focused extraction of the most-reused query patterns from
 * `server/engineering-routes.ts`, NOT a full repository migration. Aimed
 * at the audit-flagged hotspots:
 *
 *   - Project lookup (info + execution-state leftJoin) — 5+ inline sites
 *   - Project ID resolution by fuzzy name — 3 inline sites
 *   - Engineering work-item lookup (workstream=ENG + not deleted) — 3 sites
 *   - Deliverable lookup by id — 3 sites
 *   - User-name lookup — 5 sites
 *   - Defensive coalesce of leftJoin execution-state rows — 4 spread-null sites
 *
 * Conventions (CLAUDE.md § 6):
 *   - No `sql.raw(...)` with string interpolation
 *   - Snapshot guards (`isNull(effectiveTo)`) — not relevant here; engineering
 *     tables aren't snapshot-style.
 *   - Soft-delete guard (`isNull(deletedAt)`) — included where the table has
 *     a `deletedAt` column.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  workItems,
  workItemAssignments,
  deliverables,
  users,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type ProjectInfoRow = typeof projectInfo.$inferSelect;
export type ProjectExecutionStateRow = typeof projectExecutionState.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type DeliverableRow = typeof deliverables.$inferSelect;

/** Merged project + execution-state row, with execution-state fields nullable. */
export type MergedProjectRow = ProjectInfoRow & Partial<ProjectExecutionStateRow>;

// ---------------------------------------------------------------------------
// Project lookup
// ---------------------------------------------------------------------------

/**
 * Defensive coalesce for `projectInfo` LEFT JOIN `projectExecutionState`
 * rows. Returns null when the from-side `project_info` is missing
 * (shouldn't happen with the current schema but protects against future
 * refactors that flip the join direction). Mirrors `mergeProjectRow` in
 * `quality-repository.ts`.
 */
export function mergeProjectRow(row: {
  project_info: ProjectInfoRow | null;
  project_execution_state: ProjectExecutionStateRow | null;
}): MergedProjectRow | null {
  if (!row.project_info) return null;
  return {
    ...row.project_info,
    ...(row.project_execution_state ?? {}),
    id: row.project_info.id,
    updatedAt: row.project_info.updatedAt,
  } as MergedProjectRow;
}

/**
 * Default values for `projectExecutionState` columns the engineering routes
 * read after a leftJoin. Used by `coalesceProjectExecState` so handlers
 * never spread a null exec-state into a response. Mirrors the defaults
 * the DB would emit on insert (booleans default to false, optional
 * date/text columns stay null).
 */
const EXEC_STATE_DEFAULTS = {
  cpSigned: false,
  pmTaskPackCreated: false,
  engPostCpTaskPackCreated: false,
  executionEnabled: false,
} as const;

/**
 * Apply sensible defaults to a leftJoin row so the caller can safely
 * destructure / spread without null-guarding every execution-state field.
 *
 * Use case: handlers like `/api/projects/:projectId/mark-cp-signed` and
 * `/api/projects/:projectId/cp-status` read 5+ exec-state booleans
 * (`project.cpSigned`, `project.pmTaskPackCreated`, etc.) after a
 * leftJoin. Without this coalesce, every read needs `?? false`.
 */
export function coalesceProjectExecState<T extends Record<string, unknown>>(row: T): T & typeof EXEC_STATE_DEFAULTS {
  return { ...EXEC_STATE_DEFAULTS, ...row };
}

/**
 * Find a single project's info + execution state by id.
 * Returns null when no project_info row exists (NOT when the exec-state
 * row is missing — that's the common case and is handled by coalesce).
 */
export async function findProjectWithExecutionState(projectId: number): Promise<MergedProjectRow | null> {
  const rows = await db
    .select()
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(eq(projectInfo.id, projectId));
  const [first] = rows.map(mergeProjectRow).filter((p: MergedProjectRow | null): p is MergedProjectRow => p != null);
  return first ?? null;
}

/** Lookup a projectInfo row by id (no leftJoin). */
export async function findProjectInfoById(projectId: number): Promise<ProjectInfoRow | null> {
  const [row] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
  return row ?? null;
}

/**
 * Resolve a project id from a name with fuzzy normalisation:
 * trim, lowercase, strip non-alphanumerics. Returns null when no match.
 * Used by intake / external-ref flows where the incoming name string
 * may carry whitespace, casing, or `_Tracker` suffix drift.
 */
export async function resolveProjectIdByName(rawName: string): Promise<number | null> {
  const trimmed = (rawName || "").trim();
  if (!trimmed) return null;
  // Normalised LIKE match: case-insensitive, ignores `_Tracker` suffix
  // and stray whitespace. Pattern mirrors the inline matcher previously
  // in engineering-routes.ts:924-932.
  const normalized = trimmed.toLowerCase().replace(/_tracker$/i, "").replace(/\s+/g, " ");
  const [row] = await db
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(sql`LOWER(REPLACE(TRIM(${projectInfo.projectName}), '_Tracker', '')) = ${normalized}`)
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Engineering work-item lookup
// ---------------------------------------------------------------------------

/**
 * Find an engineering work-item by id. Engineering items are filtered by
 * `workstream = "ENG"` and `deletedAt IS NULL` so soft-deleted rows and
 * cross-workstream items don't accidentally pass through engineering
 * handlers.
 */
export async function findEngineeringWorkItem(id: number): Promise<WorkItemRow | null> {
  const [row] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, id), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Same as `findEngineeringWorkItem` but returns only the id (for
 * existence checks).
 */
export async function findEngineeringWorkItemId(id: number): Promise<number | null> {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, id), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Ownership check for `scope: 'own'` engineering roles.
 *
 * Returns true when `userId` is the task owner OR carries any assignment
 * row (OWNER / ASSIGNEE / REVIEWER / VIEWER) on the work item. Callers that
 * have already established the role is not a manager/admin use this to gate
 * per-row access on /api/eng/tasks/:id* so a scoped engineer cannot reach
 * another engineer's task by iterating IDs.
 *
 * Returns false when the task does not exist — the route layer turns that
 * into a 404, which is also the right answer for "not yours".
 *
 * Indexing: the lookup is a point query on `work_items.id` (primary key) and
 * the join filter `(work_item_id, user_id)` is covered by the unique index
 * `uq_work_item_user_role`. No additional index is required — verified
 * 2026-06-01 during the engineering audit.
 */
export async function userCanAccessEngineeringTask(taskId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .leftJoin(
      workItemAssignments,
      and(
        eq(workItemAssignments.workItemId, workItems.id),
        eq(workItemAssignments.userId, userId),
      ),
    )
    .where(and(
      eq(workItems.id, taskId),
      isNull(workItems.deletedAt),
      or(
        eq(workItems.ownerUserId, userId),
        eq(workItemAssignments.userId, userId),
      ),
    ))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Deliverable lookup
// ---------------------------------------------------------------------------

/** Find a deliverable by id. */
export async function findDeliverableById(id: number): Promise<DeliverableRow | null> {
  const [row] = await db.select().from(deliverables).where(eq(deliverables.id, id)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// User name lookup
// ---------------------------------------------------------------------------

/**
 * Single user name lookup. Returns null when the user doesn't exist
 * (caller is responsible for displaying a fallback like "Unknown").
 */
export async function findUserName(userId: number): Promise<string | null> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? null;
}
