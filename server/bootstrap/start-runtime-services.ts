import { runBackfill } from "../lib/backfill";
import { startScheduler } from "../importPipeline";
import { getDbMode } from "../db";

export async function startRuntimeServices(options: {
  startupBackfillEnabled: boolean;
  startupSyncEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupBackfillEnabled, startupSyncEnabled, log } = options;
  const started: string[] = [];
  const isSqlite = getDbMode() === "sqlite";

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

  if (!isSqlite) {
    try {
      const { scheduleCosPeriodAutoLock } = await import("./cos-period-lock-scheduler");
      scheduleCosPeriodAutoLock();
      started.push("cos-period-lock-scheduler");
    } catch (err) {
      log(`[COS Period Lock Scheduler] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped COS period-lock scheduler in SQLite mode (Postgres-first feature).", "Startup:Runtime");
  }

  // TF-4 (audit V3): derived_project_kpis cache writer. Before this
  // scheduler landed, the table had no writer in the repo and three
  // production surfaces (priority dashboard, project header, strategic
  // chain view) were reading stale-or-zero data. The scheduler runs a
  // portfolio rebuild every 15 minutes; finance writes can also call
  // `recomputeDerivedKpisForProject(projectId)` directly for event-
  // driven freshness on a single row.
  if (!isSqlite) {
    try {
      const { scheduleDerivedProjectKpiRefresh } = await import("./derived-project-kpis-scheduler");
      scheduleDerivedProjectKpiRefresh();
      started.push("derived-project-kpis-scheduler");
    } catch (err) {
      log(`[Derived Project KPIs Scheduler] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped derived-project-kpis scheduler in SQLite mode (Postgres-first feature).", "Startup:Runtime");
  }

  // C1: seed the integration registry so the health dashboard has tiles
  // from day 1 even before the first run has been logged. Idempotent.
  if (!isSqlite) {
    try {
      const { seedIntegrationRegistry } = await import("../services/integration-health-service");
      const { inserted } = await seedIntegrationRegistry();
      started.push(`integration-registry-seed(inserted=${inserted})`);
    } catch (err) {
      log(`[Integration Registry Seed] Failed: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped integration registry seed in SQLite mode (uses JSONB metadata).", "Startup:Runtime");
  }

  // C2: register org-wide dashboards and start the periodic refresh loop.
  if (!isSqlite) {
    try {
      const { scheduleDashboardRefresh } = await import("./dashboard-refresh-scheduler");
      await scheduleDashboardRefresh();
      started.push("dashboard-refresh-scheduler");
    } catch (err) {
      log(`[Dashboard Refresh Scheduler] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped dashboard refresh scheduler in SQLite mode (Postgres-first JSON cache tables).", "Startup:Runtime");
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

  // QB payment-status refresh: nightly walk of active invoice links.
  // Skipped in SQLite mode (no real QB connection) and when QB tokens are absent.
  if (!isSqlite) {
    try {
      const { scheduleQbPaymentRefresh } = await import("./qb-payment-refresh-scheduler");
      scheduleQbPaymentRefresh();
      started.push("qb-payment-refresh-scheduler");
    } catch (err) {
      log(`[QB Payment Refresh Scheduler] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped QB payment-refresh scheduler in SQLite mode.", "Startup:Runtime");
  }

  // Company-wide tracker-vs-QuickBooks reconciliation: daily recompute into
  // qb_recon_line / qb_recon_summary (snapshot-guarded). Postgres-only.
  if (!isSqlite) {
    try {
      const { scheduleQbReconRefresh } = await import("./qb-recon-refresh-scheduler");
      scheduleQbReconRefresh();
      started.push("qb-recon-refresh-scheduler");
    } catch (err) {
      log(`[QB Tracker Reconcile Scheduler] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped QB tracker-reconcile scheduler in SQLite mode.", "Startup:Runtime");
  }

  // Integration credential-expiry sweep: daily countdown of the QB refresh
  // token + Azure/SharePoint client secrets, paging COO_ADMIN at 30/7/0 days
  // so a credential never silently lapses during the freeze. Postgres-only.
  if (!isSqlite) {
    try {
      const { scheduleCredentialExpirySweep } = await import(
        "./integration-credential-expiry-scheduler"
      );
      scheduleCredentialExpirySweep();
      started.push("integration-credential-expiry-scheduler");
    } catch (err) {
      log(`[Credential Expiry Sweep] Failed to start: ${err}`, "Startup:Runtime");
    }
  } else {
    log("Skipped credential-expiry sweep in SQLite mode.", "Startup:Runtime");
  }

  return started;
}
