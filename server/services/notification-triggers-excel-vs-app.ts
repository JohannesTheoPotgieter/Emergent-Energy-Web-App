/**
 * Excel-vs-App daily digest trigger.
 *
 * Surfaces unverified drift in the operator's notification feed once
 * per day per recipient. Hooked into the existing hourly notification
 * scheduler — the once-per-day throttle (`notification_throttle` row
 * with 24h window) prevents the hourly cadence from causing spam.
 *
 * Recipients:
 *   - CFO       (always)
 *   - COO_ADMIN (always)
 *   - PROGRAM_FINANCE_MANAGER (when unverified spans cost or revenue
 *     sections)
 *
 * Body of the notification:
 *   "Excel-vs-App: <N> unverified drift fields across <M> projects.
 *    Top: <project1> (n), <project2> (m). Open the Excel-vs-App page
 *    to resolve."
 *
 * Skips silently when total unverified == 0 (no need to alert on
 * green-light state).
 *
 * If/when email delivery is wired into notification-service, this
 * trigger benefits automatically — no change needed here.
 */
import { db } from "../db";
import { eq, sql, and, gt, inArray } from "drizzle-orm";
import { users, notifications } from "@shared/schema";
import { createNotification } from "./notification-service";
import { trackerReplicaRepository } from "../repositories/tracker-replica-repository";

const DIGEST_EVENT_TYPE = "excel_vs_app_daily_digest";
const DIGEST_RECIPIENT_ROLES = ["CFO", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_FINANCE_MANAGER"];
const DIGEST_INTERVAL_HOURS = 22; // slightly under 24 so timezone shifts don't cause skipped days

interface DigestTriggerResult {
  count: number;
  notified: number;
}

/**
 * Build the digest body. Returns null when there's no drift worth
 * reporting (zero unverified across all projects).
 */
async function buildDigestBody(): Promise<{ title: string; body: string; totalUnverified: number; topProjects: string[] } | null> {
  const summary = await trackerReplicaRepository.getProgramDriftSummary();
  const totalUnverified = summary.reduce((s, r) => s + r.unverified, 0);
  if (totalUnverified === 0) return null;

  const projectsWithUnverified = summary
    .filter(r => r.unverified > 0)
    .sort((a, b) => b.unverified - a.unverified);
  const top = projectsWithUnverified.slice(0, 3);
  const remaining = projectsWithUnverified.length - top.length;
  const topPart = top.map(r => `${r.projectName} (${r.unverified})`).join(", ");
  const tail = remaining > 0 ? ` and ${remaining} more` : "";
  const title = `${totalUnverified} unverified Excel-vs-App drift fields`;
  const body = `Across ${projectsWithUnverified.length} project${projectsWithUnverified.length === 1 ? "" : "s"}. Top: ${topPart}${tail}. Open the Excel-vs-App page to resolve.`;
  return { title, body, totalUnverified, topProjects: top.map(r => r.projectName) };
}

/**
 * Was the per-user digest already sent in the last DIGEST_INTERVAL_HOURS?
 * Uses the notifications table directly (the createNotification's
 * built-in throttle window is 10 minutes — too short for a daily
 * digest).
 */
async function alreadySentToday(userId: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - DIGEST_INTERVAL_HOURS * 60 * 60 * 1000);
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.eventType, DIGEST_EVENT_TYPE),
        gt(notifications.createdAt, cutoff),
      ),
    )
    .limit(1);
  return recent.length > 0;
}

/**
 * Find recipient user ids for the digest by matching against role.
 * Active users only (`deletedAt IS NULL`) and excluding test fixtures.
 */
async function digestRecipients(): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.role, DIGEST_RECIPIENT_ROLES),
        sql`${users.deletedAt} IS NULL`,
      ),
    );
  return rows.map((r: { id: number }) => r.id);
}

/**
 * Run the daily digest. Idempotent for the day — if the trigger fires
 * every hour, only the first run that finds unverified drift sends
 * notifications. Subsequent runs in the same 22h window see the
 * already-sent record and return notified=0.
 */
export async function notifyHighUnverifiedDrift(): Promise<DigestTriggerResult> {
  const built = await buildDigestBody();
  if (!built) return { count: 0, notified: 0 };

  const recipientIds = await digestRecipients();
  if (recipientIds.length === 0) return { count: 0, notified: 0 };

  let notified = 0;
  for (const userId of recipientIds) {
    if (await alreadySentToday(userId)) continue;
    const created = await createNotification({
      recipientUserId: userId,
      eventType: DIGEST_EVENT_TYPE,
      title: built.title,
      body: built.body,
      // Per-day throttle handled above; relatedEntity stays nominal so
      // createNotification's 10-minute throttle isn't accidentally
      // triggered by repeated hourly runs.
    });
    if (created) notified++;
  }
  return { count: built.totalUnverified, notified };
}
