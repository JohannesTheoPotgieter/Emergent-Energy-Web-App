import { runBackfill } from "../lib/backfill";
import { startScheduler } from "../importPipeline";

export async function startRuntimeServices(options: {
  startupBackfillEnabled: boolean;
  startupSyncEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupBackfillEnabled, startupSyncEnabled, log } = options;
  const started: string[] = [];

  if (startupBackfillEnabled) {
    runBackfill().catch((err) => log(`[Backfill] startup error: ${err}`, "Startup:Runtime"));
    started.push("startup-backfill-loop");
  }

  try {
    startScheduler();
    started.push("import-scheduler");
  } catch (err) {
    log(`[Import Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  try {
    const { startMonthlyReportScheduler } = await import("../services/monthly-report-scheduler");
    startMonthlyReportScheduler();
    started.push("monthly-report-scheduler");
  } catch (err) {
    log(`[Monthly Report Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  try {
    const { startNotificationTriggerScheduler } = await import("../services/notification-trigger-scheduler");
    startNotificationTriggerScheduler();
    started.push("notification-trigger-scheduler");
  } catch (err) {
    log(`[Notification Trigger Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  try {
    const { scheduleCosPeriodAutoLock } = await import("./cos-period-lock-scheduler");
    scheduleCosPeriodAutoLock();
    started.push("cos-period-lock-scheduler");
  } catch (err) {
    log(`[COS Period Lock Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  // C1: seed the integration registry so the health dashboard has tiles
  // from day 1 even before the first run has been logged. Idempotent.
  try {
    const { seedIntegrationRegistry } = await import("../services/integration-health-service");
    const { inserted } = await seedIntegrationRegistry();
    started.push(`integration-registry-seed(inserted=${inserted})`);
  } catch (err) {
    log(`[Integration Registry Seed] Failed: ${err}`, "Startup:Runtime");
  }

  // C2: register org-wide dashboards and start the periodic refresh loop.
  try {
    const { scheduleDashboardRefresh } = await import("./dashboard-refresh-scheduler");
    await scheduleDashboardRefresh();
    started.push("dashboard-refresh-scheduler");
  } catch (err) {
    log(`[Dashboard Refresh Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  // C3: BullMQ-backed alert dispatcher worker. Uses in-memory fallback
  // when REDIS_URL is unset (see server/lib/job-queue.ts).
  try {
    const { startAlertDispatcherWorker } = await import("../services/alert-dispatcher-service");
    await startAlertDispatcherWorker();
    started.push("alert-dispatcher-worker");
  } catch (err) {
    log(`[Alert Dispatcher] Failed to start: ${err}`, "Startup:Runtime");
  }

  // C3: work-item due-date reminder scheduler.
  try {
    const { startTaskReminderScheduler } = await import("../services/task-reminder-dispatcher");
    startTaskReminderScheduler();
    started.push("task-reminder-scheduler");
  } catch (err) {
    log(`[Task Reminder Scheduler] Failed to start: ${err}`, "Startup:Runtime");
  }

  try {
    const { startPeriodicSync } = await import("../ms-sync-service");
    if (startupSyncEnabled) {
      startPeriodicSync();
      started.push("periodic-sync");
    } else {
      log("Skipped periodic sync startup due to STARTUP_ENABLE_PERIODIC_SYNC=false", "Startup:Runtime");
    }
  } catch (err) {
    log(`[Periodic Sync] Failed to start: ${err}`, "Startup:Runtime");
  }

  return started;
}
