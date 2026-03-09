import { getStartupModes } from "./startup-modes";

export function getStartupFlags() {
  const startupModes = getStartupModes();

  return {
    rawEnv: {
      maintenanceMode: startupModes.startupFlagsRaw.ENABLE_STARTUP_MAINTENANCE,
      schemaRepair: startupModes.startupFlagsRaw.ENABLE_STARTUP_SCHEMA_REPAIR,
      dataSeed: startupModes.startupFlagsRaw.ENABLE_STARTUP_DATA_SEED,
      backfill: startupModes.startupFlagsRaw.ENABLE_STARTUP_BACKFILL,
      sessionReset: startupModes.startupFlagsRaw.ENABLE_STARTUP_SESSION_RESET,
      userSeed: startupModes.startupFlagsRaw.ENABLE_STARTUP_USER_SEED,
    },
    modes: {
      maintenanceMode: startupModes.startupMaintenanceEnabled,
      schemaRepair: startupModes.startupSchemaRepairEnabled,
      dataSeed: startupModes.startupDataSeedEnabled,
      backfill: startupModes.startupBackfillEnabled,
      sessionReset: startupModes.startupSessionResetEnabled,
      userSeed: startupModes.startupUserSeedEnabled,
      readOnlyByDefault: startupModes.startupReadOnlyByDefault,
      mutationClassification: startupModes.startupMutationClassification,
    },
  };
}
