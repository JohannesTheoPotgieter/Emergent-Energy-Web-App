import { getStartupModes } from "./startup-modes";

interface DbConfigStatus {
  connected: boolean;
  mode: string;
  message: string;
  host?: string;
  error?: string;
}

export function buildHealthDiagnostics(
  dbMode: string,
  dbStatus: DbConfigStatus,
  startupModes: ReturnType<typeof getStartupModes>,
) {
  const startupManifest = {
    sessionSchemaRepair: startupModes.startupSchemaRepairEnabled,
    sessionReset: startupModes.startupSessionResetEnabled,
    userSeeding: startupModes.startupDataSeedEnabled,
    backfill: startupModes.startupBackfillEnabled,
    schemaRepairBlocks: startupModes.startupSchemaRepairEnabled,
  };

  return {
    ok: dbStatus.connected,
    dbMode,
    dbConnected: dbStatus.connected,
    dbHost: dbStatus.host,
    dbError: dbStatus.error || null,
    envDbMode: process.env.DB_MODE || "auto",
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    message: dbStatus.message,
    startupFlagsRaw: startupModes.startupFlagsRaw,
    startupModes: {
      startupMaintenanceEnabled: startupModes.startupMaintenanceEnabled,
      startupSchemaRepairEnabled: startupModes.startupSchemaRepairEnabled,
      startupDataSeedEnabled: startupModes.startupDataSeedEnabled,
      startupBackfillEnabled: startupModes.startupBackfillEnabled,
      startupSessionResetEnabled: startupModes.startupSessionResetEnabled,
      startupReadOnlyByDefault: startupModes.startupReadOnlyByDefault,
    },
    startupReadOnlyByDefault: startupModes.startupReadOnlyByDefault,
    startupMutationClassification: startupModes.startupMutationClassification,
    startupMutationClassificationSummary: startupManifest,
    timestamp: new Date().toISOString(),
  };
}
