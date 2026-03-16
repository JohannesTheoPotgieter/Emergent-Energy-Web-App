import { db } from "./db";
import { eq, and, ne, desc, sql, inArray } from "drizzle-orm";
import {
  msObjects,
  projectLinks,
  projectInfo,
  mytoolTasks,
  operationalTasks,
  users,
  communicationFollowUps,
  projectCommunicationTimelineEvents,
  qcChecklist,
  qcItemEvidence,
  qcItemInstance,
  qcTemplateGroup,
  qcTemplateItem,
  qcTemplatePhase,
} from "@shared/schema";

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];
const MANAGER_ROLES = [...ADMIN_ROLES, "PROGRAM_MANAGER", "ENGINEERING_MANAGER"];
type OperationalTaskRow = typeof operationalTasks.$inferSelect;
type QualityItemRow = typeof qcItemInstance.$inferSelect;
type QualityChecklistRow = typeof qcChecklist.$inferSelect;
type QualityTemplateItemRow = typeof qcTemplateItem.$inferSelect;
type QualityTemplateGroupRow = typeof qcTemplateGroup.$inferSelect;
type QualityTemplatePhaseRow = typeof qcTemplatePhase.$inferSelect;
type QualityEvidenceRow = typeof qcItemEvidence.$inferSelect;

function uniqueNumberList(values: Array<number | null | undefined>): number[] {
  const result = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result.add(value);
    }
  }
  return Array.from(result);
}

async function canAccessProject(userId: number, projectId: number): Promise<boolean> {
  const [user] = await db.select({ role: users.role, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user) return false;
  if (MANAGER_ROLES.includes(user.role)) return true;

  const [project] = await db.select({
    pm: projectInfo.pm,
    pd: projectInfo.pd,
    pmUserId: projectInfo.pmUserId,
    pdUserId: projectInfo.pdUserId,
  }).from(projectInfo).where(eq(projectInfo.id, projectId));
  if (!project) return false;

  if (project.pmUserId === userId || project.pdUserId === userId) return true;
  if (project.pm === user.name || project.pd === user.name) return true;
  return false;
}

export async function tagToProject(
  msObjectId: number,
  projectId: number,
  userId: number,
  note?: string
): Promise<{ msObject: any; projectLink: any }> {
  const [obj] = await db.select().from(msObjects).where(eq(msObjects.id, msObjectId));
  if (!obj) throw new Error("MS object not found");

  if (obj.userId !== userId) {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new Error("You can only tag your own items");
    }
  }

  const hasAccess = await canAccessProject(userId, projectId);
  if (!hasAccess) throw new Error("You don't have access to this project");

  const [project] = await db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.id, projectId));
  if (!project) throw new Error("Project not found");

  const [updatedObj] = await db
    .update(msObjects)
    .set({ linkedProjectId: projectId })
    .where(eq(msObjects.id, msObjectId))
    .returning();

  const [link] = await db
    .insert(projectLinks)
    .values({
      msObjectId,
      projectId,
      linkedByUserId: userId,
      note: note || null,
    })
    .returning();

  await createProjectTimelineEvent({
    projectId,
    msObjectId,
    actorUserId: userId,
    eventType: obj.type === "event" ? "meeting_linked" : obj.type === "email" ? "email_linked" : "communication_linked",
    eventTitle: `Linked ${obj.type} to project`,
    eventDetail: obj.subjectOrTitle || undefined,
  });

  return { msObject: updatedObj, projectLink: link };
}

export function buildFollowUpDedupeKey(msObjectId: number, projectId: number | null, title: string): string {
  return `${msObjectId}:${projectId ?? "none"}:${title.trim().toLowerCase()}`;
}

export async function createProjectTimelineEvent(params: {
  projectId: number;
  msObjectId?: number;
  eventType: string;
  eventTitle: string;
  eventDetail?: string;
  relatedTaskId?: number;
  actorUserId: number;
}) {
  await db.insert(projectCommunicationTimelineEvents).values({
    projectId: params.projectId,
    msObjectId: params.msObjectId ?? null,
    eventType: params.eventType,
    eventTitle: params.eventTitle,
    eventDetail: params.eventDetail ?? null,
    relatedTaskId: params.relatedTaskId ?? null,
    actorUserId: params.actorUserId,
  });
}

