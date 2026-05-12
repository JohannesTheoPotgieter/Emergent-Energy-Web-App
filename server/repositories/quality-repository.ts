/**
 * Quality repository — shared data access for the Quality Management domain.
 *
 * Conventions (CLAUDE.md § 6):
 * - All NEW Quality DB access should go through this module rather than
 *   `db.select()` directly inside `quality-routes.ts` handlers.
 * - Legacy handlers in `server/quality-routes.ts` still issue inline
 *   `db.*` calls; that's tracked debt — see audit M1 in PR description.
 * - Snapshot-table queries are not present here today, but if they are
 *   added (e.g., joining a finance snapshot) they MUST carry the
 *   `isNull(effectiveTo)` guard from § 3.1.
 * - Use parameterised `sql\`\`` template — no `sql.raw(...)` with string
 *   interpolation.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  qcChecklist,
  qcItemEvidence,
  qcItemInstance,
  qcWarning,
  projectInfo,
  projectExecutionState,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type ProjectInfoRow = typeof projectInfo.$inferSelect;
export type ProjectExecutionStateRow = typeof projectExecutionState.$inferSelect;
export type QcChecklistRow = typeof qcChecklist.$inferSelect;
export type QcItemInstanceRow = typeof qcItemInstance.$inferSelect;
export type QcItemEvidenceRow = typeof qcItemEvidence.$inferSelect;

export type MergedProjectRow = ProjectInfoRow & Partial<ProjectExecutionStateRow>;

// ---------------------------------------------------------------------------
// Project + execution-state merge
// ---------------------------------------------------------------------------

/**
 * Coalesce a `projectInfo` row with its (possibly null) `projectExecutionState`
 * leftJoin row. Returns null when the project_info side is missing, which
 * shouldn't happen with the current FROM-side leftJoin but protects against
 * future schema changes.
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

/** Fetch every project with its (possibly null) execution state, defensively merged. */
export async function listProjectsWithExecutionState(): Promise<MergedProjectRow[]> {
  const rows = await db
    .select()
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));
  return rows.map(mergeProjectRow).filter((p: MergedProjectRow | null): p is MergedProjectRow => p != null);
}

/** Lookup a single project + execution state by exact project name. */
export async function findProjectWithExecutionState(
  projectName: string,
): Promise<MergedProjectRow | null> {
  const rows = await db
    .select()
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(eq(projectInfo.projectName, projectName));
  const [first] = rows.map(mergeProjectRow).filter((p: MergedProjectRow | null): p is MergedProjectRow => p != null);
  return first ?? null;
}

/** Lookup with case + whitespace-insensitive project-name matching. */
export async function findProjectByLooseName(
  projectName: string,
): Promise<MergedProjectRow | null> {
  const rows = await db
    .select()
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(sql`LOWER(TRIM(${projectInfo.projectName})) = LOWER(TRIM(${projectName}))`);
  const [first] = rows.map(mergeProjectRow).filter((p: MergedProjectRow | null): p is MergedProjectRow => p != null);
  return first ?? null;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

/** Find the active checklist for a project by exact name match. */
export async function findChecklistByProjectName(
  projectName: string,
): Promise<QcChecklistRow | null> {
  const [row] = await db
    .select()
    .from(qcChecklist)
    .where(eq(qcChecklist.projectName, projectName));
  return row ?? null;
}

/** Find a checklist by case + whitespace-insensitive project name. */
export async function findChecklistByLooseProjectName(
  projectName: string,
): Promise<QcChecklistRow | null> {
  const normalized = projectName.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(qcChecklist)
    .where(sql`LOWER(TRIM(${qcChecklist.projectName})) = ${normalized}`);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Item instance + evidence
// ---------------------------------------------------------------------------

/** Single quality-item instance by id. */
export async function findItemInstance(itemInstanceId: number): Promise<QcItemInstanceRow | null> {
  const [row] = await db
    .select()
    .from(qcItemInstance)
    .where(eq(qcItemInstance.id, itemInstanceId));
  return row ?? null;
}

/** All non-deleted evidence for a set of item-instance ids. */
export async function listEvidenceForItems(
  itemInstanceIds: number[],
): Promise<QcItemEvidenceRow[]> {
  if (itemInstanceIds.length === 0) return [];
  return db
    .select()
    .from(qcItemEvidence)
    .where(and(
      inArray(qcItemEvidence.itemInstanceId, itemInstanceIds),
      isNull(qcItemEvidence.deletedAt),
    ));
}

/**
 * Count non-deleted evidence per item-instance for a batch — returns a map
 * keyed by item-instance id with the row count as value.
 */
export async function countEvidencePerItem(
  itemInstanceIds: number[],
): Promise<Map<number, number>> {
  const evidence = await listEvidenceForItems(itemInstanceIds);
  const counts = new Map<number, number>();
  for (const row of evidence) {
    counts.set(row.itemInstanceId, (counts.get(row.itemInstanceId) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Active (non-resolved) warnings for a project. */
export async function listActiveWarningsForProject(projectName: string) {
  return db
    .select()
    .from(qcWarning)
    .where(and(
      eq(qcWarning.projectName, projectName),
      sql`${qcWarning.status} != 'resolved'`,
    ));
}

// ---------------------------------------------------------------------------
// PD/PM handover
// ---------------------------------------------------------------------------

/**
 * Fetch handover rows for a batch of project ids. The table is queried with
 * a parameterised IN-list; soft-fails to empty array if the query errors so
 * the caller can degrade gracefully (handover data is optional context for
 * the quality dashboard).
 */
export async function listHandoverRowsForProjects(projectIds: number[]): Promise<Array<{
  project_id: number;
  status: string | null;
  engineering_status: string | null;
  quality_status: string | null;
  rejection_reason: string | null;
}>> {
  if (projectIds.length === 0) return [];
  try {
    const result = await db.execute(sql`
      SELECT project_id, status, engineering_status, quality_status, rejection_reason
      FROM project_pd_pm_handover
      WHERE project_id IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})
    `);
    const rows = Array.isArray(result) ? result : result.rows || [];
    return rows as Array<{
      project_id: number;
      status: string | null;
      engineering_status: string | null;
      quality_status: string | null;
      rejection_reason: string | null;
    }>;
  } catch (err) {
    console.warn("[QualityRepository] handover lookup failed; continuing without handover context", {
      projectCount: projectIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Single full handover row for a project (returns all columns). */
export async function findFullHandoverRowForProject(projectId: number): Promise<Record<string, unknown> | null> {
  const result = await db.execute(sql`
    SELECT * FROM project_pd_pm_handover WHERE project_id = ${projectId} LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : result.rows || [];
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}
