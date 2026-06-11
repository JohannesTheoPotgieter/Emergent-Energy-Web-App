/**
 * Tested restore — finance-freeze safety net (step 1: backups).
 *
 * Proves a backup produced by `scripts/backup-db.ts` actually restores to a
 * WORKING finance database, not just that a dump file exists. It:
 *   1. restores the archive into a throwaway TARGET database,
 *   2. asserts the canonical finance tables are present and the core ones hold
 *      rows, and
 *   3. computes a finance "fingerprint" (row counts + Σ amount_ex_vat for
 *      revenue and cost lines) on the restored DB — and, when a SOURCE DB is
 *      supplied, asserts the restored numbers equal the source numbers exactly.
 *
 * That last check is the point: it proves the actual finance NUMBERS survive a
 * dump→restore round-trip, which is what an auditor / the owner cares about.
 *
 * Usage (CI restore-drill, with equality check against prod):
 *   RESTORE_TARGET_DATABASE_URL=postgres://...scratch \
 *   BACKUP_SOURCE_DATABASE_URL=postgres://...prod \
 *   tsx scripts/verify-backup-restore.ts --dump backups/ee-...dump
 *
 * Usage (DR drill from an archive only, no source to compare):
 *   RESTORE_TARGET_DATABASE_URL=postgres://...scratch \
 *   tsx scripts/verify-backup-restore.ts --dump backups/ee-...dump
 *
 * Exit code is non-zero on ANY failure (missing table, empty core table,
 * fingerprint mismatch) so it is safe to gate a CI job on.
 *
 * SAFETY: the TARGET is refused if it looks like production (host/db hint), so
 * a restore drill can never clobber the live database.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type PgEnv = {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGSSLMODE?: string;
};

interface FinanceFingerprint {
  revLineCount: number;
  revAmountExVat: string;
  costLineCount: number;
  costAmountExVat: string;
  projectCount: number;
}

const PROD_HOST_HINTS = ["production", "prod-", ".prod.", "live-", ".live."];

/** Canonical finance tables that MUST exist for the restore to be "a finance DB". */
const REQUIRED_FINANCE_TABLES = [
  "project_info",
  "users",
  "normalized_revenue_lines",
  "normalized_cost_lines",
  "cashflow_points",
  "finance_revenue_monthly",
  "finance_cos_monthly",
  "finance_integrity_runs",
];

/** Tables that must hold at least one row in a real finance DB. */
const NON_EMPTY_TABLES = ["project_info", "normalized_revenue_lines"];

function fail(code: number, message: string): never {
  console.error(`[verify-restore] FAIL — ${message}`);
  process.exit(code);
}

