import { db } from "./db";
import { eq, and, isNull, sql, asc, desc, inArray } from "drizzle-orm";
import { workItems, workItemAssignments, projectInfo, TASK_STATUSES, engineeringTickets, projectEngTasks, type WorkItem, type WorkItemAssignment } from "@shared/schema";
import { normalizeEngineeringTicketStatus } from "@shared/engineering-ticket-status";
import { getFeatureFlag } from "./lib/feature-flags";
import { queryWorkItems, getAssignmentsByWorkItemIds } from "./lib/work-item-queries";
import type { UnifiedTask } from "@shared/types/unified-task";
import { fromWorkItem, toOperationalTaskShape } from "@shared/types/unified-task";

export const WORK_ITEMS_FLAG = "canonical_work_items_v1";

// Re-export for convenience
export type { UnifiedTask } from "@shared/types/unified-task";
export { fromWorkItem, toOperationalTaskShape, toEngineeringTaskShape } from "@shared/types/unified-task";

/**
 * Fetch all work_items for a project as UnifiedTask[].
 * This is the canonical query path — reads from work_items + extension JOINs.
 */
export async function getUnifiedTasksForProject(projectId: number): Promise<UnifiedTask[]> {
  const tasks: any[] = await queryWorkItems({ projectId });
  const ids = tasks.map((t: any) => t.id);
  const assignments = await getAssignmentsByWorkItemIds(ids);
  for (const t of tasks) {
    t.assigneeUserIds = assignments.get(t.id) || null;
  }
  return tasks;
}

export async function isWorkItemsEnabled(): Promise<boolean> {
  return getFeatureFlag(WORK_ITEMS_FLAG);
}

export async function getWorkItemsAsNormalizedPlanTasks(projectName: string): Promise<any[]> {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.workstream, "PM"),
        sql`${workItems.source} = 'SMART_IMPORT'`,
        isNull(workItems.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM project_info pi
          WHERE pi.id = ${workItems.projectId}
          AND pi.project_name = ${projectName}
        )`
      )
    )
    .orderBy(asc(workItems.id));

  return mapWorkItemsToNormalizedFormat(items, projectName, "PM");
}

export async function getAllWorkItemsForPlanTab(projectName: string): Promise<any[]> {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        sql`${workItems.workstream} IN ('PM', 'ENG', 'QUALITY')`,
        isNull(workItems.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM project_info pi
          WHERE pi.id = ${workItems.projectId}
          AND pi.project_name = ${projectName}
        )`
      )
    )
    .orderBy(asc(workItems.id));

  const ids = items.map((wi: any) => wi.id);
  const assignmentsByItem = new Map<number, string[]>();
  if (ids.length > 0) {
    const assignmentRows = await getAssignmentsByWorkItemIds(ids);
    const { buildUserMap } = await import("./user-resolver");
    const userMap = await buildUserMap();
    for (const [workItemId, userIds] of assignmentRows) {
      const names: string[] = [];
      for (const uid of userIds) {
        const resolved = userMap.get(uid);
        if (resolved) names.push(resolved.name);
      }
      if (names.length > 0) assignmentsByItem.set(workItemId, names);
    }
    for (const wi of items) {
      const ownerName = wi.ownerUserId ? userMap.get(wi.ownerUserId)?.name || null : null;
      if (ownerName) {
        const existing = assignmentsByItem.get(wi.id) || [];
        if (!existing.includes(ownerName)) {
          existing.push(ownerName);
          assignmentsByItem.set(wi.id, existing);
        }
      }
    }
  }

  return mapWorkItemsToNormalizedFormat(items, projectName, undefined, assignmentsByItem);
}

function mapWorkItemsToNormalizedFormat(items: WorkItem[], projectName: string, forceWorkstream?: string, resolvedAssignees?: Map<number, string[]>): any[] {
  const parentIdToWbs = new Map<number, string>();
  const parentIdToTitle = new Map<number, string>();
  for (const wi of items) {
    if (wi.wbsCode) parentIdToWbs.set(wi.id, wi.wbsCode);
    parentIdToTitle.set(wi.id, wi.title);
  }

  return items.map((wi: WorkItem) => {
    const parentTaskNo = wi.parentId ? (parentIdToWbs.get(wi.parentId) || null) : null;
    const indentLevel = wi.wbsCode ? (wi.wbsCode.split('.').length - 1) : 0;
    const resolvedNames = resolvedAssignees?.get(wi.id) || null;
    const effectiveAssignees = resolvedNames || (wi as any).assignees || null;

    return {
      id: wi.legacyId ?? wi.id,
      workItemId: wi.id,
      projectId: wi.projectId,
      projectName: projectName,
      taskName: wi.title,
      taskNo: wi.wbsCode,
      phase: wi.type,
      startDate: wi.startDate,
      endDate: wi.endDate,
      durationDays: wi.duration,
      // § 3.7 HARD: actuals fields hold actuals only. NEVER fall back
      // to planned dates — that would silently shift the perceived
      // programme. Null means "actual not yet known" — let the UI
      // render an em-dash or "not started".
      actualStartDate: wi.actualStart,
      actualEndDate: wi.actualEnd,
      actualDurationDays: wi.actualDuration,
      owner: effectiveAssignees && effectiveAssignees.length > 0 ? effectiveAssignees[0] : null,
      assignees: effectiveAssignees,
      assigneeUserId: wi.ownerUserId,
      assigneeUserIds: (wi as any).assigneeUserIds || null,
      status: wi.status,
      pctComplete: wi.percentComplete != null ? wi.percentComplete : null,
      expectedPctComplete: null,
      comment: wi.description,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
      parentTaskNo,
      parentWorkItemId: wi.parentId || null,
      parentTaskTitle: wi.parentId ? (parentIdToTitle.get(wi.parentId) || null) : null,
      indentLevel: wi.indentLevel ?? indentLevel,
      sortOrder: wi.sortOrder ?? 0,
      sourceSheet: null,
      sourceRow: null,
      importRunId: wi.legacyId ?? 0,
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      baselineStart: wi.baselineStart || null,
      baselineEnd: wi.baselineEnd || null,
      baselineDuration: wi.baselineDuration || null,
      taskMode: wi.taskMode || "auto",
      workstream: forceWorkstream || wi.workstream,
    };
  });
}

