/**
 * Schema readiness — is the live DB caught up with the committed migrations?
 *
 * Background. Deploy runs `npm run build && npm run db:migrate`; the dev
 * workflow (`npm run dev`) does NOT migrate. When migrations are merged but
 * never applied (the 0090–0096 incident), every finance endpoint threw raw
 * Drizzle 500s ("relation financial_reconciliation does not exist") and the
 * derived-kpis scheduler spammed fatal errors every cycle. This module turns
 * that silent-and-fatal state into a loud-and-safe one.
 *
 * Detection is by HASH PRESENCE, not by the drizzle "created_at watermark".
 * drizzle records each applied migration's SHA-256 (of its .sql) in
 * `drizzle.__drizzle_migrations`; a journal entry is applied iff that hash is
 * present. The watermark (`MAX(created_at)`) is deliberately NOT used: this
 * repo's journal has an out-of-order, future-dated entry
 * (`0079_dev_drift_repair`, when=1782000000000) that pins the watermark above
 * the 0090–0096 tail, so a watermark check would falsely report "ready" for
 * exactly the incident this guards against. Hash presence is immune to
 * `when` ordering.
 *
 * This file is intentionally free of any `server/db` import so it can be used
 * from the standalone `scripts/db-status.ts` CLI and from unit tests without
 * booting the app or requiring a database connection. The app-facing glue
 * (applied-hash query + boot gate) lives in
 * `server/bootstrap/schema-readiness-runtime.ts`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface MigrationJournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface HashedMigration extends MigrationJournalEntry {
  /** SHA-256 of the migration's .sql file — the value drizzle records. */
  hash: string;
}

export type SchemaReadinessState = "ready" | "schema_behind" | "unknown";

export interface SchemaReadiness {
  /** True when nothing is pending (or readiness does not apply, e.g. SQLite). */
  ready: boolean;
  state: SchemaReadinessState;
  mode: "postgres" | "sqlite";
  /** Tags the DB has not recorded as applied, in journal (idx) order. */
  pendingMigrations: string[];
  appliedCount: number;
  totalCount: number;
  checkedAt: string;
  /** Set only when readiness could not be determined (state "unknown"). */
  error?: string;
}

interface RawJournal {
  entries?: Array<{ idx?: number; when?: number; tag?: string }>;
}

export function resolveMigrationsDir(migrationsDir?: string): string {
  return migrationsDir ?? path.resolve(process.cwd(), "migrations");
}

/**
 * Read and normalise the drizzle journal (oldest entry first). Throws if the
 * journal file is missing or malformed — callers decide how to handle that
 * (boot/gate fail open, the CLI surfaces the error).
 */
export function readJournalEntries(migrationsDir?: string): MigrationJournalEntry[] {
  const journalPath = path.join(resolveMigrationsDir(migrationsDir), "meta", "_journal.json");
  const parsed = JSON.parse(readFileSync(journalPath, "utf-8")) as RawJournal;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return entries
    .filter(
      (entry): entry is MigrationJournalEntry =>
        typeof entry.idx === "number" &&
        typeof entry.when === "number" &&
        typeof entry.tag === "string",
    )
    .map((entry) => ({ idx: entry.idx, when: entry.when, tag: entry.tag }))
    .sort((a, b) => a.idx - b.idx);
}

function hashMigrationSql(tag: string, migrationsDir: string): string {
  const sql = readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf-8");
  return createHash("sha256").update(sql).digest("hex");
}

// Journal + file hashes are immutable for the life of the process (new
// migrations require a restart/redeploy), so read+hash the set once per dir.
const hashedMigrationsCache = new Map<string, HashedMigration[]>();

export function readHashedMigrations(migrationsDir?: string): HashedMigration[] {
  const dir = resolveMigrationsDir(migrationsDir);
  const cachedHashes = hashedMigrationsCache.get(dir);
  if (cachedHashes) return cachedHashes;
  const hashed = readJournalEntries(dir).map((entry) => ({
    ...entry,
    hash: hashMigrationSql(entry.tag, dir),
  }));
  hashedMigrationsCache.set(dir, hashed);
  return hashed;
}

/**
 * Pure readiness computation — no I/O. A migration is pending iff its hash is
 * not present in the applied set recorded by drizzle.
 */
export function computeReadinessFromHashes(
  migrations: HashedMigration[],
  appliedHashes: Iterable<string>,
  mode: "postgres" | "sqlite" = "postgres",
): SchemaReadiness {
  const applied = appliedHashes instanceof Set ? appliedHashes : new Set(appliedHashes);
  const sorted = [...migrations].sort((a, b) => a.idx - b.idx);
  const pendingMigrations = sorted.filter((m) => !applied.has(m.hash)).map((m) => m.tag);
  const ready = pendingMigrations.length === 0;

  return {
    ready,
    state: ready ? "ready" : "schema_behind",
    mode,
    pendingMigrations,
    appliedCount: sorted.length - pendingMigrations.length,
    totalCount: sorted.length,
    checkedAt: new Date().toISOString(),
  };
}

let cached: SchemaReadiness | null = null;

export function getCachedSchemaReadiness(): SchemaReadiness | null {
  return cached;
}

export function setCachedSchemaReadiness(readiness: SchemaReadiness): void {
  cached = readiness;
}

/**
 * True ONLY when we have positively determined the DB is behind. Unknown /
 * not-yet-checked / errored states fail OPEN (return false) so the readiness
 * feature can never itself take finance down.
 */
export function isSchemaBehind(readiness: SchemaReadiness | null = cached): boolean {
  return readiness?.state === "schema_behind";
}

export function formatPendingSummary(readiness: SchemaReadiness): string {
  const count = readiness.pendingMigrations.length;
  if (count === 0) return "no pending migrations";
  return `${count} pending migration(s): ${readiness.pendingMigrations.join(", ")}`;
}

export interface EvaluateSchemaReadinessDeps {
  mode: "postgres" | "sqlite";
  /** Returns the hashes recorded in drizzle.__drizzle_migrations. */
  queryAppliedHashes: () => Promise<string[]>;
  migrationsDir?: string;
}

/**
 * Evaluate readiness against the live DB and update the module cache. SQLite
 * dev fallbacks are kept current by the additive bootstrap in `server/db.ts`
 * (not the drizzle journal), so readiness does not apply and reports ready.
 * Any failure fails open as state "unknown" so nothing is blocked.
 */
export async function evaluateSchemaReadiness(
  deps: EvaluateSchemaReadinessDeps,
): Promise<SchemaReadiness> {
  if (deps.mode === "sqlite") {
    const readiness: SchemaReadiness = {
      ready: true,
      state: "ready",
      mode: "sqlite",
      pendingMigrations: [],
      appliedCount: 0,
      totalCount: 0,
      checkedAt: new Date().toISOString(),
    };
    setCachedSchemaReadiness(readiness);
    return readiness;
  }

  try {
    const migrations = readHashedMigrations(deps.migrationsDir);
    const appliedHashes = await deps.queryAppliedHashes();
    const readiness = computeReadinessFromHashes(migrations, appliedHashes, "postgres");
    setCachedSchemaReadiness(readiness);
    return readiness;
  } catch (err) {
    const readiness: SchemaReadiness = {
      ready: true,
      state: "unknown",
      mode: "postgres",
      pendingMigrations: [],
      appliedCount: 0,
      totalCount: 0,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    setCachedSchemaReadiness(readiness);
    return readiness;
  }
}
