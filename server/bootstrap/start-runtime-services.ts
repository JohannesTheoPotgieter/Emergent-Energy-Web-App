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
