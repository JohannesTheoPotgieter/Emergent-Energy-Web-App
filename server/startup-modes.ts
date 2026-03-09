export type StartupMutationClassification =
  | "read_only"
  | "repair_enabled"
  | "destructive_reset_enabled"
  | "mixed";

export function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getStartupModes() {
  const startupMaintenanceEnabled = parseEnvFlag(process.env.ENABLE_STARTUP_MAINTENANCE);
  const startupSchemaRepairEnabled =
    startupMaintenanceEnabled || parseEnvFlag(process.env.ENABLE_STARTUP_SCHEMA_REPAIR);
  const startupDataSeedEnabled =
    startupMaintenanceEnabled || parseEnvFlag(process.env.ENABLE_STARTUP_DATA_SEED);
  const startupBackfillEnabled =
    startupMaintenanceEnabled || parseEnvFlag(process.env.ENABLE_STARTUP_BACKFILL);
  const startupSessionResetEnabled =
    startupMaintenanceEnabled || parseEnvFlag(process.env.ENABLE_STARTUP_SESSION_RESET);
  const startupUserSeedEnabled =
    startupMaintenanceEnabled || parseEnvFlag(process.env.ENABLE_STARTUP_USER_SEED);

  const startupReadOnlyByDefault = !startupSchemaRepairEnabled && !startupSessionResetEnabled;

  let startupMutationClassification: StartupMutationClassification = "read_only";
  if (startupSessionResetEnabled && startupSchemaRepairEnabled) {
    startupMutationClassification = "mixed";
  } else if (startupSessionResetEnabled) {
    startupMutationClassification = "destructive_reset_enabled";
  } else if (startupSchemaRepairEnabled) {
    startupMutationClassification = "repair_enabled";
  }

  return {
    startupMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    startupSessionResetEnabled,
    startupUserSeedEnabled,
    startupReadOnlyByDefault,
    startupMutationClassification,
    startupFlagsRaw: {
      ENABLE_STARTUP_MAINTENANCE: process.env.ENABLE_STARTUP_MAINTENANCE ?? null,
      ENABLE_STARTUP_SCHEMA_REPAIR: process.env.ENABLE_STARTUP_SCHEMA_REPAIR ?? null,
      ENABLE_STARTUP_DATA_SEED: process.env.ENABLE_STARTUP_DATA_SEED ?? null,
      ENABLE_STARTUP_BACKFILL: process.env.ENABLE_STARTUP_BACKFILL ?? null,
      ENABLE_STARTUP_SESSION_RESET: process.env.ENABLE_STARTUP_SESSION_RESET ?? null,
      ENABLE_STARTUP_USER_SEED: process.env.ENABLE_STARTUP_USER_SEED ?? null,
    },
  };
}
