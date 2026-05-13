/**
 * Additive DDL for priority collaboration tables.
 * Runs CREATE TABLE IF NOT EXISTS — fully idempotent; safe to run on every
 * startup. Separate from the startup_backfills_v1 gate so it applies even
 * when that one-time flag is already set.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function runPriorityTablesDdl(log: (msg: string, src?: string) => void) {
  const tables: Array<{ name: string; ddl: string }> = [
    {
      name: "priority_comments",
      ddl: `
        CREATE TABLE IF NOT EXISTS priority_comments (
          id SERIAL PRIMARY KEY,
          priority_id INTEGER NOT NULL REFERENCES mytool_company_priorities(id) ON DELETE CASCADE,
          author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_name TEXT,
          body TEXT NOT NULL,
          edited_at TIMESTAMP,
          deleted_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `,
    },
    {
      name: "priority_watches",
      ddl: `
        CREATE TABLE IF NOT EXISTS priority_watches (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          priority_id INTEGER NOT NULL REFERENCES mytool_company_priorities(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT priority_watches_unique UNIQUE(user_id, priority_id)
        )
      `,
    },
  ];

  for (const table of tables) {
    try {
      await db.execute(sql.raw(table.ddl));
      log(`Table ${table.name} ensured`, "Startup:PriorityDdl");
    } catch (err: unknown) {
      log(
        `Priority DDL for ${table.name} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        "Startup:PriorityDdl",
      );
    }
  }
}
