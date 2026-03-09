const parseBooleanFlag = (value: string | undefined, defaultValue = false): boolean => {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

export const startupFlags = {
  schemaRepair: process.env.STARTUP_SCHEMA_REPAIR,
  dataSeed: process.env.STARTUP_DATA_SEED,
  backfill: process.env.STARTUP_BACKFILL,
  sessionReset: process.env.STARTUP_SESSION_RESET,
  maintenance: process.env.STARTUP_MAINTENANCE,
};

export const startupModes = {
  startupSchemaRepairEnabled: parseBooleanFlag(startupFlags.schemaRepair, false),
  startupDataSeedEnabled: parseBooleanFlag(startupFlags.dataSeed, false),
  startupBackfillEnabled: parseBooleanFlag(startupFlags.backfill, false),
  startupSessionResetEnabled: parseBooleanFlag(startupFlags.sessionReset, false),
  startupMaintenanceEnabled: parseBooleanFlag(startupFlags.maintenance, false),
};

export const {
  startupSchemaRepairEnabled,
  startupDataSeedEnabled,
  startupBackfillEnabled,
  startupSessionResetEnabled,
  startupMaintenanceEnabled,
} = startupModes;
