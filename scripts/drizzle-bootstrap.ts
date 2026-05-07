/**
 * Drizzle bootstrap — seeds `drizzle.__drizzle_migrations` so that
 * `drizzle-kit migrate` is safe to run against an existing schema.
 *
 * Background. This project historically used `drizzle-kit push` and
 * relied on `ENABLE_STARTUP_SCHEMA_REPAIR=true` to keep prod aligned
 * with `shared/schema/*.ts`. The deploy build was recently changed to
 * `npm run build && npm run db:migrate`. `drizzle-kit migrate` tracks
 * applied migrations in `drizzle.__drizzle_migrations`, but on a DB
 * that was previously managed by `push`, that table is empty. The
 * migrator would then try to apply ALL 56 historical migrations
 * (including the non-idempotent baseline `0000_baseline_20260419.sql`,
 * whose own header explicitly says "DO NOT re-apply this baseline to
 * prod") and crash on the first `CREATE TYPE` / `CREATE TABLE`.
 *
 * What this script does.
 *  1. Opens a pg connection using DATABASE_URL.
 *  2. Detects whether the DB already has the application schema by
 *     checking for a small set of well-known core tables (project_info
 *     and users). If neither exists we treat it as a fresh DB and bail
 *     out — drizzle-kit migrate will run from scratch in the normal
 *     way.
 *  3. Ensures the `drizzle` schema and `drizzle.__drizzle_migrations`
 *     table exist (created with the same shape drizzle-kit creates).
 *  4. If the table is non-empty, leaves it alone (someone else has
 *     already bootstrapped it; drizzle-kit will pick up any newer
 *     entries on its own).
 *  5. Otherwise reads `migrations/meta/_journal.json`, computes
 *     `crypto.createHash('sha256').update(<raw file contents>)` for
 *     each entry — matching drizzle-orm/migrator.js exactly — and
 *     INSERTs one row per journal entry, with `created_at = entry.when`
 *     so the next `drizzle-kit migrate` call sees the latest applied
 *     entry as more recent than every existing journal entry and
 *     proceeds to apply only NEW entries added after this point.
 *
 * Run directly via `tsx scripts/drizzle-bootstrap.ts`. The deploy
 * build chains it before `drizzle-kit migrate` (see package.json
 * `db:migrate` script).
 *
 * Idempotent: safe to run repeatedly. On a freshly bootstrapped DB it
 * is a no-op. On a brand-new DB (no app schema present) it is also a
 * no-op so dev/CI flows are unaffected.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[drizzle-bootstrap] DATABASE_URL is not set; skipping.");
    process.exit(0);
  }

  const journalRaw = await readFile(JOURNAL_PATH, "utf-8");
  const journal = JSON.parse(journalRaw) as Journal;
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    console.log("[drizzle-bootstrap] No entries in journal; nothing to do.");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Step 1 — Detect existing app schema. If neither core table
    // exists this is a fresh DB; let `drizzle-kit migrate` run the
    // baseline as designed.
    const probe = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('project_info', 'users')
       ) AS exists;`,
    );
    const schemaExists = probe.rows[0]?.exists === true;
    if (!schemaExists) {
      console.log(
        "[drizzle-bootstrap] No existing app schema detected (no public.project_info or public.users). " +
          "Skipping backfill so drizzle-kit migrate can apply the baseline normally.",
      );
      return;
    }

    // Step 2 — Ensure the drizzle bookkeeping table exists with the
    // same shape drizzle-kit creates internally.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       );`,
    );

    // Step 3 — If the table already has rows, do not touch it. Either
    // a previous bootstrap ran or drizzle-kit migrate has been used
    // before; either way the migrator can take it from here.
    const countRes = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "drizzle"."__drizzle_migrations";`,
    );
    const existing = Number(countRes.rows[0]?.count ?? "0");
    if (existing > 0) {
      console.log(
        `[drizzle-bootstrap] __drizzle_migrations already has ${existing} row(s); leaving it alone.`,
      );
      return;
    }

    // Step 4 — Backfill every journal entry with the matching SHA256
    // hash (same recipe as node_modules/drizzle-orm/migrator.js:
    // `crypto.createHash('sha256').update(query).digest('hex')`). The
    // hash is over the raw file contents — no normalisation, no
    // statement-breakpoint splitting.
    await client.query("BEGIN");
    try {
      for (const entry of journal.entries) {
        const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
        const sql = await readFile(sqlPath, "utf-8");
        const hash = createHash("sha256").update(sql).digest("hex");
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2);`,
          [hash, entry.when],
        );
      }
      await client.query("COMMIT");
      console.log(
        `[drizzle-bootstrap] Backfilled ${journal.entries.length} migration entries. ` +
          "Subsequent drizzle-kit migrate runs will only apply NEW entries.",
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[drizzle-bootstrap] FAILED:", err);
  process.exit(1);
});
