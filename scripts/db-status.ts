#!/usr/bin/env tsx
/**
 * db:status — read-only report of applied vs pending migrations for operators.
 *
 * Compares the committed drizzle journal (migrations/meta/_journal.json + the
 * .sql files) against the migration hashes recorded in
 * `drizzle."__drizzle_migrations"`. A migration is applied iff its SHA-256 is
 * present (the same value drizzle records) — robust to the journal's
 * out-of-order `when` timestamps.
 *
 * Connects directly via DATABASE_URL (no app boot, no DDL, no writes). Exits 0
 * when the schema is up to date, 1 when behind, 2 on an operational error.
 *
 * Run: `npm run db:status`.
 */

import "dotenv/config";
import { Client } from "pg";
import {
  computeReadinessFromHashes,
  formatPendingSummary,
  readHashedMigrations,
} from "../server/lib/schema-readiness";

async function readAppliedHashes(client: Client): Promise<string[]> {
  try {
    const result = await client.query<{ hash: string }>(
      `SELECT hash FROM drizzle."__drizzle_migrations"`,
    );
    return result.rows.map((row) => row.hash).filter((hash): hash is string => typeof hash === "string");
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      console.warn("[db:status] drizzle.__drizzle_migrations does not exist — the DB has never been migrated.");
      return [];
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db:status] DATABASE_URL is not set.");
    process.exit(2);
  }

  const migrations = readHashedMigrations();

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  let appliedHashes: string[];
  try {
    appliedHashes = await readAppliedHashes(client);
  } finally {
    await client.end();
  }

  const readiness = computeReadinessFromHashes(migrations, appliedHashes, "postgres");
  const applied = new Set(appliedHashes);

  console.log("");
  console.log("Migration status (read-only)");
  console.log("────────────────────────────");
  console.log(`Recorded hashes : ${appliedHashes.length}`);
  console.log(`Total committed : ${readiness.totalCount}`);

  // No journal rows + migrations present = the DB is not migrate-managed
  // (db:push-managed or brand new). We cannot determine drift from the journal.
  if (readiness.state === "unknown") {
    console.log("");
    console.log("? Cannot determine drift: drizzle.__drizzle_migrations has no rows.");
    console.log("  The DB is db:push-managed or brand new (not migrate-tracked).");
    console.log("");
    process.exit(0);
  }

  console.log(`Applied         : ${readiness.appliedCount}`);
  console.log(`Pending         : ${readiness.pendingMigrations.length}`);
  console.log("");

  for (const migration of migrations) {
    const mark = applied.has(migration.hash) ? "✓ applied" : "✗ PENDING";
    console.log(`  ${mark}  ${migration.tag}`);
  }
  console.log("");

  if (readiness.ready) {
    console.log("✓ Schema is up to date — no pending migrations.");
    process.exit(0);
  }

  console.log(`✖ Schema is BEHIND — ${formatPendingSummary(readiness)}.`);
  console.log("  Apply with: npm run db:migrate");
  process.exit(1);
}

main().catch((err) => {
  console.error("[db:status] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});