function info(message: string): void {
  console.log(`[verify-restore] ${message}`);
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
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

function assertNotProduction(target: PgEnv): void {
  const haystack = `${target.PGHOST} ${target.PGDATABASE}`.toLowerCase();
  const hint = PROD_HOST_HINTS.find((h) => haystack.includes(h));
  if (hint) {
    fail(
      14,
      `REFUSING: RESTORE_TARGET_DATABASE_URL looks like production (matched "${hint}"). ` +
        `A restore drill must point at a scratch database, never the live one.`,
    );
  }
}

function latestDumpInBackupDir(): string {
  const dir = process.env.BACKUP_DIR ?? join(process.cwd(), "backups");
  if (!existsSync(dir)) fail(20, `no --dump given and BACKUP_DIR (${dir}) does not exist`);
  const dumps = readdirSync(dir)
    .filter((f) => f.startsWith("ee-") && f.endsWith(".dump"))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (dumps.length === 0) fail(21, `no --dump given and no ee-*.dump found in ${dir}`);
  return join(dir, dumps[0].f);
}

/** psql -tAc helper returning trimmed scalar stdout (single value). */
function psqlScalar(pg: PgEnv, sql: string, errLabel: string): string {
  const r = spawnSync(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: { ...process.env, ...pg }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (r.status !== 0) fail(40, `psql query failed (${errLabel}) with exit code ${r.status}`);
  return (r.stdout || "").trim();
}

function restoreArchive(target: PgEnv, dumpFile: string): void {
  info(`Restoring ${dumpFile} → ${target.PGHOST}:${target.PGPORT}/${target.PGDATABASE}`);
  const r = spawnSync(
    "pg_restore",
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--dbname",
      target.PGDATABASE,
      dumpFile,
    ],
    { env: { ...process.env, ...target }, stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) fail(42, `pg_restore failed with exit code ${r.status}`);
  info("Restore complete.");
}

function assertTablesPresent(pg: PgEnv): void {
  const values = REQUIRED_FINANCE_TABLES.map((t) => `('${t}')`).join(", ");
  const sql = `
    SELECT expected.t
    FROM (VALUES ${values}) AS expected(t)
    WHERE to_regclass(expected.t) IS NULL;
  `;
  const r = spawnSync(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: { ...process.env, ...pg }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (r.status !== 0) fail(43, `table-presence query failed with exit code ${r.status}`);
  const missing = (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (missing.length > 0) {
    fail(44, `restore is missing required finance table(s): ${missing.join(", ")}`);
  }
  info(`All ${REQUIRED_FINANCE_TABLES.length} required finance tables present.`);
}

function assertNonEmpty(pg: PgEnv): void {
  for (const table of NON_EMPTY_TABLES) {
    const n = Number(psqlScalar(pg, `SELECT COUNT(*) FROM "${table}";`, `count ${table}`));
    if (!Number.isFinite(n) || n <= 0) {
      fail(45, `restored finance table "${table}" is empty — a working finance DB must have rows here`);
    }
    info(`  ${table}: ${n} rows`);
  }
}

function fingerprint(pg: PgEnv): FinanceFingerprint {
  return {
    revLineCount: Number(psqlScalar(pg, `SELECT COUNT(*) FROM "normalized_revenue_lines";`, "rev count")),
    revAmountExVat: psqlScalar(
      pg,
      `SELECT COALESCE(SUM("amount_ex_vat"), 0)::text FROM "normalized_revenue_lines";`,
      "rev sum",
    ),
    costLineCount: Number(psqlScalar(pg, `SELECT COUNT(*) FROM "normalized_cost_lines";`, "cost count")),
    costAmountExVat: psqlScalar(
      pg,
      `SELECT COALESCE(SUM("amount_ex_vat"), 0)::text FROM "normalized_cost_lines";`,
      "cost sum",
    ),
    projectCount: Number(psqlScalar(pg, `SELECT COUNT(*) FROM "project_info";`, "project count")),
  };
}

function fingerprintsEqual(a: FinanceFingerprint, b: FinanceFingerprint): boolean {
  return (
    a.revLineCount === b.revLineCount &&
    a.costLineCount === b.costLineCount &&
    a.projectCount === b.projectCount &&
    Number(a.revAmountExVat) === Number(b.revAmountExVat) &&
    Number(a.costAmountExVat) === Number(b.costAmountExVat)
  );
}

function main(): void {
  const startedAt = Date.now();

  const targetUrl = process.env.RESTORE_TARGET_DATABASE_URL ?? "";
  if (!targetUrl) fail(10, "RESTORE_TARGET_DATABASE_URL is not set");

  let target: PgEnv;
  try {
    target = urlToPgEnv("RESTORE_TARGET_DATABASE_URL", targetUrl);
  } catch (err) {
    fail(11, (err as Error).message);
  }
  assertNotProduction(target);

  const dumpFile = argValue("--dump") ?? latestDumpInBackupDir();
  if (!existsSync(dumpFile)) fail(22, `dump file not found: ${dumpFile}`);

  const sourceUrl = process.env.BACKUP_SOURCE_DATABASE_URL ?? "";
  let source: PgEnv | null = null;
  if (sourceUrl) {
    try {
      source = urlToPgEnv("BACKUP_SOURCE_DATABASE_URL", sourceUrl);
    } catch (err) {
      fail(12, (err as Error).message);
    }
    if (source.PGHOST === target.PGHOST && source.PGPORT === target.PGPORT && source.PGDATABASE === target.PGDATABASE) {
      fail(13, "REFUSING: source and restore target are the same database");
    }
  }

  // Capture source fingerprint BEFORE the restore so a same-cluster self-test
  // reads the real source, not a half-restored target.
  const sourceFp = source ? fingerprint(source) : null;

  restoreArchive(target, dumpFile);
  assertTablesPresent(target);
  assertNonEmpty(target);

  const restoredFp = fingerprint(target);
  info(
    `Restored finance fingerprint: rev=${restoredFp.revLineCount} lines / Σ ${restoredFp.revAmountExVat}; ` +
      `cost=${restoredFp.costLineCount} lines / Σ ${restoredFp.costAmountExVat}; projects=${restoredFp.projectCount}.`,
  );

  if (sourceFp) {
    if (!fingerprintsEqual(sourceFp, restoredFp)) {
      console.error("[verify-restore] source   :", JSON.stringify(sourceFp));
      console.error("[verify-restore] restored :", JSON.stringify(restoredFp));
      fail(50, "finance fingerprint mismatch — the restored numbers do NOT equal the source numbers");
    }
    info("Finance fingerprint MATCHES source exactly — numbers survived the round-trip.");
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  info(`PASS — backup restores to a working finance DB (verified in ${elapsed}s).`);
}

main();
