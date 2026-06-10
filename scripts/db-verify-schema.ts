#!/usr/bin/env tsx
/**
 * db:verify-schema — prove the LIVE database schema matches shared/schema
 * at column level. The migration ledger is not consulted at all: a ledger
 * can report a migration applied while its DDL never ran (the 0071 /
 * 0090–0096 class). This script asks the only ground truth —
 * information_schema — whether every Drizzle-declared table and column
 * actually exists.
 *
 * Failure model (additive-only schema policy):
 *   - MISSING declared tables/columns  → FAIL (exit 1). The app would 500.
 *   - EXTRA tables/columns in the DB   → reported as info; pass by default
 *     (legacy/baseline artifacts are expected on long-lived DBs). Pass
 *     `--strict` to fail on extras too (useful on a throwaway DB).
 *
 * Connects directly via DATABASE_URL (no app boot, read-only). Exit codes:
 * 0 = verified, 1 = drift, 2 = operational error.
 *
 * Run: `npm run db:verify-schema` (used by CI's migration-integrity job and
 * the release gate).
 */

import "dotenv/config";
import { Client } from "pg";
import {
  buildVerification,
  compareSchemas,
  deriveExpectedTables,
  formatDriftSummary,
  planAdditiveRepair,
  type LiveColumn,
  type SchemaComparison,
} from "../server/lib/schema-verification";

const STRICT = process.argv.includes("--strict");
// --repair: when drift is found, apply the ADDITIVE repair plan derived from
// shared/schema (ADD COLUMN IF NOT EXISTS / minimal CREATE TABLE — never a
// drop), then re-verify. `npm run db:migrate` chains this after drizzle-kit
// so the deploy command itself converges and CANNOT exit 0 while declared
// columns are missing.
const REPAIR = process.argv.includes("--repair");

async function queryLiveColumns(client: Client): Promise<LiveColumn[]> {
  const result = await client.query<{
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

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db:verify-schema] DATABASE_URL is not set.");
    process.exit(2);
  }

  const expected = deriveExpectedTables();

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  let comparison: SchemaComparison;
  try {
    let liveColumns: LiveColumn[] = await queryLiveColumns(client);
    comparison = compareSchemas(expected, liveColumns);

    if (
      REPAIR &&
      (comparison.missingTables.length > 0 || comparison.missingColumns.length > 0)
    ) {
      const plan = planAdditiveRepair(expected, comparison);
      console.log(`[db:verify-schema] drift found — applying ${plan.length} additive repair statement(s):`);
      for (const statement of plan) {
        console.log(`  ${statement.replace(/\s+/g, " ").slice(0, 160)}`);
        await client.query(statement);
      }
      liveColumns = await queryLiveColumns(client);
      comparison = compareSchemas(expected, liveColumns);
    }
  } finally {
    await client.end();
  }

  const verification = buildVerification(comparison, expected.length);

  console.log("");
  console.log("Live schema verification (ledger-independent, read-only)");
  console.log("─────────────────────────────────────────────────────────");
  console.log(`Declared tables (shared/schema) : ${expected.length}`);
  console.log(`Missing tables                  : ${comparison.missingTables.length}`);
  console.log(`Missing columns                 : ${comparison.missingColumns.length}`);
  console.log(`Extra tables (info)             : ${comparison.extraTables.length}`);
  console.log(`Extra columns (info)            : ${comparison.extraColumns.length}`);
  console.log("");

  for (const table of comparison.missingTables) {
    console.log(`  ✗ MISSING TABLE   ${table}`);
  }
  for (const column of comparison.missingColumns) {
    console.log(`  ✗ MISSING COLUMN  ${column.table}.${column.column}`);
  }
  if (comparison.extraTables.length > 0) {
    console.log(`  ℹ extra tables: ${comparison.extraTables.join(", ")}`);
  }
  if (comparison.extraColumns.length > 0) {
    const rendered = comparison.extraColumns.map((c) => `${c.table}.${c.column}`).join(", ");
    console.log(`  ℹ extra columns: ${rendered}`);
  }
  console.log("");

  if (!verification.ok) {
    console.log(`✖ DRIFT — ${formatDriftSummary(verification)}.`);
    console.log("  The migration ledger may still claim these are applied. Recover with the");
    console.log("  matching drift-repair migration: npm run db:migrate, then re-run this check.");
    process.exit(1);
  }

  if (STRICT && (comparison.extraTables.length > 0 || comparison.extraColumns.length > 0)) {
    console.log("✖ STRICT mode: live DB has artifacts not declared in shared/schema (see above).");
    process.exit(1);
  }

  console.log(`✓ Live schema matches shared/schema at column level (${expected.length} tables verified).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:verify-schema] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});
