/**
 * Daily PostgreSQL backup — finance-freeze safety net (step 1: backups).
 *
 * Produces a compressed, self-contained `pg_dump` custom-format archive of the
 * source database, validates that the archive is readable (a real restorable
 * TOC, not a zero-byte file), appends a manifest entry, and prunes old backups
 * by a retention policy. Run by `.github/workflows/db-backup.yml` on a daily
 * schedule, or manually:
 *
 *   DATABASE_URL=postgres://... tsx scripts/backup-db.ts
 *   BACKUP_DIR=/var/backups BACKUP_RETENTION_DAYS=30 tsx scripts/backup-db.ts
 *
 * The companion `scripts/verify-backup-restore.ts` proves the archive restores
 * to a WORKING finance DB. The two together = a *tested* backup, not just a
 * dump file. See docs/finance-freeze-runbook.md § "Restore from backup".
 *
 * Env:
 *   BACKUP_SOURCE_DATABASE_URL | DATABASE_URL  source DB (required)
 *   BACKUP_DIR                 (default ./backups)  where dumps + manifest land
 *   BACKUP_RETENTION_DAYS      (default 30)         prune dumps older than this
 *   BACKUP_MIN_KEEP            (default 7)          never prune below this many
 *
 * Safety: connection credentials are passed to pg_dump via PG* env vars, never
 * as CLI arguments, so passwords never appear in the process listing or logs.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

type PgEnv = {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGSSLMODE?: string;
};

interface ManifestEntry {
  file: string;
  database: string;
  host: string;
  bytes: number;
  sha256: string;
  tocEntries: number;
  createdAt: string;
  pgDumpVersion: string;
}

const SOURCE_URL = process.env.BACKUP_SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? join(process.cwd(), "backups");
const RETENTION_DAYS = clampInt(process.env.BACKUP_RETENTION_DAYS, 30, 1, 3650);
const MIN_KEEP = clampInt(process.env.BACKUP_MIN_KEEP, 7, 1, 1000);
const FILE_PREFIX = "ee";
const FILE_EXT = ".dump";

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function fail(code: number, message: string): never {
  console.error(`[backup-db] ${message}`);
  process.exit(code);
}

function info(message: string): void {
  console.log(`[backup-db] ${message}`);
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

function timestampUtc(now: Date): string {
  // 20260611T184205Z — filesystem-safe, sorts chronologically.
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function pgDumpVersion(): string {
  const r = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  return (r.stdout || "").trim() || "unknown";
}

/** Run pg_dump in custom (compressed, restorable) format. */
function dump(pg: PgEnv, dumpFile: string): void {
  info(`Dumping ${pg.PGHOST}:${pg.PGPORT}/${pg.PGDATABASE} → ${dumpFile}`);
  const r = spawnSync(
    "pg_dump",
    [
      "--format=custom", // restorable archive + built-in compression
      "--no-owner",
      "--no-acl",
      "--quote-all-identifiers",
      "--file",
      dumpFile,
    ],
    { env: { ...process.env, ...pg }, stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) fail(30, `pg_dump failed with exit code ${r.status}`);
  const stat = statSync(dumpFile);
  if (stat.size === 0) fail(31, "pg_dump produced an empty file — refusing to record an empty backup");
  info(`Dump complete: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
}

/**
 * Validate the archive is a real restorable backup by reading its table of
 * contents. A truncated / corrupt dump fails here instead of being discovered
 * only on the day we actually need to restore.
 */
function validateArchive(dumpFile: string): number {
  const r = spawnSync("pg_restore", ["--list", dumpFile], { encoding: "utf8" });
  if (r.status !== 0) {
    fail(32, `pg_restore --list could not read the archive (corrupt dump?): ${r.stderr?.trim() ?? ""}`);
  }
  const entries = (r.stdout || "")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith(";"));
  if (entries.length === 0) {
    fail(33, "archive table-of-contents is empty — refusing to record an unrestorable backup");
  }
  info(`Archive validated: ${entries.length} restorable TOC entries.`);
  return entries.length;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function appendManifest(entry: ManifestEntry): void {
  const manifestPath = join(BACKUP_DIR, "manifest.json");
  let entries: ManifestEntry[] = [];
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (Array.isArray(parsed)) entries = parsed as ManifestEntry[];
    } catch {
      info("Existing manifest.json was unreadable — starting a fresh manifest.");
    }
  }
  entries.push(entry);
  writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
}

/** Prune dumps older than the retention window, always keeping MIN_KEEP newest. */
function prune(now: Date): void {
  const dumps = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(`${FILE_PREFIX}-`) && f.endsWith(FILE_EXT))
    .map((f) => ({ f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  dumps.forEach((entry, idx) => {
    if (idx < MIN_KEEP) return; // always retain the MIN_KEEP most recent
    if (entry.mtime < cutoff) {
      rmSync(join(BACKUP_DIR, entry.f), { force: true });
      pruned += 1;
      info(`Pruned expired backup: ${entry.f}`);
    }
  });
  info(
    pruned === 0
      ? `Retention: nothing to prune (keep newest ${MIN_KEEP}, max age ${RETENTION_DAYS}d).`
      : `Retention: pruned ${pruned} backup(s) older than ${RETENTION_DAYS}d.`,
  );
}

function main(): void {
  const startedAt = Date.now();
  if (!SOURCE_URL) fail(10, "BACKUP_SOURCE_DATABASE_URL / DATABASE_URL is not set");

  let pg: PgEnv;
  try {
    pg = urlToPgEnv("BACKUP_SOURCE_DATABASE_URL/DATABASE_URL", SOURCE_URL);
  } catch (err) {
    fail(11, (err as Error).message);
  }

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const fileName = `${FILE_PREFIX}-${pg.PGDATABASE}-${timestampUtc(now)}${FILE_EXT}`;
  const dumpFile = join(BACKUP_DIR, fileName);

  dump(pg, dumpFile);
  const tocEntries = validateArchive(dumpFile);
  const stat = statSync(dumpFile);

  const entry: ManifestEntry = {
    file: fileName,
    database: pg.PGDATABASE,
    host: pg.PGHOST,
    bytes: stat.size,
    sha256: sha256(dumpFile),
    tocEntries,
    createdAt: now.toISOString(),
    pgDumpVersion: pgDumpVersion(),
  };
  appendManifest(entry);
  prune(now);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  info(`Backup OK in ${elapsed}s — ${fileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB, sha256 ${entry.sha256.slice(0, 12)}…).`);
  // Machine-readable trailer so the CI workflow can locate the artifact.
  console.log(`BACKUP_FILE=${dumpFile}`);
}

main();
