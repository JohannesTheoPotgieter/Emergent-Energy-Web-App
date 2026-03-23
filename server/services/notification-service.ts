import { db } from "../db";
import { notifications, notificationThrottle } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

interface CreateNotificationParams {
  recipientUserId: number;
  eventType: string;
  title: string;
  body?: string;
  projectName?: string;
  projectId?: number;
  linkedTaskId?: number;
  relatedEntityType?: string;
  relatedEntityId?: number;
}

/**
 * Create a notification for a user, with throttle check to prevent spam.
 * Returns the created notification or null if throttled.
 */
export async function createNotification(params: CreateNotificationParams) {
  // Throttle: don't send duplicate notifications within 10 minutes
  if (params.relatedEntityType && params.relatedEntityId) {
    const recent = await db
      .select()
      .from(notificationThrottle)
      .where(and(
        eq(notificationThrottle.recipientUserId, params.recipientUserId),
        eq(notificationThrottle.eventType, params.eventType),
        eq(notificationThrottle.entityType, params.relatedEntityType),
        eq(notificationThrottle.entityId, params.relatedEntityId),
        sql`${notificationThrottle.lastSentAt} > NOW() - INTERVAL '10 minutes'`,
      ))
      .limit(1);

    if (recent.length > 0) return null; // throttled

    // Upsert throttle record using the composite unique constraint
    await db.execute(sql`
      INSERT INTO notification_throttle (recipient_user_id, event_type, entity_type, entity_id, last_sent_at)
      VALUES (${params.recipientUserId}, ${params.eventType}, ${params.relatedEntityType}, ${params.relatedEntityId}, NOW())
      ON CONFLICT (recipient_user_id, event_type, entity_type, entity_id) DO UPDATE SET last_sent_at = NOW()
    `);
  }

  const [notification] = await db.insert(notifications).values({
    recipientUserId: params.recipientUserId,
    eventType: params.eventType,
    title: params.title,
    body: params.body || null,
    projectName: params.projectName || null,
    projectId: params.projectId || null,
    linkedTaskId: params.linkedTaskId || null,
    changeDetails: params.relatedEntityType && params.relatedEntityId
      ? JSON.stringify({ entityType: params.relatedEntityType, entityId: params.relatedEntityId })
      : null,
  }).returning();

  return notification;
}

/**
 * Notify multiple users about a PD event.
 */
export async function notifyUsers(userIds: number[], params: Omit<CreateNotificationParams, "recipientUserId">) {
  const results = [];
  for (const userId of userIds) {
    const result = await createNotification({ ...params, recipientUserId: userId });
    if (result) results.push(result);
  }
  return results;
}

// ---- PD-specific notification triggers ----

export async function notifyTicketAssigned(ticketId: number, assigneeUserId: number, projectName: string, ticketTitle: string) {
  return createNotification({
    recipientUserId: assigneeUserId,
    eventType: "pd_ticket_assigned",
    title: `PD Ticket assigned to you: ${ticketTitle}`,
    body: `You've been assigned to a PD ticket for ${projectName}.`,
    projectName,
    relatedEntityType: "pd_ticket",
    relatedEntityId: ticketId,
  });
}

export async function notifyHandoverSubmitted(projectId: number, projectName: string, pmUserIds: number[]) {
  return notifyUsers(pmUserIds, {
    eventType: "handover_submitted",
    title: `Handover submitted for review: ${projectName}`,
    body: `A PD to PM handover has been submitted and requires your review.`,
    projectName,
    projectId,
    relatedEntityType: "handover",
    relatedEntityId: projectId,
  });
}

export async function notifyHandoverAccepted(projectId: number, projectName: string, pdOwnerUserIds: number[]) {
  return notifyUsers(pdOwnerUserIds, {
    eventType: "handover_accepted",
    title: `Handover accepted: ${projectName}`,
    body: `The PD to PM handover for ${projectName} has been accepted. Project is now in PM Active phase.`,
    projectName,
    projectId,
    relatedEntityType: "handover",
    relatedEntityId: projectId,
  });
}

export async function notifyHandoverRejected(projectId: number, projectName: string, reason: string, pdOwnerUserIds: number[]) {
  return notifyUsers(pdOwnerUserIds, {
    eventType: "handover_rejected",
    title: `Handover rejected: ${projectName}`,
    body: `Rejection reason: ${reason}`,
    projectName,
    projectId,
    relatedEntityType: "handover",
    relatedEntityId: projectId,
  });
}

export async function notifyEngineerAssigned(taskId: number, engineerUserId: number, projectName: string, taskTitle: string) {
  return createNotification({
    recipientUserId: engineerUserId,
    eventType: "engineer_task_assigned",
    title: `Feasibility work assigned: ${taskTitle}`,
    body: `You've been assigned to an engineering task for ${projectName}.`,
    projectName,
    linkedTaskId: taskId,
    relatedEntityType: "work_item",
    relatedEntityId: taskId,
  });
}
