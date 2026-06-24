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

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  workItems,
  workItemAssignments,
} from "@shared/schema";
import {
  summarizeEngineeringHome,
  type EngineeringHomeSummary,
} from "../lib/engineering/home-aggregation";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the Engineering Home summary for a given user. "My work" is scoped to
 * tasks the user owns or is assigned to; metrics + portfolio are program-wide
 * across the ENG workstream.
 */
export async function getEngineeringHome(userId: number): Promise<EngineeringHomeSummary> {
  const taskRows = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      status: workItems.status,
      endDate: workItems.endDate,
      ownerUserId: workItems.ownerUserId,
      title: workItems.title,
      priority: workItems.priority,
    })
    .from(workItems)
    .where(and(eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));

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
  });
}
