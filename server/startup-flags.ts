export type StartupRawEnvFlags = {
  maintenanceMode: string | null;
  schemaRepair: string | null;
  dataSeed: string | null;
  backfill: string | null;
  sessionReset: string | null;
};

export type StartupDerivedModes = {
  maintenanceMode: boolean;
  schemaRepair: boolean;
  dataSeed: boolean;
  backfill: boolean;
  sessionReset: boolean;
};

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function getStartupFlags(): {
  rawEnv: StartupRawEnvFlags;
  modes: StartupDerivedModes;
} {
  const rawEnv: StartupRawEnvFlags = {
    maintenanceMode: process.env.STARTUP_MAINTENANCE_MODE ?? null,
    schemaRepair: process.env.STARTUP_SCHEMA_REPAIR ?? null,
    dataSeed: process.env.STARTUP_DATA_SEED ?? null,
    backfill: process.env.STARTUP_BACKFILL ?? null,
    sessionReset: process.env.STARTUP_SESSION_RESET ?? null,
  };

  const maintenanceMode = parseBooleanEnv(process.env.STARTUP_MAINTENANCE_MODE) ?? false;

  const modes: StartupDerivedModes = {
    maintenanceMode,
    schemaRepair: parseBooleanEnv(process.env.STARTUP_SCHEMA_REPAIR) ?? maintenanceMode,
    dataSeed: parseBooleanEnv(process.env.STARTUP_DATA_SEED) ?? maintenanceMode,
    backfill: parseBooleanEnv(process.env.STARTUP_BACKFILL) ?? maintenanceMode,
    sessionReset: parseBooleanEnv(process.env.STARTUP_SESSION_RESET) ?? maintenanceMode,
  };

  return { rawEnv, modes };
}
