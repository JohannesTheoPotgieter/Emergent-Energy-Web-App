import { dbMode } from "../db";
import { getSchedulerStatus } from "../importPipeline";
import { getStartupModes } from "../startup-modes";
import { getRuntimeMutationPolicy } from "./runtime-mutation-policy";

export function getEnvironmentStatus() {
  const scheduler = getSchedulerStatus();
  const isProduction = process.env.NODE_ENV === "production";
  const modes = getStartupModes();
  const runtimeMutationPolicy = getRuntimeMutationPolicy(modes);

  return {
    dbMode,
    dbRuntimeMode: dbMode,
    sessionMode: dbMode === "postgres" ? "postgres" : "memory",
    startupReadOnlyByDefault: !runtimeMutationPolicy.runtimeMutationsActive,
    migrationStatus: runtimeMutationPolicy.runtimeStartupMigrationsActive
      ? "runtime-startup-enabled"
      : "startup-disabled-use-migrations",
    runtimeMutationsActive: runtimeMutationPolicy.runtimeMutationsActive,
    runtimeMaintenanceEnabled: runtimeMutationPolicy.runtimeMaintenanceEnabled,
    runtimeMutationReason: runtimeMutationPolicy.reason,
    schedulerStatus: scheduler,
    nodeEnv: process.env.NODE_ENV || "development",
    productionPostgresRequired: isProduction,
    startupModes: {
      startupMaintenanceEnabled: modes.startupMaintenanceEnabled,
      startupSchemaRepairEnabled: modes.startupSchemaRepairEnabled,
      startupDataSeedEnabled: modes.startupDataSeedEnabled,
      startupBackfillEnabled: modes.startupBackfillEnabled,
      startupSessionResetEnabled: modes.startupSessionResetEnabled,
      startupReadOnlyByDefault: modes.startupReadOnlyByDefault,
      startupMutationClassification: modes.startupMutationClassification,
    },
  };
}
