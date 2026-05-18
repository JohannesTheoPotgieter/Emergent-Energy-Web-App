/**
 * C5: Notification trigger scheduler.
 * Runs checkAllNotificationTriggers() every hour to create notifications
 * for overdue snags, stalled handovers, late deliveries, etc.
 */

import { checkAllNotificationTriggers } from "./notification-triggers";
import logger from "../lib/logger";

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

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startNotificationTriggerScheduler() {
  if (intervalHandle) return; // already running

  logger.info("[NotificationScheduler] Starting — checks every 60 minutes");

  // Run once on startup (delayed 30s to let DB settle)
  setTimeout(async () => {
    try {
      const results = await checkAllNotificationTriggers();
      const totalNotified = results.reduce((sum, r) => sum + r.notified, 0);
      lastRunAt = new Date();
        logger.info(`[NotificationScheduler] Initial check complete — ${totalNotified} notifications sent`);
    } catch (err) {
      logger.warn("[NotificationScheduler] Initial check failed:", err);
    }
  }, 30_000);

  // Then run on interval
  intervalHandle = setInterval(async () => {
    try {
      const results = await checkAllNotificationTriggers();
      const totalNotified = results.reduce((sum, r) => sum + r.notified, 0);
      lastRunAt = new Date();
        if (totalNotified > 0) {
        logger.info(`[NotificationScheduler] Check complete — ${totalNotified} notifications sent`);
      }
    } catch (err) {
      logger.warn("[NotificationScheduler] Scheduled check failed:", err);
    }
  }, INTERVAL_MS);
}

export function stopNotificationTriggerScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("[NotificationScheduler] Stopped");
  }
}