export async function createFollowUpTaskFromCommunication(input: {
  msObjectId: number;
  userId: number;
  title?: string;
  dueAt?: string;
  notes?: string;
}) {
  const [obj] = await db.select().from(msObjects).where(eq(msObjects.id, input.msObjectId));
  if (!obj) throw new Error("MS object not found");
  if (obj.userId !== input.userId) throw new Error("You can only create follow-up tasks from your own items");

  const dedupeKey = buildFollowUpDedupeKey(input.msObjectId, obj.linkedProjectId ?? null, input.title || obj.subjectOrTitle || "Follow-up");
  const [existing] = await db.select().from(communicationFollowUps).where(eq(communicationFollowUps.dedupeKey, dedupeKey));
  if (existing) {
    throw new Error("Follow-up already exists for this communication");
  }

  const taskTitle = input.title || `Follow-up: ${obj.subjectOrTitle || "Communication"}`;
  const taskNotes = [
    input.notes || "",
    obj.webLink ? `Source: ${obj.webLink}` : "",
    obj.senderOrOrganizer ? `From/Organizer: ${obj.senderOrOrganizer}` : "",
  ].filter(Boolean).join("\n");

  if (obj.linkedProjectId) {
    const [project] = await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, obj.linkedProjectId));
    const [task] = await db.insert(operationalTasks).values({
      projectId: obj.linkedProjectId,
      projectName: project?.projectName || "Unknown",
      title: taskTitle,
      description: taskNotes || null,
      status: "TO DO",
      priority: "Med",
      ownerUserId: input.userId,
      createdBy: input.userId,
      dueDate: input.dueAt || null,
    }).returning();

    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    await db.insert(communicationFollowUps).values({
      msObjectId: obj.id,
      projectId: obj.linkedProjectId,
      taskId: task.id,
      taskType: "operational",
      dedupeKey,
      dueAt,
      reminderAt: dueAt,
      createdBy: input.userId,
    });

    await createProjectTimelineEvent({
      projectId: obj.linkedProjectId,
      msObjectId: obj.id,
      relatedTaskId: task.id,
      actorUserId: input.userId,
      eventType: "follow_up_created",
      eventTitle: "Follow-up task created from communication",
      eventDetail: taskTitle,
    });
    return { task, type: "operational" as const };
  }

  const [task] = await db.insert(mytoolTasks).values({
    ownerUserId: input.userId,
    title: taskTitle,
    notes: taskNotes || null,
    status: "inbox",
    priority: "normal",
    bucket: "company_ops",
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
  }).returning();

  await db.insert(communicationFollowUps).values({
    msObjectId: obj.id,
    projectId: null,
    taskId: task.id,
    taskType: "mytool",
    dedupeKey,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    reminderAt: input.dueAt ? new Date(input.dueAt) : null,
    createdBy: input.userId,
  });

  return { task, type: "mytool" as const };
}

export async function untagFromProject(
  msObjectId: number,
  userId: number
): Promise<void> {
  const [obj] = await db.select().from(msObjects).where(eq(msObjects.id, msObjectId));
  if (!obj) throw new Error("MS object not found");

  if (obj.userId !== userId) {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new Error("You can only untag your own items");
    }
  }

  await db
    .update(msObjects)
    .set({ linkedProjectId: null })
    .where(eq(msObjects.id, msObjectId));

  await db
    .delete(projectLinks)
    .where(eq(projectLinks.msObjectId, msObjectId));
}

export async function getProjectLinkedItems(
  projectId: number,
  userId: number
): Promise<any[]> {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!user) return [];

  const isAdmin = ADMIN_ROLES.includes(user.role);

  const projectLinkedItems = await db
    .select()
    .from(msObjects)
    .where(eq(msObjects.linkedProjectId, projectId));

  const items = isAdmin
    ? projectLinkedItems
    : projectLinkedItems.filter((item: any) => item.userId === userId);

  if (items.length === 0) return [];

  const linkedOperationalTaskIds = uniqueNumberList(items.map((item: any) => item.linkedTaskId));

  const taskRows: OperationalTaskRow[] = linkedOperationalTaskIds.length > 0
    ? await db.select().from(operationalTasks).where(inArray(operationalTasks.id, linkedOperationalTaskIds))
    : [];

  const taskMap = new Map(taskRows.map((task) => [task.id, task]));

  const linkedQualityItemIds = uniqueNumberList(taskRows.map((task) => task.linkedQualityItemInstanceId));

  const qualityItemRows: QualityItemRow[] = linkedQualityItemIds.length > 0
    ? await db.select().from(qcItemInstance).where(inArray(qcItemInstance.id, linkedQualityItemIds))
    : [];

  const checklistIds = uniqueNumberList(qualityItemRows.map((item) => item.checklistId));
  const templateItemIds = uniqueNumberList(qualityItemRows.map((item) => item.templateItemId));

  const checklistRows: QualityChecklistRow[] = checklistIds.length > 0
    ? await db.select().from(qcChecklist).where(inArray(qcChecklist.id, checklistIds))
    : [];
  const templateItemRows: QualityTemplateItemRow[] = templateItemIds.length > 0
    ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
    : [];

  const groupIds = uniqueNumberList(templateItemRows.map((item) => item.templateGroupId));
  const groupRows: QualityTemplateGroupRow[] = groupIds.length > 0
    ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
    : [];

  const phaseIds = uniqueNumberList(groupRows.map((group) => group.templatePhaseId));
  const phaseRows: QualityTemplatePhaseRow[] = phaseIds.length > 0
    ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.id, phaseIds))
    : [];

  const evidenceRows: QualityEvidenceRow[] = linkedQualityItemIds.length > 0
    ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, linkedQualityItemIds))
    : [];

  const checklistMap = new Map(checklistRows.map((row) => [row.id, row]));
  const templateItemMap = new Map(templateItemRows.map((row) => [row.id, row]));
  const groupMap = new Map(groupRows.map((row) => [row.id, row]));
  const phaseMap = new Map(phaseRows.map((row) => [row.id, row]));
  const qualityItemMap = new Map(qualityItemRows.map((row) => [row.id, row]));
  const evidenceCountMap = new Map<number, number>();

  for (const evidence of evidenceRows) {
    evidenceCountMap.set(
      evidence.itemInstanceId,
      (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1,
    );
  }

  return items
    .map((item: any) => {
      const task = item.linkedTaskId ? taskMap.get(item.linkedTaskId) || null : null;
      const qualityItem = task?.linkedQualityItemInstanceId
        ? qualityItemMap.get(task.linkedQualityItemInstanceId) || null
        : null;
      const checklist = qualityItem ? checklistMap.get(qualityItem.checklistId) || null : null;
      const templateItem = qualityItem ? templateItemMap.get(qualityItem.templateItemId) || null : null;
      const group = templateItem ? groupMap.get(templateItem.templateGroupId) || null : null;
      const phase = group ? phaseMap.get(group.templatePhaseId) || null : null;

      return {
        ...item,
        taskContext: task ? {
          id: task.id,
          title: task.title,
          projectId: task.projectId,
          projectName: task.projectName,
          linkedQualityItemInstanceId: task.linkedQualityItemInstanceId,
        } : null,
        qualityContext: qualityItem ? {
          itemInstanceId: qualityItem.id,
          checklistId: qualityItem.checklistId,
          projectName: checklist?.projectName || task?.projectName || null,
          itemName: templateItem?.itemName || "Unknown quality item",
          qmStatus: qualityItem.qmStatus,
          approved: qualityItem.approved,
          approvalComment: qualityItem.approvalComment,
          phaseId: phase?.id || null,
          phaseName: phase?.phaseName || null,
          evidenceCount: evidenceCountMap.get(qualityItem.id) || 0,
        } : null,
      };
    })
    .sort((a: any, b: any) => {
      const left = a.receivedOrStartDatetime ? new Date(a.receivedOrStartDatetime).getTime() : 0;
      const right = b.receivedOrStartDatetime ? new Date(b.receivedOrStartDatetime).getTime() : 0;
      return right - left;
    });
}

