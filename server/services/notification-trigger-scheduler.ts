/**
 * C5: Notification trigger scheduler.
 * Runs checkAllNotificationTriggers() every 15 minutes to create notifications
 * for overdue snags, stalled handovers, late deliveries, etc. (was hourly —
 * tightened so condition-based alerts surface within ~15 min, not up to an hour).
 */

import { checkAllNotificationTriggers } from "./notification-triggers";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;

export function getSchedulerStatus() {
  return {
    running: intervalHandle !== null,
    lastRunAt,
    nextRunAt: lastRunAt ? new Date(lastRunAt.getTime() + INTERVAL_MS) : null,
    intervalMs: INTERVAL_MS,
  };
}

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startNotificationTriggerScheduler() {
  if (intervalHandle) return; // already running

  console.log("[NotificationScheduler] Starting — checks every 60 minutes");

  // Run once on startup (delayed 30s to let DB settle)
  setTimeout(async () => {
    try {
      const results = await checkAllNotificationTriggers();
      const totalNotified = results.reduce((sum, r) => sum + r.notified, 0);
      lastRunAt = new Date();
        console.log(`[NotificationScheduler] Initial check complete — ${totalNotified} notifications sent`);
    } catch (err) {
      console.warn("[NotificationScheduler] Initial check failed:", err);
    }
  }, 30_000);

  // Then run on interval
  intervalHandle = setInterval(async () => {
    try {
      const results = await checkAllNotificationTriggers();
      const totalNotified = results.reduce((sum, r) => sum + r.notified, 0);
      lastRunAt = new Date();
        if (totalNotified > 0) {
        console.log(`[NotificationScheduler] Check complete — ${totalNotified} notifications sent`);
      }
    } catch (err) {
      console.warn("[NotificationScheduler] Scheduled check failed:", err);
    }
  }, INTERVAL_MS);
}

export function stopNotificationTriggerScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[NotificationScheduler] Stopped");
  }
}
