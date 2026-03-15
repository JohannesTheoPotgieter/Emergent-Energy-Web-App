import type { Express } from "express";
import type { Server } from "http";
import { registerAllRoutes } from "../routes/register-all-routes";
import { runStartupBackfills } from "./run-startup-backfills";
import { runStartupSeeds } from "./run-startup-seeds";
import { runStartupMaintenanceOrchestrator } from "./startup-maintenance-orchestrator";
import { startRuntimeServices } from "./start-runtime-services";
import type { StartupReport } from "./startup-report";

export async function runStartupOrchestrator(options: {
  app: Express;
  httpServer: Server;
  runtimeMaintenanceEnabled: boolean;
  startupSchemaRepairEnabled: boolean;
  startupDataSeedEnabled: boolean;
  startupBackfillEnabled: boolean;
  allowStartupMutations: boolean;
  startupSyncEnabled: boolean;
  report: StartupReport;
  log: (message: string, source?: string) => void;
}) {
  const {
    app,
    httpServer,
    runtimeMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    allowStartupMutations,
    startupSyncEnabled,
    report,
    log,
  } = options;

  await runStartupMaintenanceOrchestrator({ runtimeMaintenanceEnabled, startupSchemaRepairEnabled, log });
  report.maintenance.push(runtimeMaintenanceEnabled && startupSchemaRepairEnabled ? "completed" : "skipped");

  await runStartupSeeds({ startupDataSeedEnabled, allowStartupMutations, log });
  report.seeds.push(startupDataSeedEnabled ? "completed" : "skipped");

  await runStartupBackfills({
    startupBackfillEnabled,
    runtimeSchemaRepairEnabled: runtimeMaintenanceEnabled && startupSchemaRepairEnabled,
    allowStartupMutations,
    log,
  });
  report.backfills.push(startupBackfillEnabled ? "completed" : "skipped");

  await registerAllRoutes({
    app,
    httpServer,
    runtimeSchemaRepairEnabled: runtimeMaintenanceEnabled && startupSchemaRepairEnabled,
    log,
  });
  report.routes.push("registered");

  const runtimeServices = await startRuntimeServices({ startupBackfillEnabled, startupSyncEnabled, log });
  report.runtimeServices.push(...runtimeServices);
}
