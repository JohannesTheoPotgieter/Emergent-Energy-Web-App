import { db } from "./db";
import { eq, and, isNull, sql, asc, desc } from "drizzle-orm";
import { workItems, workItemAssignments, type WorkItem, type WorkItemAssignment } from "@shared/schema";
import { getFeatureFlag } from "./lib/feature-flags";

export const WORK_ITEMS_FLAG = "canonical_work_items_v1";

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
        eq(workItems.legacyTable, "normalized_plan_tasks"),
        isNull(workItems.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM project_info pi
          WHERE pi.id = ${workItems.projectId}
          AND pi.project_name = ${projectName}
        )`
      )
    )
    .orderBy(asc(workItems.id));

  const parentIdToWbs = new Map<number, string>();
  for (const wi of items) {
    if (wi.wbsCode) parentIdToWbs.set(wi.id, wi.wbsCode);
  }

  return items.map((wi: WorkItem) => {
    const parentTaskNo = wi.parentId ? (parentIdToWbs.get(wi.parentId) || null) : null;
    const indentLevel = wi.wbsCode ? (wi.wbsCode.split('.').length - 1) : 0;

    return {
      id: wi.legacyId ?? wi.id,
      projectId: wi.projectId,
      projectName: projectName,
      taskName: wi.title,
      taskNo: wi.wbsCode,
      phase: wi.type,
      startDate: wi.startDate,
      endDate: wi.endDate,
      durationDays: wi.duration,
      actualStartDate: wi.startDate,
      actualEndDate: wi.endDate,
      actualDurationDays: wi.duration,
      owner: null,
      assigneeUserId: wi.ownerUserId,
      status: wi.status,
      pctComplete: wi.percentComplete != null ? wi.percentComplete : null,
      expectedPctComplete: null,
      comment: wi.description,
      isMilestone: wi.type === "milestone",
      parentTaskNo,
      indentLevel,
      sourceSheet: null,
      sourceRow: null,
      importRunId: wi.legacyId ?? 0,
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
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

  const items = await db
    .select()
    .from(workItems)
    .where(and(...conditions))
    .orderBy(desc(workItems.createdAt));

  return items.map((wi: WorkItem) => ({
    id: wi.legacyId ?? wi.id,
    projectId: wi.projectId,
    projectName: null,
    title: wi.title,
    description: wi.description,
    lifecyclePhaseTag: "EXECUTION",
    status: mapToEngStatus(wi.status),
    requiresQcApproval: false,
    requiresOpsApproval: false,
    qcApprovedAt: null,
    qcApprovedByRole: null,
    opsApprovedAt: null,
    opsApprovedByRole: null,
    assigneeUserId: wi.ownerUserId,
    assigneeName: null,
    softDeletedAt: null,
    createdAt: wi.createdAt,
    updatedAt: wi.updatedAt,
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
  }));
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
