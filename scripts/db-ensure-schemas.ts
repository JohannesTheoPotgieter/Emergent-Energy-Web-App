#!/usr/bin/env tsx
/**
 * db:push pre-step — ensure every PG schema that shared/schema declares
 * (e.g. pgSchema("core")) exists before drizzle-kit push runs.
 *
 * drizzle-kit 0.31.x push with a schemaFilter that names a not-yet-created
 * schema fails its introspection query ('schema "core" does not exist',
 * SQLSTATE 3F000) without creating the schema first — and still exits 0, so
 * the failure is silent and the target DB is left untouched. Creating the
 * schemas up front (additive, IF NOT EXISTS) makes push deterministic.
 *
 * The schema list is derived from the Drizzle definitions, never hardcoded.
 */

import "dotenv/config";
import { Client } from "pg";
import { deriveExpectedTables } from "../server/lib/schema-verification";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db:ensure-schemas] DATABASE_URL is not set.");
    process.exit(2);
  }

  const schemas = [
    ...new Set(
      deriveExpectedTables()
        .map((table) => table.schema)
        .filter((schema) => schema !== "public"),
    ),
  ].sort();

  if (schemas.length === 0) {
    console.log("[db:ensure-schemas] No non-public schemas declared; nothing to do.");
    return;
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  try {
    for (const schema of schemas) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema.replace(/"/g, '""')}";`);
      console.log(`[db:ensure-schemas] ensured schema "${schema}".`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[db:ensure-schemas] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});
