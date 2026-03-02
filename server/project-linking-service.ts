import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { msObjects, projectLinks, projectInfo, mytoolTasks, operationalTasks, users } from "@shared/schema";

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];
const MANAGER_ROLES = [...ADMIN_ROLES, "PROGRAM_MANAGER", "ENGINEERING_MANAGER"];

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

  return { msObject: updatedObj, projectLink: link };
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

  const items = await db
    .select()
    .from(msObjects)
    .where(eq(msObjects.linkedProjectId, projectId))
    .orderBy(desc(msObjects.receivedOrStartDatetime));

  if (isAdmin) return items;

  return items.filter((item: any) => item.userId === userId);
}

export async function getUserMsObjects(
  userId: number,
  type?: string,
  limit?: number
): Promise<any[]> {
  const conditions = [eq(msObjects.userId, userId)];

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