export async function getUserMsObjects(
  userId: number,
  type?: string,
  limit?: number
): Promise<any[]> {
  const conditions = [eq(msObjects.userId, userId), ne(msObjects.dismissed, true)];

  if (type) {
    conditions.push(eq(msObjects.type, type as any));
  }

  const query = db
    .select()
    .from(msObjects)
    .where(and(...conditions))
    .orderBy(desc(msObjects.receivedOrStartDatetime));

  if (limit) {
    return query.limit(limit);
  }

  return query;
}

export async function convertToTask(
  msObjectId: number,
  userId: number,
  targetProjectId?: number
): Promise<{ task: any; type: "mytool" | "operational" }> {
  const [obj] = await db.select().from(msObjects).where(eq(msObjects.id, msObjectId));
  if (!obj) throw new Error("MS object not found");

  if (obj.userId !== userId) {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new Error("You can only convert your own items");
    }
  }

  const title = obj.subjectOrTitle || "Task from Microsoft";
  const description = [
    obj.preview || "",
    obj.webLink ? `\n\nSource: ${obj.webLink}` : "",
    obj.senderOrOrganizer ? `\nFrom: ${obj.senderOrOrganizer}` : "",
  ].join("").trim();

  if (targetProjectId) {
    const [targetProject] = await db
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.id, targetProjectId));
    if (!targetProject) throw new Error("Target project not found");

    const hasAccess = await canAccessProject(userId, targetProjectId);
    if (!hasAccess) throw new Error("You don't have access to this project");
  }

  const effectiveProjectId = targetProjectId || obj.linkedProjectId;

  if (effectiveProjectId) {
    if (targetProjectId && !obj.linkedProjectId) {
      await db
        .update(msObjects)
        .set({ linkedProjectId: targetProjectId })
        .where(eq(msObjects.id, msObjectId));
    }

    const [project] = await db
      .select({ projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(eq(projectInfo.id, effectiveProjectId));

    const [task] = await db
      .insert(operationalTasks)
      .values({
        projectId: effectiveProjectId,
        projectName: project?.projectName || "Unknown",
        title,
        description,
        status: "TO DO",
        priority: "Med",
        ownerUserId: userId,
        createdBy: userId,
      })
      .returning();

    await db
      .update(msObjects)
      .set({ linkedTaskId: task.id })
      .where(eq(msObjects.id, msObjectId));

    return { task, type: "operational" };
  } else {
    const [task] = await db
      .insert(mytoolTasks)
      .values({
        ownerUserId: userId,
        title,
        notes: description,
        status: "inbox",
        priority: "normal",
        bucket: "personal",
      })
      .returning();

    await db
      .update(msObjects)
      .set({ linkedTaskId: task.id })
      .where(eq(msObjects.id, msObjectId));

    return { task, type: "mytool" };
  }
}
