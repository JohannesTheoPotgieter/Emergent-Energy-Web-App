import { getStartupModes } from "./startup-modes";
import type { SchemaReadiness } from "./lib/schema-readiness";
import type { SchemaVerification } from "./lib/schema-verification";

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
  schemaReadiness?: SchemaReadiness | null,
  schemaVerification?: SchemaVerification | null,
) {
  const startupManifest = {
    sessionSchemaRepair: startupModes.startupSchemaRepairEnabled,
    sessionReset: startupModes.startupSessionResetEnabled,
    userSeeding: startupModes.startupDataSeedEnabled,
    backfill: startupModes.startupBackfillEnabled,
    schemaRepairBlocks: startupModes.startupSchemaRepairEnabled,
  };

  // A DB that is behind on migrations is reported as NOT ok (HTTP 503), with
  // the pending migration list, so operators get one clear maintenance signal
  // instead of a wall of raw finance 500s.
  const schemaBehind = schemaReadiness?.state === "schema_behind";
  // Column-level drift — the migration ledger reports applied but declared
  // tables/columns are missing from the live DB. Same maintenance signal.
  const schemaDrift = schemaVerification?.state === "schema_drift";

  return {
    ok: dbStatus.connected && !schemaBehind && !schemaDrift,
    reason: schemaBehind
      ? ("schema_behind" as const)
      : schemaDrift
        ? ("schema_drift" as const)
        : undefined,
    schema: schemaReadiness
      ? {
          ready: schemaReadiness.ready,
          state: schemaReadiness.state,
          pendingMigrations: schemaReadiness.pendingMigrations,
          appliedCount: schemaReadiness.appliedCount,
          totalCount: schemaReadiness.totalCount,
        }
      : undefined,
    schemaVerification: schemaVerification
      ? {
          ok: schemaVerification.ok,
          state: schemaVerification.state,
          missingTables: schemaVerification.missingTables,
          missingColumns: schemaVerification.missingColumns.map(
            (c) => `${c.table}.${c.column}`,
          ),
          expectedTableCount: schemaVerification.expectedTableCount,
        }
      : undefined,
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
