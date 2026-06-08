/**
 * App-facing glue for schema readiness (see `server/lib/schema-readiness.ts`).
 *
 * Imports `server/db` (pool + mode), so it must NOT be imported by the
 * standalone CLI or by unit tests that should run without a database — those
 * use the portable core directly.
 *
 * Responsibilities:
 *   - `queryAppliedMigrationHashes()` — read the applied migration hashes from
 *     drizzle's bookkeeping table (read-only).
 *   - `evaluateAppSchemaReadiness()` — evaluate + cache readiness for the app.
 *   - `runSchemaReadinessBootGate()` — the boot behaviour: dev auto-applies
 *     migrations once; production logs one fatal-style line and serves a
 *     maintenance state (never crash-loops).
 */

import { spawn } from "node:child_process";
import { getDbMode, getPostgresPool } from "../db";
import {
  evaluateSchemaReadiness,
  formatPendingSummary,
  type SchemaReadiness,
} from "../lib/schema-readiness";

const SOURCE = "Startup:SchemaReadiness";

type Logger = (message: string, source?: string) => void;

/**
 * The migration hashes recorded in `drizzle."__drizzle_migrations"`. Returns an
 * empty list when the table is absent (undefined_table / 42P01) — i.e. nothing
 * applied. Read-only; never throws for the "table absent" case.
 */
export async function queryAppliedMigrationHashes(): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  try {
    const result = await pool.query<{ hash: string }>(
      `SELECT hash FROM drizzle."__drizzle_migrations"`,
    );
    return result.rows.map((row) => row.hash).filter((hash): hash is string => typeof hash === "string");
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return [];
    throw err;
  }
}

/** Evaluate readiness against the app's live DB and refresh the cache. */
export function evaluateAppSchemaReadiness(): Promise<SchemaReadiness> {
  return evaluateSchemaReadiness({
    mode: getDbMode(),
    queryAppliedHashes: queryAppliedMigrationHashes,
  });
}

function autoMigrateDisabled(): boolean {
  return (
    process.env.SCHEMA_AUTO_MIGRATE === "false" ||
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.CI)
  );
}

/** Spawn `npm run db:migrate` (dev only) and resolve true on a clean exit. */
function autoApplyMigrations(log: Logger): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "db:migrate"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (err) => {
      log(`Failed to spawn \`npm run db:migrate\`: ${err instanceof Error ? err.message : String(err)}`, SOURCE);
      resolve(false);
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Boot-time schema-readiness gate. Runs once, right after the DB is
 * initialised and before routes register.
 *
 * - SQLite / unknown / ready → log and continue.
 * - Behind, DEV → log a single BLOCK line, auto-apply migrations once, then
 *   re-evaluate. If auto-migrate is disabled or fails, log clear manual
 *   instructions and continue (finance serves the maintenance state).
 * - Behind, PRODUCTION → log one fatal-style line naming the missing
 *   migrations and continue. Startup stays read-only and does not crash-loop;
 *   the health endpoint reports 503 and finance returns typed 503s until an
 *   operator applies the migrations.
 */
export async function runSchemaReadinessBootGate(options: { log: Logger }): Promise<SchemaReadiness> {
  const { log } = options;
  const isProduction = process.env.NODE_ENV === "production";

  let readiness = await evaluateAppSchemaReadiness();

  if (readiness.mode === "sqlite") {
    log("SQLite dev DB — migration readiness check skipped (kept current by the additive bootstrap).", SOURCE);
    return readiness;
  }
  if (readiness.state === "unknown") {
    log(`Migration readiness could not be determined (${readiness.error ?? "unknown error"}); continuing without the gate.`, SOURCE);
    return readiness;
  }
  if (readiness.ready) {
    log(`Schema is up to date (${readiness.appliedCount}/${readiness.totalCount} migrations applied).`, SOURCE);
    return readiness;
  }

  const summary = formatPendingSummary(readiness);

  if (isProduction) {
    log(
      `FATAL-CONFIG: database schema is BEHIND on migrations — serving a MAINTENANCE state (health 503, finance 503). ` +
        `${summary}. Deploy must run \`npm run db:migrate\` to recover.`,
      SOURCE,
    );
    // Mirror to stderr so it stands out in production log aggregators.
    console.error(`[${SOURCE}] SCHEMA BEHIND IN PRODUCTION — ${summary}`);
    return readiness;
  }

  // --- Development ---
  log(`BLOCK: dev database is BEHIND on migrations — do not run against a stale DB. ${summary}.`, SOURCE);

  if (autoMigrateDisabled()) {
    log("Auto-migrate is disabled (SCHEMA_AUTO_MIGRATE=false / test / CI). Run `npm run db:migrate`, then restart.", SOURCE);
    return readiness;
  }

  log("Auto-applying pending migrations via `npm run db:migrate` (dev only)…", SOURCE);
  const applied = await autoApplyMigrations(log);
  if (!applied) {
    log("Auto-migrate FAILED. Run `npm run db:migrate` manually, then restart. Finance stays in the maintenance state meanwhile.", SOURCE);
    return readiness;
  }

  readiness = await evaluateAppSchemaReadiness();
  if (readiness.ready) {
    log(`Auto-migrate complete — schema is now up to date (${readiness.appliedCount}/${readiness.totalCount}).`, SOURCE);
  } else {
    log(`Auto-migrate ran but the schema is still behind: ${formatPendingSummary(readiness)}. Investigate manually.`, SOURCE);
  }
  return readiness;
}
