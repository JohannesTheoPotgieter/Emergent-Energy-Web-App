function isEnabled(value: string | undefined): boolean {
  return value === "true";
}

export const startupRawFlags = {
  ENABLE_STARTUP_MAINTENANCE: process.env.ENABLE_STARTUP_MAINTENANCE,
  ENABLE_STARTUP_SCHEMA_REPAIR: process.env.ENABLE_STARTUP_SCHEMA_REPAIR,
  ENABLE_STARTUP_DATA_SEED: process.env.ENABLE_STARTUP_DATA_SEED,
  ENABLE_STARTUP_BACKFILL: process.env.ENABLE_STARTUP_BACKFILL,
  ENABLE_STARTUP_SESSION_RESET: process.env.ENABLE_STARTUP_SESSION_RESET,
} as const;

export const startupMaintenanceEnabled = isEnabled(startupRawFlags.ENABLE_STARTUP_MAINTENANCE);
export const startupSchemaRepairEnabled = startupMaintenanceEnabled || isEnabled(startupRawFlags.ENABLE_STARTUP_SCHEMA_REPAIR);
export const startupDataSeedEnabled = startupMaintenanceEnabled || isEnabled(startupRawFlags.ENABLE_STARTUP_DATA_SEED);
export const startupBackfillEnabled = startupMaintenanceEnabled || isEnabled(startupRawFlags.ENABLE_STARTUP_BACKFILL);
export const startupSessionResetEnabled = startupMaintenanceEnabled || isEnabled(startupRawFlags.ENABLE_STARTUP_SESSION_RESET);

export const startupEffectiveModes = {
  startupMaintenanceEnabled,
  startupSchemaRepairEnabled,
  startupDataSeedEnabled,
  startupBackfillEnabled,
  startupSessionResetEnabled,
} as const;

export function getStartupFlags() {
  return {
    rawEnv: {
      maintenanceMode: startupRawFlags.ENABLE_STARTUP_MAINTENANCE ?? null,
      schemaRepair: startupRawFlags.ENABLE_STARTUP_SCHEMA_REPAIR ?? null,
      dataSeed: startupRawFlags.ENABLE_STARTUP_DATA_SEED ?? null,
      backfill: startupRawFlags.ENABLE_STARTUP_BACKFILL ?? null,
      sessionReset: startupRawFlags.ENABLE_STARTUP_SESSION_RESET ?? null,
    },
    modes: {
      maintenanceMode: startupMaintenanceEnabled,
      schemaRepair: startupSchemaRepairEnabled,
      dataSeed: startupDataSeedEnabled,
      backfill: startupBackfillEnabled,
      sessionReset: startupSessionResetEnabled,
    },
  };
}
