/**
 * App-facing glue for column-level schema verification (see
 * `server/lib/schema-verification.ts`).
 *
 * Imports `server/db` (pool + mode), so it must NOT be imported by the
 * standalone `scripts/db-verify-schema.ts` CLI or by unit tests that should
 * run without a database — those use the portable core directly.
 *
 * Boot behaviour (`runSchemaVerificationBootGate`), running right after the
 * migration-readiness gate:
 *   - aligned / unknown / SQLite → log and continue.
 *   - drift, DEV → apply the additive repair plan (ADD COLUMN IF NOT
 *     EXISTS / minimal CREATE TABLE) once, then re-verify. The committed
 *     migrations stay the source of constraint fidelity — the repair keeps
 *     a drifted dev DB queryable and loudly says what it did.
 *   - drift, PRODUCTION → log one fatal-style line naming the missing
 *     artifacts and continue serving a MAINTENANCE state (health 503 +
 *     finance 503 via the cached state). Never crash-loops, never mutates
 *     production DDL.
 */

import { getDbMode, getPostgresPool } from "../db";
import {
  compareSchemas,
  deriveExpectedTables,
  evaluateSchemaVerification,
  formatDriftSummary,
  planAdditiveRepair,
  type LiveColumn,
  type SchemaVerification,
} from "../lib/schema-verification";

const SOURCE = "Startup:SchemaVerification";

type Logger = (message: string, source?: string) => void;

/** Live column inventory for all app schemas (tables AND views). */
export async function queryLiveAppColumns(): Promise<LiveColumn[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const result = await pool.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'drizzle')`,
  );
  return result.rows.map((row) => ({
    schemaName: row.table_schema,
    tableName: row.table_name,
    columnName: row.column_name,
  }));
}

/** Evaluate verification against the app's live DB and refresh the cache. */
export function evaluateAppSchemaVerification(): Promise<SchemaVerification> {
  return evaluateSchemaVerification({
    mode: getDbMode(),
    queryLiveColumns: queryLiveAppColumns,
  });
}

function autoRepairDisabled(): boolean {
  return (
    process.env.SCHEMA_AUTO_REPAIR === "false" ||
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.CI)
  );
}

/** Execute the additive repair plan (dev only). Returns true on full success. */
async function applyAdditiveRepair(log: Logger): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool) return false;
  const expected = deriveExpectedTables();
  const liveColumns = await queryLiveAppColumns();
  const statements = planAdditiveRepair(expected, compareSchemas(expected, liveColumns));
  for (const statement of statements) {
    const summary = statement.replace(/\s+/g, " ").slice(0, 160);
    try {
      await pool.query(statement);
      log(`repair applied: ${summary}`, SOURCE);
    } catch (err) {
      log(
        `repair FAILED (continuing in drift state): ${summary} — ${err instanceof Error ? err.message : String(err)}`,
        SOURCE,
      );
      return false;
    }
  }
  return true;
}

/**
 * Boot-time column-level drift gate. Runs once, right after the
 * migration-readiness gate and before routes register.
 */
export async function runSchemaVerificationBootGate(options: { log: Logger }): Promise<SchemaVerification> {
  const { log } = options;
  const isProduction = process.env.NODE_ENV === "production";

  let verification = await evaluateAppSchemaVerification();

  if (verification.mode === "sqlite") {
    log("SQLite dev DB — column-level verification skipped (kept current by the additive bootstrap).", SOURCE);
    return verification;
  }
  if (verification.state === "unknown") {
    log(`Schema verification could not be determined (${verification.error ?? "unknown error"}); continuing without the gate.`, SOURCE);
    return verification;
  }
  if (verification.ok) {
    log(
      `Live schema matches shared/schema at column level (${verification.expectedTableCount} tables verified).`,
      SOURCE,
    );
    return verification;
  }

  const summary = formatDriftSummary(verification);

  if (isProduction) {
    log(
      `FATAL-CONFIG: live schema is MISSING declared artifacts even though the migration ledger reports applied — ` +
        `serving a MAINTENANCE state (health 503, finance 503). ${summary}. ` +
        `Recover by applying the matching drift-repair migration (npm run db:migrate) and verifying with npm run db:verify-schema.`,
      SOURCE,
    );
    // Mirror to stderr so it stands out in production log aggregators.
    console.error(`[${SOURCE}] COLUMN-LEVEL SCHEMA DRIFT IN PRODUCTION — ${summary}`);
    return verification;
  }

  // --- Development ---
  log(`BLOCK: dev database has column-level drift (ledger says applied, schema disagrees). ${summary}.`, SOURCE);

  if (autoRepairDisabled()) {
    log("Auto-repair is disabled (SCHEMA_AUTO_REPAIR=false / test / CI). Run `npm run db:migrate` then `npm run db:verify-schema`.", SOURCE);
    return verification;
  }

  log("Auto-applying additive repair DDL derived from shared/schema (dev only)…", SOURCE);
  await applyAdditiveRepair(log);

  verification = await evaluateAppSchemaVerification();
  if (verification.ok) {
    log("Auto-repair complete — live schema now matches shared/schema at column level.", SOURCE);
  } else if (verification.state === "schema_drift") {
    log(`Auto-repair ran but drift remains: ${formatDriftSummary(verification)}. Investigate manually (npm run db:verify-schema).`, SOURCE);
  }
  return verification;
}
