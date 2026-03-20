import { db } from "./db";
import { eq, and, isNull, sql, asc, desc, inArray } from "drizzle-orm";
import { workItems, workItemAssignments, projectInfo, type WorkItem, type WorkItemAssignment } from "@shared/schema";
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
  const tasks = await queryWorkItems({ projectId });
  const ids = tasks.map(t => t.id);
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

  return mapWorkItemsToNormalizedFormat(items, projectName);
}

function mapWorkItemsToNormalizedFormat(items: WorkItem[], projectName: string, forceWorkstream?: string): any[] {
  const parentIdToWbs = new Map<number, string>();
  for (const wi of items) {
    if (wi.wbsCode) parentIdToWbs.set(wi.id, wi.wbsCode);
  }

  return items.map((wi: WorkItem) => {
    const parentTaskNo = wi.parentId ? (parentIdToWbs.get(wi.parentId) || null) : null;
    const indentLevel = wi.wbsCode ? (wi.wbsCode.split('.').length - 1) : 0;

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
      actualStartDate: wi.actualStart || wi.startDate,
      actualEndDate: wi.actualEnd || wi.endDate,
      actualDurationDays: wi.actualDuration || wi.duration,
      owner: null,
      assigneeUserId: wi.ownerUserId,
      status: wi.status,
      pctComplete: wi.percentComplete != null ? wi.percentComplete : null,
      expectedPctComplete: null,
      comment: wi.description,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
      parentTaskNo,
      parentWorkItemId: wi.parentId || null,
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
      assigneeUserIds: assignments.filter(a => a.workItemId === wi.id).map(a => a.userId),
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

  const projectIds: number[] = Array.from(new Set(items.map((i) => i.projectId).filter((id): id is number => typeof id === "number")));
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
  return items.map(wi => {
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
      actualStart: wi.actualStart || wi.startDate,
      actualEnd: wi.actualEnd || wi.endDate,
      actualPctComplete: wi.percentComplete,
      expectedPctComplete: null,
      durationDays: wi.duration,
      isMilestone: wi.isMilestone === true || wi.type === "milestone",
    };
  });
}

export function mapFromOpsStatus(opsStatus: string): string {
  const map: Record<string, string> = {
    "TO DO": "Not Started",
    "IN PROGRESS": "In Progress",
    "COMPLETE": "Complete",
    "HOLD": "On Hold",
    "NEEDS APPROVAL": "In Progress",
    "QC APPROVED": "Complete",
    "PROVIDE FEEDBACK": "In Progress",
    "OPERATIONAL APPROVAL": "In Progress",
    "PROJECTS ASSISTANCE": "In Progress",
  };
  return map[opsStatus] || "Not Started";
}

export function mapToOpsStatus(wiStatus: string): string {
  const map: Record<string, string> = {
    "Not Started": "TO DO",
    "In Progress": "IN PROGRESS",
    "Complete": "COMPLETE",
    "Done": "COMPLETE",
    "On Hold": "HOLD",
    "Blocked": "HOLD",
  };
  return map[wiStatus] || "TO DO";
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
}): Promise<any> {
  const [item] = await db.insert(workItems).values({
    projectId: data.projectId ?? null,
    title: data.title,
    description: data.description ?? null,
    status: data.status || "Not Started",
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
};

export async function listEngineeringWorkItems(options: EngineeringListOptions = {}): Promise<any[]> {
  const conditions = [
    eq(workItems.workstream, "ENG"),
    isNull(workItems.deletedAt),
  ];

  if (options.status) conditions.push(eq(workItems.status, mapFromOpsStatus(options.status)));
  if (options.phase) conditions.push(eq(workItems.phase, options.phase));
  if (options.ownerUserId) conditions.push(eq(workItems.ownerUserId, options.ownerUserId));
  if (options.projectId) conditions.push(eq(workItems.projectId, options.projectId));
  if (options.projectName) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM project_info pi
      WHERE pi.id = ${workItems.projectId}
      AND pi.project_name = ${options.projectName}
    )` as any);
  }

  const items = await db.select().from(workItems).where(and(...conditions)).orderBy(asc(workItems.sortOrder), asc(workItems.id));

  const itemIds = items.map((i) => i.id);
  const assignments = itemIds.length > 0
    ? await db.select().from(workItemAssignments).where(sql`${workItemAssignments.workItemId} IN (${sql.join(itemIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const assigneeMap = new Map<number, number[]>();
  for (const row of assignments) {
    const list = assigneeMap.get(row.workItemId) || [];
    if (row.role === "ASSIGNEE" || row.role === "OWNER") list.push(row.userId);
    assigneeMap.set(row.workItemId, list);
  }

  const projectRows = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  const projectMap = new Map(projectRows.map((row) => [row.id, row.projectName]));

  return items.map((wi) => ({
    id: wi.id,
    projectId: wi.projectId,
    projectName: wi.projectId ? projectMap.get(wi.projectId) || null : null,
    importedTaskId: null,
    taskNumber: wi.wbsCode,
    parentTaskId: wi.parentId,
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
    completedAt: wi.completedAt || (wi.status === "Complete" ? wi.updatedAt : null),
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

export async function getEngineeringWorkItemById(id: number): Promise<any | null> {
  const items = await listEngineeringWorkItems({});
  return items.find((item) => item.id === id) || null;
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

  return updated;
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
      status: "Not Started",
      priority: t.priority,
      phase: t.phase,
      createdBy,
      sortOrder: (i + 1) * 10,
    }).returning();
    created.push(item);
  }

  return created;
}

function mapToEngStatus(status: string): string {
  const map: Record<string, string> = {
    "Not Started": "NOT_STARTED",
    "In Progress": "IN_PROGRESS",
    "Complete": "COMPLETE",
    "Done": "COMPLETE",
    "On Hold": "ON_HOLD",
    "Blocked": "ON_HOLD",
  };
  return map[status] || "NOT_STARTED";
}

function mapToMytoolStatus(status: string): string {
  const map: Record<string, string> = {
    "Not Started": "inbox",
    "In Progress": "in_progress",
    "Complete": "done",
    "Done": "done",
    "On Hold": "blocked",
    "Blocked": "blocked",
    "Planned": "planned",
  };
  return map[status] || "inbox";
}
