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

async function getUserToken(userId: number): Promise<string | null> {
  try {
    const { getSsoTokenForUser } = await import("./ms-account-service");
    return await getSsoTokenForUser(userId);
  } catch {
    return null;
  }
}

export async function syncUserCalendar(userId: number): Promise<SyncResult> {
  const result: SyncResult = { type: "calendar", synced: 0, errors: [] };

  try {
    const ssoToken = await getUserToken(userId);
    if (!ssoToken && !isOutlookConfigured()) {
      result.errors.push("No SSO token or Outlook connector configured for calendar sync");
      return result;
    }
    if (!ssoToken) {
      return result;
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const events = await getCalendarEvents(formatDate(startDate), formatDate(endDate), ssoToken);

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
    const ssoToken = await getUserToken(userId);
    if (!ssoToken && !isOutlookConfigured()) {
      result.errors.push("No SSO token or Outlook connector configured for email sync");
      return result;
    }
    if (!ssoToken) {
      return result;
    }

    const messages = await listMessages({ top: 50, folder: "inbox" }, ssoToken);
    let flagged: any[] = [];
    try {
      flagged = await listFlaggedMessages(20, ssoToken);
    } catch (err: any) {
      console.log(`[MS Sync] Flagged messages fetch failed (non-fatal): ${err.message}`);
    }

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
    const ssoToken = await getUserToken(userId);
    if (!ssoToken) {
      result.errors.push("No SSO token for Teams sync — user must sign in with Microsoft");
      return result;
    }

    const chats = await getMyChats(30, ssoToken);

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
  counts: { events: number; emails: number; teams: number };
}> {
  const [lastSyncRow] = await db.execute(sql`
    SELECT MAX(last_synced_at) as last_sync FROM ms_objects WHERE user_id = ${userId}
  `) as any[];

  const [countRow] = await db.execute(sql`
    SELECT
      COUNT(CASE WHEN type = 'event' THEN 1 END) as events,
      COUNT(CASE WHEN type = 'email' THEN 1 END) as emails,
      COUNT(CASE WHEN type = 'teams' THEN 1 END) as teams
    FROM ms_objects WHERE user_id = ${userId}
  `) as any[];

  return {
    lastSync: lastSyncRow?.last_sync?.toISOString?.() || null,
    counts: {
      events: parseInt(countRow?.events || "0"),
      emails: parseInt(countRow?.emails || "0"),
      teams: parseInt(countRow?.teams || "0"),
    },
  };
}

export function startPeriodicSync() {
  if (globalSyncTimer) {
    clearInterval(globalSyncTimer);
  }

  globalSyncTimer = setInterval(async () => {
    try {
      const accounts = await db.select().from(msAccounts).where(
        and(eq(msAccounts.status, "active"), isNotNull(msAccounts.ssoAccessToken))
      );
      for (const account of accounts) {
        try {
          await syncAllForUser(account.userId);
        } catch (err: any) {
          console.error(`[MS Sync] Periodic sync failed for user ${account.userId}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[MS Sync] Periodic sync loop error:", err.message);
    }
  }, SYNC_INTERVAL_MS);

  console.log("[MS Sync] Periodic sync started (every 15 minutes)");
}

export function stopPeriodicSync() {
  if (globalSyncTimer) {
    clearInterval(globalSyncTimer);
    globalSyncTimer = null;
  }
}
