#!/usr/bin/env tsx
/**
 * One-off repair for the `execution_review_items` table.
 *
 * Why this exists: on some databases the migration ledger marked migration
 * 0108 as applied while its DDL never ran (the same "applied-but-didn't-run"
 * class db:verify-schema warns about). Because `db:verify-schema --repair`
 * only creates missing tables/columns — not enum TYPES — its CREATE TABLE
 * failed with `type "execution_review_status" does not exist`, so nothing was
 * created and the Flags tab / item CRUD 500s.
 *
 * This script applies the full 0108 DDL idempotently (enum types → table →
 * foreign keys), so it is safe to run more than once. It connects directly via
 * DATABASE_URL (no app boot), exactly like db:verify-schema.
 *
 * Run on Replit (where DATABASE_URL is the live DB):
 *   tsx scripts/repair-execution-review-table.ts
 */

import "dotenv/config";
import { Client } from "pg";

const DDL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_review_status') THEN
    CREATE TYPE "public"."execution_review_status" AS ENUM('open', 'flagged', 'actioned', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_review_severity') THEN
    CREATE TYPE "public"."execution_review_severity" AS ENUM('low', 'medium', 'high', 'critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "execution_review_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "status" "execution_review_status" DEFAULT 'open' NOT NULL,
  "severity" "execution_review_severity" DEFAULT 'medium' NOT NULL,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "owner_user_id" integer,
  "due_date" date,
  "meeting_date" date,
  "plan_task_no" text,
  "plan_work_item_id" integer,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execution_review_items_project_id_project_info_id_fk') THEN
    ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_project_id_project_info_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execution_review_items_owner_user_id_users_id_fk') THEN
    ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_owner_user_id_users_id_fk"
      FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execution_review_items_created_by_users_id_fk') THEN
    ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[repair] DATABASE_URL is not set.");
    process.exit(2);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(DDL);
    await client.query("COMMIT");
    const { rows } = await client.query(
      `SELECT to_regclass('public.execution_review_items') AS tbl,
              (SELECT count(*)::int FROM pg_type WHERE typname IN ('execution_review_status','execution_review_severity')) AS enum_count`,
    );
    const present = rows[0]?.tbl;
    console.log(`[repair] execution_review_items: ${present ?? "MISSING"} | enum types: ${rows[0]?.enum_count}/2`);
    if (!present) {
      console.error("[repair] FAILED — table still missing after repair.");
      process.exit(1);
    }
    console.log("[repair] ✓ Done. The Flags tab and item CRUD will now work.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[repair] FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[repair] Unexpected error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
