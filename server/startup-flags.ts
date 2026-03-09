type StartupFlagOptions = {
  legacyName: string;
  currentName: string;
  defaultValue?: boolean;
};

export type StartupFlags = {
  startupMaintenanceEnabled: boolean;
  startupSchemaRepairEnabled: boolean;
  startupDataSeedEnabled: boolean;
  startupBackfillEnabled: boolean;
  startupSessionResetEnabled: boolean;
};

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function readFlag({ legacyName, currentName, defaultValue = false }: StartupFlagOptions): boolean {
  const current = parseBooleanEnv(process.env[currentName]);
  if (current !== undefined) return current;

  const legacy = parseBooleanEnv(process.env[legacyName]);
  if (legacy !== undefined) return legacy;

  return defaultValue;
}

export function getStartupFlags(): StartupFlags {
  const startupMaintenanceEnabled = readFlag({
    legacyName: "ENABLE_STARTUP_MAINTENANCE",
    currentName: "STARTUP_MAINTENANCE_ENABLED",
  });

  const startupSchemaRepairEnabled = startupMaintenanceEnabled || readFlag({
    legacyName: "ENABLE_STARTUP_SCHEMA_REPAIR",
    currentName: "STARTUP_SCHEMA_REPAIR_ENABLED",
    defaultValue: true,
  });

  const startupDataSeedEnabled = startupMaintenanceEnabled || readFlag({
    legacyName: "ENABLE_STARTUP_DATA_SEED",
    currentName: "STARTUP_DATA_SEED_ENABLED",
    defaultValue: true,
  });

  const startupBackfillEnabled = startupMaintenanceEnabled || readFlag({
    legacyName: "ENABLE_STARTUP_BACKFILL",
    currentName: "STARTUP_BACKFILL_ENABLED",
    defaultValue: true,
  });

  const startupSessionResetEnabled = startupMaintenanceEnabled || readFlag({
    legacyName: "ENABLE_STARTUP_SESSION_RESET",
    currentName: "STARTUP_SESSION_RESET_ENABLED",
    defaultValue: true,
  });

  return {
    startupMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    startupSessionResetEnabled,
  };
}
