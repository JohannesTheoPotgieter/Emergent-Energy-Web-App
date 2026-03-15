import { runBackfill } from "../lib/backfill";
import { startScheduler } from "../importPipeline";
import { startMilestoneChecker } from "../milestone-notifications";

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

  startScheduler();
  started.push("import-scheduler");

  startMilestoneChecker();
  started.push("milestone-checker");

  const { startPeriodicSync } = await import("../ms-sync-service");
  if (startupSyncEnabled) {
    startPeriodicSync();
    started.push("periodic-sync");
  } else {
    log("Skipped periodic sync startup due to STARTUP_ENABLE_PERIODIC_SYNC=false", "Startup:Runtime");
  }

  return started;
}
