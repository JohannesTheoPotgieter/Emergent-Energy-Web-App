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
import { alias } from "drizzle-orm/pg-core";
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
import { effectiveEngineeringDueDate } from "@shared/engineering/plan-link";
import { toNumberArray } from "../lib/drizzle-helpers";

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

  // Self-join the linked plan task so its dates feed the SAME read-time due-date
  // derivation the Task Manager uses — otherwise Home's overdue / due-this-week
  // counts diverge from the Task Manager for plan-linked tasks.
  const planItems = alias(workItems, "home_plan_items");
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
      planLinkItemId: workItems.planLinkItemId,
      planLinkRelation: workItems.planLinkRelation,
      planLinkLeadDays: workItems.planLinkLeadDays,
      planStart: planItems.startDate,
      planEnd: planItems.endDate,
    })
    .from(workItems)
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .leftJoin(planItems, eq(planItems.id, workItems.planLinkItemId))
    .where(and(...taskPredicates));

  // Single "today" reused for both due-date derivation and the aggregator so
  // urgency and bucketing agree.
  const today = isoToday();

  // Only fetch the projects actually referenced by the in-scope ENG tasks —
  // the portfolio never surfaces a project with no in-scope task, so scanning
  // the whole project table (hundreds of rows) on every Home load is wasted.
  const referencedProjectIds = [
    ...new Set(toNumberArray(taskRows.map((t: (typeof taskRows)[number]) => t.projectId))),
  ];
  const projectRows = referencedProjectIds.length === 0
    ? []
    : await db
        .select({
          id: projectInfo.id,
          projectName: projectInfo.projectName,
          phase: projectExecutionState.phase,
          currentStageCode: projectExecutionState.currentStageCode,
        })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(inArray(projectInfo.id, referencedProjectIds));

  const assignmentRows = await db
    .select({ workItemId: workItemAssignments.workItemId })
    .from(workItemAssignments)
    .where(eq(workItemAssignments.userId, userId));

  return summarizeEngineeringHome({
    tasks: taskRows.map((t: (typeof taskRows)[number]) => ({
      id: t.id,
      projectId: t.projectId ?? null,
      status: t.status,
      // Effective due = plan-link derived when linked (authoritative), else the
      // persisted end date. Same rule as the Task Manager.
      endDate: effectiveEngineeringDueDate({
        planLinkItemId: t.planLinkItemId ?? null,
        planLinkRelation: t.planLinkRelation ?? null,
        planLinkLeadDays: t.planLinkLeadDays ?? null,
        planStart: t.planStart ?? null,
        planEnd: t.planEnd ?? null,
        endDate: t.endDate ?? null,
        status: t.status,
        today,
      }),
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
    today,
    filters: { projectIds, ownerUserId, includeCompleted },
  });
}
