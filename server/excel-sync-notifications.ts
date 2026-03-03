import { db } from "./db";
import { eq, and, gt, inArray } from "drizzle-orm";
import { notifications, notificationThrottle, users } from "@shared/schema";

const EXCEL_SYNC_ROLES = ['PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'COO_ADMIN', 'CEO_ADMIN'];
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

function hashEntityId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function sendExcelSyncNotification(opts: {
  projectName: string;
  changedByUserId: number;
  changeType: string;
  changeDescription: string;
  details?: Record<string, any>;
}) {
  try {
    const recipients = await db.select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(inArray(users.role, EXCEL_SYNC_ROLES));

    if (recipients.length === 0) return;

    const [changedByUser] = await db.select({ name: users.name }).from(users)
      .where(eq(users.id, opts.changedByUserId));
    const changedByName = changedByUser?.name || "Unknown";

    const entityId = hashEntityId(`${opts.projectName}_${opts.changeType}`);
    const detailsJson = JSON.stringify({
      projectName: opts.projectName,
      changeType: opts.changeType,
      changedBy: changedByName,
      description: opts.changeDescription,
      details: opts.details || {},
      timestamp: new Date().toISOString(),
    });

    const projectDisplay = opts.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

    for (const recipient of recipients) {
      if (recipient.id === opts.changedByUserId) continue;

      const existing = await db.select().from(notificationThrottle)
        .where(and(
          eq(notificationThrottle.recipientUserId, recipient.id),
          eq(notificationThrottle.eventType, "excel_sync_confirmation"),
          eq(notificationThrottle.entityType, "excel_sync"),
          eq(notificationThrottle.entityId, entityId),
          gt(notificationThrottle.lastSentAt, new Date(Date.now() - DEDUP_WINDOW_MS))
        ));

      if (existing.length > 0) continue;

      await db.insert(notifications).values({
        recipientUserId: recipient.id,
        eventType: "excel_sync_confirmation",
        title: `Excel sync needed: ${projectDisplay}`,
        body: `${changedByName} made changes (${opts.changeType.replace(/_/g, " ")}). ${opts.changeDescription} Please confirm you have captured this in the Excel tracker.`,
        projectName: opts.projectName,
        requiresConfirmation: true,
        changeDetails: detailsJson,
      });

      await db.insert(notificationThrottle).values({
        recipientUserId: recipient.id,
        eventType: "excel_sync_confirmation",
        entityType: "excel_sync",
        entityId,
      }).onConflictDoNothing();
    }
  } catch (err: any) {
    console.warn("[excel-sync-notify] Failed to send notification:", err.message);
  }
}
