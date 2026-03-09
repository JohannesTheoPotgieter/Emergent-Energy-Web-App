const startupFlagEnv = {
  maintenance: {
    enable: process.env.ENABLE_STARTUP_MAINTENANCE,
    startup: process.env.STARTUP_MAINTENANCE,
  },
  schemaRepair: {
    enable: process.env.ENABLE_STARTUP_SCHEMA_REPAIR,
    startup: process.env.STARTUP_SCHEMA_REPAIR,
  },
  dataSeed: {
    enable: process.env.ENABLE_STARTUP_DATA_SEED,
    startup: process.env.STARTUP_DATA_SEED,
  },
  backfill: {
    enable: process.env.ENABLE_STARTUP_BACKFILL,
    startup: process.env.STARTUP_BACKFILL,
  },
  sessionReset: {
    enable: process.env.ENABLE_STARTUP_SESSION_RESET,
    startup: process.env.STARTUP_SESSION_RESET,
  },
} as const;

function parseStartupFlag(rawValue: string | undefined): boolean {
  return rawValue === "1" || rawValue === "true";
}

function resolveRawFlagValue(
  value: { enable: string | undefined; startup: string | undefined },
): string | undefined {
  return value.enable ?? value.startup;
}

export const startupFlags = {
  maintenance: {
    ...startupFlagEnv.maintenance,
    raw: resolveRawFlagValue(startupFlagEnv.maintenance),
  },
  schemaRepair: {
    ...startupFlagEnv.schemaRepair,
    raw: resolveRawFlagValue(startupFlagEnv.schemaRepair),
  },
  dataSeed: {
    ...startupFlagEnv.dataSeed,
    raw: resolveRawFlagValue(startupFlagEnv.dataSeed),
  },
  backfill: {
    ...startupFlagEnv.backfill,
    raw: resolveRawFlagValue(startupFlagEnv.backfill),
  },
  sessionReset: {
    ...startupFlagEnv.sessionReset,
    raw: resolveRawFlagValue(startupFlagEnv.sessionReset),
  },
} as const;

const startupMaintenanceEnabled = parseStartupFlag(startupFlags.maintenance.raw);

export const startupModes = {
  startupMaintenanceEnabled,
  startupSchemaRepairEnabled:
    startupMaintenanceEnabled || parseStartupFlag(startupFlags.schemaRepair.raw),
  startupDataSeedEnabled:
    startupMaintenanceEnabled || parseStartupFlag(startupFlags.dataSeed.raw),
  startupBackfillEnabled:
    startupMaintenanceEnabled || parseStartupFlag(startupFlags.backfill.raw),
  startupSessionResetEnabled:
    startupMaintenanceEnabled || parseStartupFlag(startupFlags.sessionReset.raw),
} as const;