export async function getWorkItemsAsOperationalTasks(projectName: string): Promise<any[]> {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        isNull(workItems.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM project_info pi
          WHERE pi.id = ${workItems.projectId}
          AND pi.project_name = ${projectName}
        )`
      )
    )
    .orderBy(asc(workItems.id));

  const assignments = items.length > 0
    ? await db
        .select()
        .from(workItemAssignments)
        .where(
          sql`${workItemAssignments.workItemId} IN (${sql.join(items.map((i: WorkItem) => sql`${i.id}`), sql`, `)})`
        )
    : [];

  const assignmentsByItem = new Map<number, any[]>();
  for (const a of assignments) {
    if (!assignmentsByItem.has(a.workItemId)) {
      assignmentsByItem.set(a.workItemId, []);
    }
    assignmentsByItem.get(a.workItemId)!.push(a);
  }

  return items.map((wi: WorkItem) => {
    const itemAssignments = assignmentsByItem.get(wi.id) || [];
    const assigneeUserIds = itemAssignments
      .filter((a) => a.role === "ASSIGNEE")
      .map((a) => a.userId);
    const ownerAssignment = itemAssignments.find((a) => a.role === "OWNER");

    return {
      id: wi.legacyId ?? wi.id,
      projectId: wi.projectId,
      projectName: projectName,
      importedTaskId: null,
      taskNumber: wi.wbsCode,
      parentTaskId: wi.parentId,
      title: wi.title,
      description: wi.description,
      status: wi.status,
      priority: wi.priority || "Med",
      phase: wi.type,
      primaryWorkstream: wi.workstream,
      ownerUserId: ownerAssignment?.userId ?? wi.ownerUserId,
      requesterUserId: null,
      approverUserId: null,
      holdReason: null,
      blockedType: null,
      approvalRequired: false,
      startDate: wi.startDate,
      dueDate: wi.endDate,
      durationDays: wi.duration,
      actualStartDate: null,
      actualEndDate: null,
      actualDurationDays: null,
      completedAt: null,
      percentComplete: wi.percentComplete ?? 0,
      expectedPercentComplete: null,
      comment: wi.description,
      assignees: null,
      assigneeUserIds: assigneeUserIds.length > 0 ? assigneeUserIds : null,
      watchers: null,
      tags: null,
      blockerReason: null,
      plannedHours: null,
      actualHours: null,
      escalationLevel: null,
      sortOrder: 0,
      isBaseline: false,
      linkedPlanItemId: null,
      linkedDeliverableId: null,
      linkedQualityItemInstanceId: null,
      externalSource: null,
      externalTaskId: wi.externalRef,
      externalSubtaskIds: null,
      externalSubtaskUrls: null,
      trackingRag: null,
      summaryText: null,
      importedCommentCount: null,
      taskTypeTag: null,
      domain: "BOTH",
      pdTicketId: null,
      createdBy: wi.createdBy,
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      createdAt: wi.createdAt,
      updatedAt: wi.updatedAt,
    };
  });
}

export async function getWorkItemsAsEngineeringTasks(userId?: number): Promise<any[]> {
  const conditions = [
    eq(workItems.workstream, "ENG"),
    isNull(workItems.deletedAt),
  ];
  if (userId) {
    conditions.push(eq(workItems.ownerUserId, userId));
  }

  const [items, projectRows] = await Promise.all([
    db.select().from(workItems).where(and(...conditions)).orderBy(desc(workItems.createdAt)),
    db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
  ]);

  const projectMap = new Map<number, string>();
  for (const p of projectRows) {
    projectMap.set(p.id, p.projectName);
  }

  const allItemIds = items.map((i: WorkItem) => i.id);
  const assignments = allItemIds.length > 0
    ? await db.select().from(workItemAssignments).where(
        sql`${workItemAssignments.workItemId} IN (${sql.join(allItemIds.map((id: number) => sql`${id}`), sql`, `)})`
      )
    : [];

  const assignmentsByItem = new Map<number, string[]>();
  const { buildUserMap } = await import("./user-resolver");
  const userMap = await buildUserMap();
  for (const a of assignments) {
    if (!assignmentsByItem.has(a.workItemId)) assignmentsByItem.set(a.workItemId, []);
    const resolved = userMap.get(a.userId);
    if (resolved) assignmentsByItem.get(a.workItemId)!.push(resolved.name);
  }

  return items.map((wi: WorkItem) => {
    const resolvedProject = wi.projectId ? projectMap.get(wi.projectId) || null : null;
    const assigneeNames = assignmentsByItem.get(wi.id) || [];
    const ownerName = wi.ownerUserId ? userMap.get(wi.ownerUserId)?.name || null : null;
    if (ownerName && !assigneeNames.includes(ownerName)) assigneeNames.push(ownerName);

    return {
      id: wi.legacyId ?? wi.id,
      projectId: wi.projectId,
      projectName: resolvedProject,
      title: wi.title,
      description: wi.description,
      status: mapToEngStatus(wi.status),
      priority: wi.priority || "Medium",
      dueDate: wi.endDate,
      startDate: wi.startDate,
      assignees: assigneeNames.length > 0 ? assigneeNames : null,
      assigneeUserIds: assignments.filter((a: any) => a.workItemId === wi.id).map((a: any) => a.userId),
      ownerUserId: wi.ownerUserId,
      trackingRag: null,
      holdReason: null,
      blockerReason: null,
      blockedType: null,
      completedAt: wi.status === "COMPLETE" ? (wi.updatedAt || wi.createdAt) : null,
      taskTypeTag: null,
      primaryWorkstream: wi.workstream,
      percentComplete: wi.percentComplete ?? 0,
      summaryText: null,
      externalSource: null,
      externalTaskId: wi.externalRef,
      sortOrder: 0,
      createdAt: wi.createdAt,
      updatedAt: wi.updatedAt,
    };
  });
}

export async function getWorkItemsAsMytoolTasks(userId: number): Promise<any[]> {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.workstream, "PERSONAL"),
        eq(workItems.ownerUserId, userId),
        isNull(workItems.deletedAt)
      )
    )
    .orderBy(desc(workItems.createdAt));

  return items.map((wi: WorkItem) => ({
    id: wi.legacyId ?? wi.id,
    ownerUserId: wi.ownerUserId,
    title: wi.title,
    status: mapToMytoolStatus(wi.status),
    priority: (wi.priority || "normal").toLowerCase(),
    plannedForDate: wi.startDate,
    dueAt: wi.endDate ? new Date(wi.endDate) : null,
    startDate: wi.startDate,
    notes: wi.description,
    bucket: wi.projectId ? "project" : "personal",
    projectName: null,
    department: null,
    tag: null,
    sourceEmailId: null,
    sourceEmailSubject: null,
    blockedReason: null,
    nextStep: null,
    definitionOfDone: null,
    completionNote: null,
    pinnedToday: false,
    pinnedWeek: false,
    sortOrder: 0,
    isRecurring: false,
    recurrenceFrequency: null,
    recurrenceInterval: null,
    recurrenceDaysOfWeek: null,
    recurrenceEndDate: null,
    recurrenceParentId: null,
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    createdAt: wi.createdAt,
    updatedAt: wi.updatedAt,
    completedAt: null,
  }));
}

/**
 * Canonical progress-source query. Returns ALL Smart-Import work_items
 * across PM + ENG + QUALITY workstreams for every project, shaped for
 * `computeProjectProgress` (server/lib/kpi-formulas.ts).
 *
 * Why this exists: pre-2026-05-19, every project-schedule dashboard
 * (Execution / Program / Schedule Status modal / All Projects Progress
 * Delta / PM monthly report / COO Home) fed `computeProjectProgress`
 * from `getAllPMWorkItemsAsProjectPlan()` — PM-only — while the Plan
 * tab on the project detail page fed it from `getAllWorkItemsForPlanTab`
 * — PM + ENG + QUALITY. Same helper, different inputs → same project
 * row showed Actual % 26% / Expected % 32% on the Plan tab and Actual
 * % 7% / Expected % 39% on the Schedule Status modal. The Plan tab's
 * values matched the Excel project-plan top-row rollup; the dashboards
 * did not.
 *
 * This helper is the single source of truth for "progress across the
 * whole project" so all surfaces produce the same numbers. The PM-only
 * variant below is retained for callers that legitimately need to
 * filter to a single workstream (e.g. workstream-specific completion
 * counts).
 */
export async function getAllWorkItemsForProgress(): Promise<any[]> {
  // Deterministic workbook-order is critical: computeProjectProgress'
  // parent detection walks the array and treats row i as a parent when
  // row i+1 is more deeply indented. If ordering is unstable, the same
  // project can flip-flop which tasks count as leaves between requests.
  // work_items has no native row_number column — Smart Import preserves
  // workbook position via (sortOrder, sourceRow); we synthesize a
  // per-project rowNumber from that order so the helper's leaf-detection
  // heuristic still works.
  const items = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      title: workItems.title,
      wbsCode: workItems.wbsCode,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      actualStart: workItems.actualStart,
      actualEnd: workItems.actualEnd,
      duration: workItems.duration,
      percentComplete: workItems.percentComplete,
      expectedPctComplete: workItems.expectedPctComplete,
      type: workItems.type,
      status: workItems.status,
      isMilestone: workItems.isMilestone,
      indentLevel: workItems.indentLevel,
      parentId: workItems.parentId,
      sortOrder: workItems.sortOrder,
      sourceRow: workItems.sourceRow,
      workstream: workItems.workstream,
    })
    .from(workItems)
    .where(
      and(
        sql`${workItems.workstream} IN ('PM', 'ENG', 'QUALITY')`,
        isNull(workItems.deletedAt),
      )
    )
    // 2026-05-19: Scope intentionally matches getAllWorkItemsForPlanTab
    // (no source='SMART_IMPORT' filter) so the dashboard rollup is fed
    // the same row set as the Plan tab — which the COO confirmed
    // matches the Excel project-plan top-row rollup.
    .orderBy(asc(workItems.projectId), asc(workItems.sortOrder), asc(workItems.sourceRow), asc(workItems.id));

  const projectIds: number[] = Array.from(new Set(items.map((i: any) => i.projectId).filter((id: any): id is number => typeof id === "number")));
  let projectNameMap = new Map<number, string>();
  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    for (const row of projects) {
      projectNameMap.set(row.id, row.projectName);
    }
  }

  // Build parent map from work_items.parent_id (real FK self-ref) so the
  // helper has accurate parent_row_number info — not just the indent
  // adjacency heuristic.
  const idToRowByProject = new Map<number, Map<number, number>>();
  const rowCounterByProject = new Map<number, number>();
  const firstPass: { wi: any; rowNum: number; pId: number }[] = [];
  for (const wi of items) {
    const pId = wi.projectId || 0;
    const rowNum = (rowCounterByProject.get(pId) || 0) + 1;
    rowCounterByProject.set(pId, rowNum);
    if (!idToRowByProject.has(pId)) idToRowByProject.set(pId, new Map());
    idToRowByProject.get(pId)!.set(wi.id, rowNum);
    firstPass.push({ wi, rowNum, pId });
  }

  return firstPass.map(({ wi, rowNum, pId }) => {
    const parentRowNumber = wi.parentId && idToRowByProject.get(pId)?.get(wi.parentId) || null;
    return {
      id: wi.id,
      projectId: wi.projectId,
      projectName: wi.projectId ? (projectNameMap.get(wi.projectId) || "") : "",
      highLevelProgramme: wi.title,
      title: wi.title,
      taskNo: wi.wbsCode,
      rowNumber: rowNum,
      parentRowNumber,
      indentLevel: wi.indentLevel ?? (wi.wbsCode ? (wi.wbsCode.split('.').length - 1) : 0),
      // § 3.7 HARD: actuals fields hold actuals only. Never fall back to planned.
      actualStart: wi.actualStart,
      actualEnd: wi.actualEnd,
      startDate: wi.startDate,
      endDate: wi.endDate,
      actualPctComplete: wi.percentComplete,
      expectedPctComplete: wi.expectedPctComplete,
      durationDays: wi.duration,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
      workstream: wi.workstream,
    };
  });
}

export async function getAllPMWorkItemsAsProjectPlan(): Promise<any[]> {
  const items = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      title: workItems.title,
      wbsCode: workItems.wbsCode,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      actualStart: workItems.actualStart,
      actualEnd: workItems.actualEnd,
      duration: workItems.duration,
      percentComplete: workItems.percentComplete,
      type: workItems.type,
      status: workItems.status,
      isMilestone: workItems.isMilestone,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.workstream, "PM"),
        sql`${workItems.source} = 'SMART_IMPORT'`,
        isNull(workItems.deletedAt),
      )
    );

  const projectIds: number[] = Array.from(new Set(items.map((i: any) => i.projectId).filter((id: any): id is number => typeof id === "number")));
  let projectNameMap = new Map<number, string>();
  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    for (const row of projects) {
      projectNameMap.set(row.id, row.projectName);
    }
  }

  const rowCounterByProject = new Map<number, number>();
  return items.map((wi: any) => {
    const pId = wi.projectId || 0;
    const rowNum = (rowCounterByProject.get(pId) || 0) + 1;
    rowCounterByProject.set(pId, rowNum);
    return {
      id: wi.id,
      projectId: wi.projectId,
      projectName: wi.projectId ? (projectNameMap.get(wi.projectId) || "") : "",
      highLevelProgramme: wi.title,
      title: wi.title,
      taskNo: wi.wbsCode,
      rowNumber: rowNum,
      // § 3.7 HARD: actuals fields hold actuals only. Never fall back to planned.
      actualStart: wi.actualStart,
      actualEnd: wi.actualEnd,
      actualPctComplete: wi.percentComplete,
      expectedPctComplete: null,
      durationDays: wi.duration,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
    };
  });
}

// Prompt 0.9 / BUG-02: After migration 20260413_status_casing_normalization,
// work_items.status stores canonical lowercase_snake_case values
// ("not_started", "to_do", "in_progress", "hold", ...). The pre-migration
// versions of these helpers only recognized legacy Title Case ("Not Started",
// "In Progress") and UPPER CASE ("TO DO", "HOLD") and fell through to a
// default for every canonical value. That made every task status collapse
// to "TO DO" on the API response, emptying the kanban columns and the
// list view even though the header count was correct.
//
// Both helpers now normalize any legacy input to the canonical form and
// pass canonical inputs through unchanged. They remain symmetrical so
// callers on either side of the adapter get a consistent value.

const LEGACY_STATUS_TO_CANONICAL: Record<string, string> = {
  // Legacy Title Case (pre-migration DB values)
  "Not Started": "not_started",
  "To Do": "to_do",
  "In Progress": "in_progress",
  "On Hold": "hold",
  "Blocked": "hold",
  "Complete": "complete",
  "Completed": "complete",
  "Done": "complete",
  // Legacy UPPER CASE (frontend/legacy API callers)
  "NOT STARTED": "not_started",
  "TO DO": "to_do",
  "IN PROGRESS": "in_progress",
  "HOLD": "hold",
  "ON HOLD": "hold",
  "COMPLETE": "complete",
  "COMPLETED": "complete",
  "DONE": "complete",
  "NEEDS APPROVAL": "needs_approval",
  "QC APPROVED": "qc_approved",
  "PROVIDE FEEDBACK": "provide_feedback",
  "OPERATIONAL APPROVAL": "operational_approval",
  "PROJECTS ASSISTANCE": "projects_assistance",
};

const CANONICAL_STATUS_SET: Set<string> = new Set(TASK_STATUSES as readonly string[]);

export function toCanonicalStatus(input?: string | null): string {
  if (!input) return "not_started";
  if (CANONICAL_STATUS_SET.has(input)) return input;
  const legacy = LEGACY_STATUS_TO_CANONICAL[input];
  if (legacy) return legacy;
  // Last-resort normalization: lowercase, underscore-separated
  const normalized = input.trim().toLowerCase().replace(/\s+/g, "_");
  if (CANONICAL_STATUS_SET.has(normalized)) return normalized;
  return "not_started";
}

export function mapFromOpsStatus(opsStatus: string): string {
  return toCanonicalStatus(opsStatus);
}

export function mapToOpsStatus(wiStatus: string): string {
  return toCanonicalStatus(wiStatus);
}

export async function createWorkItem(data: {
  projectId?: number | null;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  workstream?: string;
  type?: string;
  startDate?: string | null;
  endDate?: string | null;
  ownerUserId?: number | null;
  createdBy?: number | null;
  legacyTable?: string;
  legacyId?: number;
  externalRef?: string;
  plannedHours?: number | null;
}): Promise<any> {
  const [item] = await db.insert(workItems).values({
    projectId: data.projectId ?? null,
    title: data.title,
    description: data.description ?? null,
    // Prompt 0.9: normalize any legacy input and default to canonical "not_started".
    status: toCanonicalStatus(data.status),
    priority: data.priority || null,
    workstream: (data.workstream as any) || "PM",
    type: data.type || "task",
    source: "UI" as any,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    ownerUserId: data.ownerUserId ?? null,
    createdBy: data.createdBy ?? null,
    legacyTable: data.legacyTable ?? null,
    legacyId: data.legacyId ?? null,
    externalRef: data.externalRef ?? null,
    plannedHours: data.plannedHours ?? null,
  }).returning();

  if (data.ownerUserId) {
    await db.insert(workItemAssignments).values({
      workItemId: item.id,
      userId: data.ownerUserId,
      role: "OWNER" as any,
    }).onConflictDoNothing();
  }

  return item;
}

export async function updateWorkItemByLegacy(legacyTable: string, legacyId: number, updates: {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  percentComplete?: number | null;
  ownerUserId?: number | null;
}): Promise<void> {
  const setData: any = { updatedAt: new Date() };
  if (updates.title !== undefined) setData.title = updates.title;
  if (updates.description !== undefined) setData.description = updates.description;
  if (updates.status !== undefined) setData.status = updates.status;
  if (updates.priority !== undefined) setData.priority = updates.priority;
  if (updates.startDate !== undefined) setData.startDate = updates.startDate;
  if (updates.endDate !== undefined) setData.endDate = updates.endDate;
  if (updates.percentComplete !== undefined) setData.percentComplete = updates.percentComplete;
  if (updates.ownerUserId !== undefined) setData.ownerUserId = updates.ownerUserId;

  await db.update(workItems)
    .set(setData)
    .where(and(
      eq(workItems.legacyTable, legacyTable),
      eq(workItems.legacyId, legacyId),
      isNull(workItems.deletedAt)
    ));
}

export async function softDeleteWorkItemByLegacy(legacyTable: string, legacyId: number): Promise<void> {
  await db.update(workItems)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(workItems.legacyTable, legacyTable),
      eq(workItems.legacyId, legacyId),
      isNull(workItems.deletedAt)
    ));
}

export async function getWorkItemsForProject(projectId: number): Promise<any[]> {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        isNull(workItems.deletedAt)
      )
    )
    .orderBy(asc(workItems.id));

  const assignments = items.length > 0
    ? await db
        .select()
        .from(workItemAssignments)
        .where(
          sql`${workItemAssignments.workItemId} IN (${sql.join(items.map((i: WorkItem) => sql`${i.id}`), sql`, `)})`
        )
    : [];

  const assignmentsByItem = new Map<number, any[]>();
  for (const a of assignments) {
    if (!assignmentsByItem.has(a.workItemId)) {
      assignmentsByItem.set(a.workItemId, []);
    }
    assignmentsByItem.get(a.workItemId)!.push(a);
  }

  return items.map((wi: WorkItem) => {
    const itemAssignments = assignmentsByItem.get(wi.id) || [];
    const ownerAssignment = itemAssignments.find((a) => a.role === "OWNER");
    const assigneeIds = itemAssignments.filter((a) => a.role === "ASSIGNEE" || a.role === "OWNER").map((a) => a.userId);

    return {
      id: wi.id,
      workItemId: wi.id,
      legacyId: wi.legacyId,
      legacyTable: wi.legacyTable,
      projectId: wi.projectId,
      title: wi.title,
      description: wi.description,
      status: wi.status,
      priority: wi.priority || "Med",
      workstream: wi.workstream,
      type: wi.type,
      startDate: wi.startDate,
      endDate: wi.endDate,
      dueDate: wi.endDate,
      duration: wi.duration,
      percentComplete: wi.percentComplete ?? 0,
      wbsCode: wi.wbsCode,
      parentId: wi.parentId,
      ownerUserId: ownerAssignment?.userId ?? wi.ownerUserId,
      assigneeUserIds: assigneeIds.length > 0 ? assigneeIds : null,
      externalRef: wi.externalRef,
      source: wi.source,
      createdBy: wi.createdBy,
      createdAt: wi.createdAt,
      updatedAt: wi.updatedAt,
    };
  });
}

type EngineeringListOptions = {
  projectName?: string;
  status?: string;
  workstream?: string;
  phase?: string;
  ownerUserId?: number;
  projectId?: number;
  ids?: number[];
};

/**
 * Engineering PR 3 (Tier 3): typed return for `listEngineeringWorkItems`.
 * Captures the operational-task-shape view used by engineering-routes.ts
 * and the dashboard /overview endpoint. Optional fields are mutated in
 * place by callers (e.g. `assignees` gets resolved from `assigneeUserIds`
 * via the user-map). Use `Record<string, unknown>` index access for the
 * rare "we want to spread arbitrary metadata" sites.
 */
export type EngTask = {
  id: number;
  projectId: number | null;
  projectName: string | null;
  importedTaskId: null;
  taskNumber: string | null;
  parentTaskId: number | null;
  parentTaskTitle: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  phase: string | null;
  primaryWorkstream: "Engineering";
  ownerUserId: number | null;
  requesterUserId: null;
  approverUserId: null;
  holdReason: string | null;
  blockedType: string | null;
  approvalRequired: boolean;
  startDate: string | Date | null;
  dueDate: string | Date | null;
  durationDays: number | null;
  actualStartDate: string | Date | null;
  actualEndDate: string | Date | null;
  actualDurationDays: number | null;
  completedAt: Date | string | null;
  percentComplete: number;
  expectedPercentComplete: null;
  comment: string | null;
  /** Resolved by route handlers from `assigneeUserIds` + user map. */
  assignees: string[] | null;
  assigneeUserIds: number[];
  watchers: null;
  tags: null;
  blockerReason: string | null;
  plannedHours: null;
  actualHours: null;
  escalationLevel: null;
  sortOrder: number;
  isBaseline: false;
  linkedPlanItemId: number | null;
  linkedDeliverableId: number | null;
  linkedQualityItemInstanceId: number | null;
  externalSource: null;
  externalTaskId: string | null;
  externalSubtaskIds: null;
  externalSubtaskUrls: null;
  trackingRag: string | null;
  summaryText: null;
  importedCommentCount: null;
  taskTypeTag: string | null;
  domain: "BOTH";
  pdTicketId: null;
  createdBy: number | null;
  scheduledDate: string | Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  workItemId: number;
  legacyId: number | null;
  legacyTable: string | null;
  canonical: true;
};

export async function listEngineeringWorkItems(options: EngineeringListOptions = {}): Promise<EngTask[]> {
  // Engineering PR 3: short-circuit when the caller passes an empty `ids`
  // array. Without this guard Drizzle would emit `IN ()` which Postgres
  // rejects.
  if (options.ids && options.ids.length === 0) return [];

  const conditions = [
    eq(workItems.workstream, "ENG"),
    isNull(workItems.deletedAt),
  ];

  if (options.status) conditions.push(eq(workItems.status, mapFromOpsStatus(options.status)));
  if (options.phase) conditions.push(eq(workItems.phase, options.phase));
  if (options.ownerUserId) conditions.push(eq(workItems.ownerUserId, options.ownerUserId));
  if (options.projectId) conditions.push(eq(workItems.projectId, options.projectId));
  if (options.ids && options.ids.length > 0) conditions.push(inArray(workItems.id, options.ids));
  if (options.projectName) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM project_info pi
      WHERE pi.id = ${workItems.projectId}
      AND pi.project_name = ${options.projectName}
    )` as any);
  }

  const items = await db.select().from(workItems).where(and(...conditions)).orderBy(asc(workItems.sortOrder), asc(workItems.id));

  const itemIds = items.map((i: any) => i.id);
  const assignments = itemIds.length > 0
    ? await db.select().from(workItemAssignments).where(sql`${workItemAssignments.workItemId} IN (${sql.join(itemIds.map((id: any) => sql`${id}`), sql`, `)})`)
    : [];

  const assigneeMap = new Map<number, number[]>();
  for (const row of assignments) {
    const list = assigneeMap.get(row.workItemId) || [];
    if (row.role === "ASSIGNEE" || row.role === "OWNER") list.push(row.userId);
    assigneeMap.set(row.workItemId, list);
  }

  const projectRows = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  const projectMap = new Map(projectRows.map((row: any) => [row.id, row.projectName]));

  // For items without projectId, try to resolve project name from legacy operational_tasks table
  const orphanedItems = items.filter((wi: any) => !wi.projectId && wi.legacyTable === "operational_tasks" && wi.legacyId != null);
  const legacyProjectNameMap = new Map<number, string>();
  if (orphanedItems.length > 0) {
    try {
      const legacyIds = orphanedItems.map((wi: any) => wi.legacyId!);
      const legacyRows = await db.execute(
        sql`SELECT id, project_name FROM operational_tasks WHERE id IN (${sql.join(legacyIds.map((id: any) => sql`${id}`), sql`, `)})`
      );
      for (const row of (legacyRows as any).rows || []) {
        if (row.project_name) legacyProjectNameMap.set(row.id, row.project_name);
      }
    } catch {
      // operational_tasks table may not exist; ignore
    }
  }

  // Build parent title lookup from the items themselves
  const parentTitleMap = new Map<number, string>();
  for (const wi of items) {
    parentTitleMap.set(wi.id, wi.title);
  }

  return items.map((wi: any) => ({
    id: wi.id,
    projectId: wi.projectId,
    projectName: wi.projectId
      ? projectMap.get(wi.projectId) || null
      : (wi.legacyTable === "operational_tasks" && wi.legacyId != null ? legacyProjectNameMap.get(wi.legacyId) || null : null),
    importedTaskId: null,
    taskNumber: wi.wbsCode,
    parentTaskId: wi.parentId,
    parentTaskTitle: wi.parentId ? (parentTitleMap.get(wi.parentId) || null) : null,
    title: wi.title,
    description: wi.description,
    status: mapToOpsStatus(wi.status),
    priority: wi.priority || "Med",
    phase: wi.phase,
    primaryWorkstream: "Engineering",
    ownerUserId: wi.ownerUserId,
    requesterUserId: null,
    approverUserId: null,
    holdReason: wi.holdReason || null,
    blockedType: wi.blockedType || null,
    approvalRequired: wi.approvalRequired ?? false,
    startDate: wi.startDate,
    dueDate: wi.endDate,
    durationDays: wi.duration,
    actualStartDate: wi.actualStart,
    actualEndDate: wi.actualEnd,
    actualDurationDays: wi.actualDuration,
    // Prompt 0.9: check canonical lowercase "complete" (migration 20260413);
    // the legacy Title Case comparison never matched post-migration.
    completedAt: wi.completedAt || (wi.status === "complete" ? wi.updatedAt : null),
    percentComplete: wi.percentComplete != null ? Math.round(wi.percentComplete) : 0,
    expectedPercentComplete: null,
    comment: wi.description,
    assignees: null,
    assigneeUserIds: assigneeMap.get(wi.id) || [],
    watchers: null,
    tags: null,
    blockerReason: wi.blockerReason || null,
    plannedHours: null,
    actualHours: null,
    escalationLevel: null,
    sortOrder: wi.sortOrder ?? 0,
    isBaseline: false,
    linkedPlanItemId: wi.linkedPlanItemId || null,
    linkedDeliverableId: wi.linkedDeliverableId || null,
    linkedQualityItemInstanceId: wi.linkedQualityItemInstanceId || null,
    externalSource: null,
    externalTaskId: wi.externalRef,
    externalSubtaskIds: null,
    externalSubtaskUrls: null,
    trackingRag: wi.trackingRag || null,
    summaryText: null,
    importedCommentCount: null,
    taskTypeTag: wi.taskTypeTag || null,
    domain: "BOTH",
    pdTicketId: null,
    createdBy: wi.createdBy,
    scheduledDate: wi.scheduledDate,
    scheduledStartTime: wi.scheduledStartTime,
    scheduledEndTime: wi.scheduledEndTime,
    createdAt: wi.createdAt,
    updatedAt: wi.updatedAt,
    workItemId: wi.id,
    legacyId: wi.legacyId,
    legacyTable: wi.legacyTable,
    canonical: true,
  }));
}

