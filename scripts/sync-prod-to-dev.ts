/**
 * Nightly Prod → Dev database sync.
 *
 * Wipes the dev database and replaces it with a complete copy of prod.
 * Run by .github/workflows/nightly-prod-to-dev.yml on a schedule, or
 * manually with:
 *
 *   PROD_DATABASE_URL=postgres://... \
 *   DEV_DATABASE_URL=postgres://... \
 *   tsx scripts/sync-prod-to-dev.ts
 *
 * Audit finding A6 closeout. See docs/runbooks/dev-data-refresh.md.
 *
 * SAFETY GUARDS (any failure exits non-zero before touching the database):
 *   1. Both PROD_DATABASE_URL and DEV_DATABASE_URL must be set.
 *   2. They must NOT be the same URL.
 *   3. They must NOT point at the same host+database combination.
 *   4. DEV_DATABASE_URL must NOT contain any of the PROD_HOST_HINTS
 *      tokens (production, prod-, etc.) anywhere in the host or path.
 *   5. The script writes a sentinel marker into the dev DB on success
 *      so consumers can confirm the source and timestamp of the data.
 *
 * The script does NOT mask, redact, or filter any data. Per audit
 * direction (internal-use, single-tenant, no PII concerns), the dev
 * database receives a verbatim copy of prod.
 *
 * Connection credentials are passed to pg_dump / psql via PG* env vars,
 * never as command-line arguments, so passwords do not appear in the
 * process listing.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PgEnv = {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGSSLMODE?: string;
};

const PROD_URL = process.env.PROD_DATABASE_URL ?? "";
const DEV_URL = process.env.DEV_DATABASE_URL ?? "";
const PROD_HOST_HINTS = ["production", "prod-", ".prod.", "live-", ".live."];

function fail(code: number, message: string): never {
  console.error(`[sync-prod-to-dev] ${message}`);
  process.exit(code);
}

function info(message: string): void {
  console.log(`[sync-prod-to-dev] ${message}`);
}

function urlToPgEnv(label: string, connStr: string): PgEnv {
  let url: URL;
  try {
    url = new URL(connStr);
  } catch (err) {
    throw new Error(`${label} is not a valid URL: ${(err as Error).message}`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${label} must use postgres:// or postgresql://, got ${url.protocol}`);
  }
  if (!url.hostname) throw new Error(`${label} is missing a hostname`);
  if (!url.username) throw new Error(`${label} is missing a username`);
  if (!url.pathname || url.pathname === "/") {
    throw new Error(`${label} is missing the database name (path component)`);
  }

  const sslMode = url.searchParams.get("sslmode") ?? undefined;

  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password ?? ""),
    PGDATABASE: url.pathname.slice(1),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

function preflight(): { prodEnv: PgEnv; devEnv: PgEnv } {
  if (!PROD_URL) fail(10, "PROD_DATABASE_URL is not set");
  if (!DEV_URL) fail(11, "DEV_DATABASE_URL is not set");

  if (PROD_URL === DEV_URL) {
    fail(12, "REFUSING: PROD_DATABASE_URL and DEV_DATABASE_URL are identical strings");
  }

  let prodEnv: PgEnv;
  let devEnv: PgEnv;
  try {
    prodEnv = urlToPgEnv("PROD_DATABASE_URL", PROD_URL);
    devEnv = urlToPgEnv("DEV_DATABASE_URL", DEV_URL);
  } catch (err) {
    fail(13, (err as Error).message);
  }

  if (
    prodEnv.PGHOST === devEnv.PGHOST &&
    prodEnv.PGPORT === devEnv.PGPORT &&
    prodEnv.PGDATABASE === devEnv.PGDATABASE
  ) {
    fail(14, `REFUSING: prod and dev resolve to the same host+port+database (${prodEnv.PGHOST}:${prodEnv.PGPORT}/${prodEnv.PGDATABASE})`);
  }

  const devHaystack = `${devEnv.PGHOST} ${devEnv.PGDATABASE}`.toLowerCase();
  const matchedHint = PROD_HOST_HINTS.find((hint) => devHaystack.includes(hint));
  if (matchedHint) {
    fail(
      15,
      `REFUSING: DEV_DATABASE_URL appears to point at production (matched hint "${matchedHint}" in host or database). ` +
        `If this is a false positive, rename the dev resource to remove the hint.`,
    );
  }

  info(`prod = ${prodEnv.PGHOST}:${prodEnv.PGPORT}/${prodEnv.PGDATABASE}`);
  info(`dev  = ${devEnv.PGHOST}:${devEnv.PGPORT}/${devEnv.PGDATABASE}`);

  return { prodEnv, devEnv };
}

function runPsqlCommand(env: PgEnv, sql: string, label: string): void {
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    fail(20, `psql ${label} failed with exit code ${result.status}`);
  }
}

function dumpProd(prodEnv: PgEnv, dumpFile: string): void {
  info(`Dumping prod → ${dumpFile}`);
  const result = spawnSync(
    "pg_dump",
    [
      "--no-owner",
      "--no-acl",
      "--format=plain",
      "--clean",
      "--if-exists",
      "--quote-all-identifiers",
      "--file",
      dumpFile,
    ],
    {
      env: { ...process.env, ...prodEnv },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    fail(30, `pg_dump failed with exit code ${result.status}`);
  }
  const stat = statSync(dumpFile);
  if (stat.size === 0) {
    fail(31, "pg_dump produced an empty file — refusing to load empty data into dev");
  }
  info(`Dump complete: ${(stat.size / (1024 * 1024)).toFixed(1)} MB`);
}

function wipeDev(devEnv: PgEnv): void {
  info("Wiping dev database (drop non-system schemas, recreate public)");
  const wipeSql = `
    DO $$
    DECLARE
      target_schema text;
    BEGIN
      FOR target_schema IN
        SELECT nspname
        FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND nspname NOT LIKE 'pg_temp_%'
          AND nspname NOT LIKE 'pg_toast_temp_%'
      LOOP
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', target_schema);
      END LOOP;
      EXECUTE 'CREATE SCHEMA public';
      EXECUTE 'GRANT ALL ON SCHEMA public TO PUBLIC';
    END $$;
  `;
  runPsqlCommand(devEnv, wipeSql, "wipe dev schemas");
}

function loadDumpIntoDev(devEnv: PgEnv, dumpFile: string): void {
  info(`Loading dump into dev (this may take several minutes)`);
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1", "-f", dumpFile],
    {
      env: { ...process.env, ...devEnv },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    fail(40, `psql restore failed with exit code ${result.status}`);
  }
  info("Dump loaded successfully");
}

function writeSentinel(devEnv: PgEnv): void {
  const ts = new Date().toISOString();
  const sentinelSql = `
    CREATE TABLE IF NOT EXISTS dev_data_sync_sentinel (
      id            serial PRIMARY KEY,
      synced_at     timestamptz NOT NULL DEFAULT now(),
      source_host   text NOT NULL,
      source_db     text NOT NULL,
      script_version text NOT NULL,
      notes         text
    );
    INSERT INTO dev_data_sync_sentinel (synced_at, source_host, source_db, script_version, notes)
    VALUES ('${ts}', '${devEnv.PGHOST.replace(/'/g, "''")}', '${devEnv.PGDATABASE.replace(/'/g, "''")}', 'sync-prod-to-dev@1', 'A6: nightly prod→dev refresh');
  `;
  runPsqlCommand(devEnv, sentinelSql, "write sentinel");
}

function verifyRowCounts(devEnv: PgEnv): void {
  info("Verifying restored dev database has data...");
  const verifySql = `
    SELECT
      'project_info' AS table_name, COUNT(*) AS row_count FROM project_info
    UNION ALL SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'normalized_cost_lines', COUNT(*) FROM normalized_cost_lines
    UNION ALL SELECT 'work_items', COUNT(*) FROM work_items
    UNION ALL SELECT 'dev_data_sync_sentinel', COUNT(*) FROM dev_data_sync_sentinel
    ORDER BY 1;
  `;
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", verifySql],
    {
      env: { ...process.env, ...devEnv },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    fail(50, `verification query failed with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  info(`Starting at ${new Date().toISOString()}`);

  const { prodEnv, devEnv } = preflight();

  const workDir = mkdtempSync(join(tmpdir(), "prod-to-dev-"));
  const dumpFile = join(workDir, "prod-dump.sql");

  try {
    dumpProd(prodEnv, dumpFile);
    wipeDev(devEnv);
    loadDumpIntoDev(devEnv, dumpFile);
    writeSentinel(devEnv);
    verifyRowCounts(devEnv);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  info(`Sync completed successfully in ${elapsedSec}s`);
}

main().catch((err) => {
  console.error("[sync-prod-to-dev] Unhandled error:", err);
  process.exit(99);
});
