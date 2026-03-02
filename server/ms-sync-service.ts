import { db } from "./db";
import { msObjects, msAccounts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  getCalendarEvents,
  listMessages,
  listFlaggedMessages,
  getJoinedTeams,
  getMyChats,
  isOutlookConfigured,
} from "./outlook";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const syncTimers: Map<number, NodeJS.Timeout> = new Map();
let globalSyncTimer: NodeJS.Timeout | null = null;

interface SyncResult {
  type: string;
  synced: number;
  errors: string[];
}

export async function syncUserCalendar(userId: number): Promise<SyncResult> {
  const result: SyncResult = { type: "calendar", synced: 0, errors: [] };

  try {
    if (!isOutlookConfigured()) {
      result.errors.push("Outlook connector not configured");
      return result;
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const events = await getCalendarEvents(formatDate(startDate), formatDate(endDate));

    for (const evt of events) {
      try {
        await db.execute(sql`
          INSERT INTO ms_objects (user_id, type, ms_id, subject_or_title, sender_or_organizer, web_link,
            received_or_start_datetime, end_datetime, action_required, importance, last_synced_at, metadata)
          VALUES (${userId}, 'event', ${evt.id}, ${evt.subject}, ${evt.organizer},
            ${`https://outlook.office365.com/calendar/item/${encodeURIComponent(evt.id)}`},
            ${evt.start ? new Date(evt.start) : null}, ${evt.end ? new Date(evt.end) : null},
            false, ${evt.showAs === "busy" ? "high" : "normal"}, NOW(),
            ${JSON.stringify({ isAllDay: evt.isAllDay, location: evt.location, showAs: evt.showAs, isRecurring: evt.isRecurring })}
          )
          ON CONFLICT (user_id, type, ms_id)
          DO UPDATE SET
            subject_or_title = EXCLUDED.subject_or_title,
            sender_or_organizer = EXCLUDED.sender_or_organizer,
            received_or_start_datetime = EXCLUDED.received_or_start_datetime,
            end_datetime = EXCLUDED.end_datetime,
            importance = EXCLUDED.importance,
            metadata = EXCLUDED.metadata,
            last_synced_at = NOW()
        `);
        result.synced++;
      } catch (err: any) {
        result.errors.push(`Event ${evt.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    result.errors.push(`Calendar sync failed: ${err.message}`);
  }

  return result;
}

export async function syncUserEmail(userId: number): Promise<SyncResult> {
  const result: SyncResult = { type: "email", synced: 0, errors: [] };

  try {
    if (!isOutlookConfigured()) {
      result.errors.push("Outlook connector not configured");
      return result;
    }

    const messages = await listMessages({ top: 50, folder: "inbox" });
    const flagged = await listFlaggedMessages(20);

    const flaggedIds = new Set(flagged.map((f: any) => f.id));

    const allMessages = [...messages];
    for (const f of flagged) {
      if (!allMessages.find((m: any) => m.id === f.id)) {
        allMessages.push(f);
      }
    }

    for (const msg of allMessages) {
      try {
        const isFlagged = flaggedIds.has(msg.id);
        const isImportant = isFlagged || !msg.isRead;

        await db.execute(sql`
          INSERT INTO ms_objects (user_id, type, ms_id, subject_or_title, preview, sender_or_organizer,
            web_link, received_or_start_datetime, action_required, is_read, importance, last_synced_at, metadata)
          VALUES (${userId}, 'email', ${msg.id}, ${msg.subject}, ${msg.snippet}, ${msg.sender},
            ${msg.webLink}, ${msg.receivedAt ? new Date(msg.receivedAt) : null},
            ${isFlagged}, ${msg.isRead}, ${isImportant ? "high" : "normal"}, NOW(),
            ${JSON.stringify({ senderEmail: msg.senderEmail, hasAttachments: msg.hasAttachments, flagStatus: (msg as any).flagStatus || null })}
          )
          ON CONFLICT (user_id, type, ms_id)
          DO UPDATE SET
            subject_or_title = EXCLUDED.subject_or_title,
            preview = EXCLUDED.preview,
            sender_or_organizer = EXCLUDED.sender_or_organizer,
            action_required = EXCLUDED.action_required,
            is_read = EXCLUDED.is_read,
            importance = EXCLUDED.importance,
            metadata = EXCLUDED.metadata,
            last_synced_at = NOW()
        `);
        result.synced++;
      } catch (err: any) {
        result.errors.push(`Email ${msg.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    result.errors.push(`Email sync failed: ${err.message}`);
  }

  return result;
}

export async function syncUserTeams(userId: number): Promise<SyncResult> {
  const result: SyncResult = { type: "teams", synced: 0, errors: [] };

  try {
    if (!isOutlookConfigured()) {
      result.errors.push("Outlook connector not configured");
      return result;
    }

    const chats = await getMyChats(30);

    for (const chat of chats) {
      try {
        const memberNames = (chat.members || []).map((m: any) => m.displayName).filter(Boolean).join(", ");
        const title = chat.topic || memberNames || "Chat";

        await db.execute(sql`
          INSERT INTO ms_objects (user_id, type, ms_id, subject_or_title, preview, sender_or_organizer,
            web_link, received_or_start_datetime, action_required, importance, last_synced_at, metadata)
          VALUES (${userId}, 'teams', ${chat.id}, ${title}, ${memberNames},
            ${chat.chatType === "oneOnOne" ? memberNames : title},
            ${`https://teams.microsoft.com/l/chat/${chat.id}`},
            ${chat.lastUpdatedDateTime ? new Date(chat.lastUpdatedDateTime) : null},
            false, 'normal', NOW(),
            ${JSON.stringify({ chatType: chat.chatType, memberCount: (chat.members || []).length })}
          )
          ON CONFLICT (user_id, type, ms_id)
          DO UPDATE SET
            subject_or_title = EXCLUDED.subject_or_title,
            preview = EXCLUDED.preview,
            received_or_start_datetime = EXCLUDED.received_or_start_datetime,
            metadata = EXCLUDED.metadata,
            last_synced_at = NOW()
        `);
        result.synced++;
      } catch (err: any) {
        result.errors.push(`Chat ${chat.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    result.errors.push(`Teams sync failed: ${err.message}`);
  }

  return result;
}

export async function syncAllForUser(userId: number): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  const calResult = await syncUserCalendar(userId);
  results.push(calResult);

  const emailResult = await syncUserEmail(userId);
  results.push(emailResult);

  const teamsResult = await syncUserTeams(userId);
  results.push(teamsResult);

  console.log(`[MS Sync] User ${userId}: calendar=${calResult.synced}, email=${emailResult.synced}, teams=${teamsResult.synced}`);

  return results;
}

export async function getSyncStatus(userId: number): Promise<{
  lastSync: string | null;
  objectCounts: Record<string, number>;
  connected: boolean;
}> {
  try {
    const account = await db.select().from(msAccounts).where(eq(msAccounts.userId, userId)).limit(1);
    const connected = account.length > 0 && account[0].status === "active";

    const counts = await db.execute(sql`
      SELECT type, COUNT(*) as count
      FROM ms_objects
      WHERE user_id = ${userId}
      GROUP BY type
    `);

    const objectCounts: Record<string, number> = {};
    for (const row of (counts as any).rows || counts || []) {
      objectCounts[row.type] = parseInt(row.count, 10);
    }

    const lastSyncRow = await db.execute(sql`
      SELECT MAX(last_synced_at) as last_sync
      FROM ms_objects
      WHERE user_id = ${userId}
    `);

    const lastSync = ((lastSyncRow as any).rows?.[0] || (lastSyncRow as any)[0])?.last_sync || null;

    return { lastSync, objectCounts, connected };
  } catch (err: any) {
    return { lastSync: null, objectCounts: {}, connected: false };
  }
}

async function ensureAllUsersHaveMsAccounts(): Promise<void> {
  try {
    if (!isOutlookConfigured()) return;

    const allUsers = await db.execute(sql`SELECT id, username, email, name FROM users`);
    const rows = (allUsers as any).rows || allUsers || [];
    const existingAccounts = await db.select({ userId: msAccounts.userId }).from(msAccounts);
    const existingUserIds = new Set(existingAccounts.map(a => a.userId));

    let created = 0;
    for (const user of rows) {
      if (!existingUserIds.has(user.id)) {
        try {
          await db.insert(msAccounts).values({
            userId: user.id,
            tenantId: process.env.AZURE_TENANT_ID || "",
            msUserId: `local-${user.id}`,
            email: user.email || user.username || "",
            displayName: user.name || user.username || `User ${user.id}`,
            status: "active",
          }).onConflictDoNothing();
          created++;
        } catch { }
      }
    }
    if (created > 0) {
      console.log(`[MS Sync] Auto-created ${created} ms_account entries for existing users`);
    }
  } catch (err: any) {
    console.warn("[MS Sync] Could not auto-create ms_accounts:", err.message);
  }
}

export function startPeriodicSync(): void {
  if (globalSyncTimer) return;

  ensureAllUsersHaveMsAccounts();

  globalSyncTimer = setInterval(async () => {
    try {
      const activeAccounts = await db.select().from(msAccounts).where(eq(msAccounts.status, "active"));

      for (const account of activeAccounts) {
        try {
          await syncAllForUser(account.userId);
        } catch (err: any) {
          console.warn(`[MS Sync] Periodic sync failed for user ${account.userId}:`, err.message);
        }
      }
    } catch (err: any) {
      console.warn("[MS Sync] Periodic sync error:", err.message);
    }
  }, SYNC_INTERVAL_MS);

  console.log(`[MS Sync] Periodic sync started (every ${SYNC_INTERVAL_MS / 60000} minutes)`);
}

export function stopPeriodicSync(): void {
  if (globalSyncTimer) {
    clearInterval(globalSyncTimer);
    globalSyncTimer = null;
  }
}