export async function getEngineeringWorkItemById(id: number): Promise<EngTask | null> {
  // Engineering PR 3: scope by id rather than listing all engineering work
  // items in memory and filtering. listEngineeringWorkItems(ids=[id]) does
  // the same enrichment but with an `inArray` filter.
  const items = await listEngineeringWorkItems({ ids: [id] });
  return items[0] || null;
}

export async function createEngineeringWorkItem(data: {
  projectId?: number | null;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  phase?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  ownerUserId?: number | null;
  createdBy?: number | null;
  plannedHours?: number | null;
}): Promise<WorkItem> {
  return createWorkItem({
    projectId: data.projectId ?? null,
    title: data.title,
    description: data.description ?? null,
    status: mapFromOpsStatus(data.status || "TO DO"),
    priority: data.priority || null,
    workstream: "ENG",
    type: "task",
    startDate: data.startDate ?? null,
    endDate: data.dueDate ?? null,
    ownerUserId: data.ownerUserId ?? null,
    createdBy: data.createdBy ?? null,
    plannedHours: data.plannedHours ?? null,
  });
}

export async function updateEngineeringWorkItem(workItemId: number, updates: {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  phase?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  percentComplete?: number | null;
  ownerUserId?: number | null;
  projectId?: number | null;
  holdReason?: string | null;
  blockedType?: string | null;
  completedAt?: Date | null;
  linkedPlanItemId?: number | null;
  linkedDeliverableId?: number | null;
  linkedQualityItemInstanceId?: number | null;
  trackingRag?: string | null;
  taskTypeTag?: string | null;
  blockerReason?: string | null;
  approvalRequired?: boolean;
  plannedHours?: number | null;
}): Promise<WorkItem | null> {
  const setData: any = { updatedAt: new Date() };
  if (updates.title !== undefined) setData.title = updates.title;
  if (updates.description !== undefined) setData.description = updates.description;
  if (updates.status !== undefined) setData.status = mapFromOpsStatus(updates.status);
  if (updates.priority !== undefined) setData.priority = updates.priority;
  if (updates.phase !== undefined) setData.phase = updates.phase;
  if (updates.startDate !== undefined) setData.startDate = updates.startDate;
  if (updates.dueDate !== undefined) setData.endDate = updates.dueDate;
  if (updates.percentComplete !== undefined) setData.percentComplete = updates.percentComplete;
  if (updates.ownerUserId !== undefined) setData.ownerUserId = updates.ownerUserId;
  if (updates.projectId !== undefined) setData.projectId = updates.projectId;
  if (updates.holdReason !== undefined) setData.holdReason = updates.holdReason;
  if (updates.blockedType !== undefined) setData.blockedType = updates.blockedType;
  if (updates.completedAt !== undefined) setData.completedAt = updates.completedAt;
  if (updates.linkedPlanItemId !== undefined) setData.linkedPlanItemId = updates.linkedPlanItemId;
  if (updates.linkedDeliverableId !== undefined) setData.linkedDeliverableId = updates.linkedDeliverableId;
  if (updates.linkedQualityItemInstanceId !== undefined) setData.linkedQualityItemInstanceId = updates.linkedQualityItemInstanceId;
  if (updates.trackingRag !== undefined) setData.trackingRag = updates.trackingRag;
  if (updates.taskTypeTag !== undefined) setData.taskTypeTag = updates.taskTypeTag;
  if (updates.blockerReason !== undefined) setData.blockerReason = updates.blockerReason;
  if (updates.approvalRequired !== undefined) setData.approvalRequired = updates.approvalRequired;
  if (updates.plannedHours !== undefined) setData.plannedHours = updates.plannedHours;

  const [updated] = await db.update(workItems)
    .set(setData)
    .where(and(eq(workItems.id, workItemId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .returning();

  if (!updated) return null;

  if (updates.ownerUserId !== undefined && updates.ownerUserId) {
    await db.insert(workItemAssignments).values({
      workItemId,
      userId: updates.ownerUserId,
      role: "OWNER" as any,
    }).onConflictDoNothing();
  }

  // Path 2 forward-sync: when the engineering board mutates a sibling
  // row that's linked to an engineering_ticket, mirror the user-visible
  // fields (status / priority / dueDate / title) back to the ticket row
  // so finance/FYE rollup, PD dashboard, gate auto-evaluator and
  // Pipedrive — all of which still read from engineering_tickets — stay
  // consistent with what engineers actually see on their board.
  // Forward-only: work_items is canonical; we never sync the other way.
  if (updated.engineeringTicketId != null) {
    const ticketSet: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) {
      ticketSet.status = normalizeEngineeringTicketStatus(setData.status);
    }
    if (updates.priority !== undefined) {
      const mapped = workItemPriorityToTicketPriority((setData.priority as string | null | undefined) ?? null);
      if (mapped !== null) ticketSet.priority = mapped;
    }
    if (updates.dueDate !== undefined) ticketSet.dueDate = setData.endDate;
    if (updates.title !== undefined) ticketSet.projectSiteName = setData.title;
    // Skip if status/priority/title/dueDate were not in this update —
    // avoids touching the ticket row on no-op edits (e.g. owner-only
    // changes), which would still bump updated_at but carry no change.
    if (Object.keys(ticketSet).length > 1) {
      await db.update(engineeringTickets)
        .set(ticketSet)
        .where(and(eq(engineeringTickets.id, updated.engineeringTicketId), isNull(engineeringTickets.deletedAt)));
    }
  }

  // Keep stage task rows in sync when linked engineering work_items
  // are updated from the task board.
  if (updates.status !== undefined) {
    const stageStatusMap: Record<string, "pending" | "in_progress" | "complete"> = {
      "TO DO": "pending",
      "IN PROGRESS": "in_progress",
      "COMPLETE": "complete",
    };
    const mappedStageStatus = stageStatusMap[updates.status];
    if (mappedStageStatus) {
      await db.update(projectEngTasks)
        .set({
          status: mappedStageStatus,
          completedAt: mappedStageStatus === "complete" ? new Date() : null,
          completedBy: mappedStageStatus === "complete" ? (updated.ownerUserId ?? null) : null,
        })
        .where(eq(projectEngTasks.workItemId, workItemId));
    }
  }

  return updated;
}

/**
 * Path 2 priority normalisers — bidirectional between the two enums.
 *
 *   work_items.priority canonical:        Urgent | High | Med | Low
 *   engineering_tickets.priority enum:    Critical | High | Medium | Low
 *
 * History: the work_items.priority column is `text` so the database has
 * accumulated noise (Critical, Medium, CRITICAL, Normal, "" alongside
 * the canonical four). These helpers normalise inbound values from the
 * ticket side AND outbound values to the ticket side, so the two
 * tables can never drift on a "Medium" vs "Med" technicality.
 *
 * Both helpers preserve `null` (do-not-touch) and unrecognised strings
 * pass through unchanged so legacy data is never silently rewritten.
 */
export function workItemPriorityToTicketPriority(p: string | null | undefined): string | null {
  if (p == null || p === "") return null;
  const v = String(p).trim();
  switch (v) {
    case "Urgent":
    case "Critical":
    case "CRITICAL":
      return "Critical";
    case "High":
      return "High";
    case "Med":
    case "Medium":
    case "Normal":
      return "Medium";
    case "Low":
      return "Low";
    default:
      return v;
  }
}

export function ticketPriorityToWorkItemPriority(p: string | null | undefined): string | null {
  if (p == null || p === "") return null;
  const v = String(p).trim();
  switch (v) {
    case "Critical":
    case "CRITICAL":
    case "Urgent":
      return "Urgent";
    case "High":
      return "High";
    case "Medium":
    case "Med":
    case "Normal":
      return "Med";
    case "Low":
      return "Low";
    default:
      return v;
  }
}

/**
 * Path 2 reverse-direction sync: when an engineering_tickets row is
 * mutated directly (PATCH /api/pd/tickets/:id), mirror the user-visible
 * fields onto the canonical sibling work_items row so the drawer board
 * and the engineering kanban don't go stale.
 *
 * This is NOT a violation of the "work_items is canonical" invariant —
 * it's the inverse leg of the same one-row-per-ticket contract.
 * Without it, edits made via the PD ticket detail UI would silently
 * skip the canonical store.
 *
 * Pass the FULL post-update ticket row (the `returning()` from the
 * PATCH handler) plus the set of fields the user actually changed.
 * Fields not in `changedFields` are skipped so unrelated touches
 * (audit-only re-saves, owner-only edits) don't bump the work_item.
 */
export async function syncTicketEditToWorkItem(
  ticket: typeof engineeringTickets.$inferSelect,
  changedFields: Set<string>,
): Promise<void> {
  const wiSet: Record<string, unknown> = {};

  if (changedFields.has("status")) {
    // Pass through the canonical normaliser so legacy text statuses
    // ("To Do", "Done", "in_progress") all collapse to the new
    // engineering-board enum before we try to mirror.
    wiSet.status = normalizeEngineeringTicketStatus(ticket.status);
  }
  if (changedFields.has("priority")) {
    const mapped = ticketPriorityToWorkItemPriority(ticket.priority);
    if (mapped !== null) wiSet.priority = mapped;
  }
  if (changedFields.has("dueDate")) {
    wiSet.endDate = ticket.dueDate;
  }
  // Identity / linkage — when a PD edit re-titles or re-links the ticket
  // we MUST mirror onto the canonical work_items row, otherwise the
  // engineering board card and the PD ticket detail will display
  // different titles / project contexts. The creation site
  // (server/departments/opportunities-routes.ts:1311) uses the same
  // `String(projectSiteName ?? "Engineering ticket")` fallback so the
  // edit path stays in lockstep with the insert path.
  if (changedFields.has("projectSiteName")) {
    wiSet.title = String(ticket.projectSiteName ?? "Engineering ticket");
  }
  if (changedFields.has("projectId")) {
    wiSet.projectId = ticket.projectId;
  }
  if (changedFields.has("clientId")) {
    wiSet.clientId = ticket.clientId;
  }
  // Solar/site metadata — these now live on work_items as the canonical
  // store (see migration 0040). Mirror the 6 fields when they change.
  if (changedFields.has("fundingType")) wiSet.fundingType = ticket.fundingType;
  if (changedFields.has("sizeKwp")) wiSet.sizeKwp = ticket.sizeKwp;
  if (changedFields.has("province")) wiSet.province = ticket.province;
  if (changedFields.has("gpsCoordinates")) wiSet.gpsCoordinates = ticket.gpsCoordinates;
  if (changedFields.has("batteriesNeeded")) wiSet.batteriesNeeded = ticket.batteriesNeeded;
  if (changedFields.has("batterySize")) wiSet.batterySize = ticket.batterySize;

  if (Object.keys(wiSet).length === 0) return;
  wiSet.updatedAt = new Date();

  await db.update(workItems)
    .set(wiSet)
    .where(and(
      eq(workItems.engineeringTicketId, ticket.id),
      eq(workItems.workstream, "ENG"),
      isNull(workItems.deletedAt),
    ));
}

export async function deleteEngineeringWorkItem(workItemId: number): Promise<boolean> {
  const [updated] = await db.update(workItems)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workItems.id, workItemId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .returning({ id: workItems.id });
  return !!updated;
}

const DEFAULT_ENG_WORK_ITEMS = [
  { title: "PD/PM Handover", priority: "High", phase: "P2_PD_PM_HANDOVER" },
  { title: "Detailed Design Package", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
  { title: "Structural Design Review", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
  { title: "Electrical Design Review", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
  { title: "Equipment Procurement Release", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
  { title: "BOM Finalisation", priority: "Med", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
  { title: "Construction Method Statement", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
  { title: "H&S File Preparation", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
  { title: "Site Mobilisation Checklist", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
  { title: "Installation & Construction", priority: "High", phase: "P4_CONSTRUCTION_INSTALLATION" },
  { title: "QC Inspections", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
  { title: "Commissioning & Testing", priority: "High", phase: "P5_COMMISSIONING_TESTING" },
  { title: "Performance Verification", priority: "Med", phase: "P5_COMMISSIONING_TESTING" },
  { title: "Client Handover Documentation", priority: "High", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
  { title: "O&M Handover", priority: "Med", phase: "P6_HANDOVER_CLIENT_MATRIARCH" },
  { title: "Close-out Report", priority: "Med", phase: "P7_CLOSEOUT_POSTMORTEM" },
];

export async function generateDefaultEngineeringWorkItemsForProject(projectId: number, createdBy: number): Promise<WorkItem[]> {
  const existing = await db.select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
    .limit(1);

  if (existing.length > 0) {
    return [];
  }

  const created: WorkItem[] = [];
  for (let i = 0; i < DEFAULT_ENG_WORK_ITEMS.length; i++) {
    const t = DEFAULT_ENG_WORK_ITEMS[i];
    const [item] = await db.insert(workItems).values({
      projectId,
      workstream: "ENG",
      type: "task",
      source: "SYSTEM",
      title: t.title,
      status: "not_started",
      priority: t.priority,
      phase: t.phase,
      createdBy,
      sortOrder: (i + 1) * 10,
    }).returning();
    created.push(item);
  }

  return created;
}

// Both helpers route the input through `toCanonicalStatus` first so they
// recognise legacy Title-Case AND the canonical lower_snake wire format
// (post-migration 20260413). Without this normalisation, canonical rows
// collapsed to the default and produced "NOT_STARTED" / "inbox"
// everywhere.
function mapToEngStatus(status: string): string {
  const canonical = toCanonicalStatus(status);
  switch (canonical) {
    case "in_progress":
      return "IN_PROGRESS";
    case "complete":
    case "qc_approved":
      return "COMPLETE";
    case "hold":
    case "projects_assistance":
      return "ON_HOLD";
    case "needs_approval":
    case "operational_approval":
    case "provide_feedback":
      return "IN_PROGRESS";
    default:
      return "NOT_STARTED";
  }
}

function mapToMytoolStatus(status: string): string {
  const canonical = toCanonicalStatus(status);
  switch (canonical) {
    case "in_progress":
      return "in_progress";
    case "complete":
    case "qc_approved":
      return "done";
    case "hold":
    case "projects_assistance":
      return "blocked";
    case "needs_approval":
    case "operational_approval":
    case "provide_feedback":
      return "in_progress";
    case "to_do":
      return "planned";
    default:
      return "inbox";
  }
}
