/**
 * Engineering Home repository — spine reads for the Engineering Home page.
 *
 * Reads the canonical spine directly via Drizzle (NOT the retired
 * `work-items-adapter`): `work_items` (workstream = ENG, not soft-deleted)
 * joined conceptually with `project_info` + `project_execution_state` (phase,
 * read-only) and the caller's `work_item_assignments`. All aggregation is
 * delegated to the pure `summarizeEngineeringHome` so the numbers are
 * unit-tested without a database.
 *
 * No snapshot tables are involved here, so the `effectiveTo IS NULL` guard
 * does not apply. Soft-delete guard (`isNull(deletedAt)`) is applied to
 * `work_items`.
 */

import { and, eq, isNull, inArray, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  workItems,
  workItemAssignments,
  users,
} from "@shared/schema";
import {
  summarizeEngineeringHome,
  type EngineeringHomeSummary,
} from "../lib/engineering/home-aggregation";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Optional slice for the Engineering Home — site (project), engineer (owner),
 * and hide-completed. Mirrors the route's query params. Predicates that can be
 * pushed into SQL (project + owner) are; `includeCompleted` is applied by the
 * pure aggregator so its behaviour stays unit-testable.
 */
export interface EngineeringHomeQuery {
  projectIds?: number[];
  ownerUserId?: number;
  includeCompleted?: boolean;
}

/**
 * Build the Engineering Home summary for a given user. "My work" is scoped to
 * tasks the user owns or is assigned to; metrics + portfolio are program-wide
 * across the ENG workstream, narrowed by any supplied filters.
 */
export async function getEngineeringHome(
  userId: number,
  query: EngineeringHomeQuery = {},
): Promise<EngineeringHomeSummary> {
  const { projectIds, ownerUserId, includeCompleted } = query;

  // Push the project (site) predicate into SQL — it narrows the read without
  // affecting the engineer dropdown (owners are derived from the in-scope ENG
  // tasks). The `ownerUserId` filter is deliberately NOT pushed here: the pure
  // aggregator applies it, so it can still see every owner and build the full
  // `owners` list for the client's Engineer picker.
  const taskPredicates: SQL[] = [eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)];
  if (projectIds && projectIds.length > 0) {
    taskPredicates.push(inArray(workItems.projectId, projectIds));
  }

  const taskRows = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      status: workItems.status,
      endDate: workItems.endDate,
      ownerUserId: workItems.ownerUserId,
      ownerName: users.name,
      title: workItems.title,
      priority: workItems.priority,
    })
    .from(workItems)
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .where(and(...taskPredicates));

  const projectRows = await db
    .select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
      phase: projectExecutionState.phase,
      currentStageCode: projectExecutionState.currentStageCode,
    })
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));

  const assignmentRows = await db
    .select({ workItemId: workItemAssignments.workItemId })
    .from(workItemAssignments)
    .where(eq(workItemAssignments.userId, userId));

  return summarizeEngineeringHome({
    tasks: taskRows.map((t: (typeof taskRows)[number]) => ({
      id: t.id,
      projectId: t.projectId ?? null,
      status: t.status,
      endDate: t.endDate ?? null,
      ownerUserId: t.ownerUserId ?? null,
      ownerName: t.ownerName ?? null,
      title: t.title,
      priority: t.priority ?? null,
    })),
    projects: projectRows.map((p: (typeof projectRows)[number]) => ({
      id: p.id,
      projectName: p.projectName,
      // Prefer the lifecycle stage code; fall back to the free phase string.
      phaseCode: p.currentStageCode ?? p.phase ?? null,
    })),
    myUserId: userId,
    myAssignedTaskIds: new Set(assignmentRows.map((a: (typeof assignmentRows)[number]) => a.workItemId)),
    today: isoToday(),
    filters: { projectIds, ownerUserId, includeCompleted },
  });
}
