-- Migration-ledger integrity repair (2026-06-22) — re-assert 0108 + 0109.
--
-- 0108_execution_review_items and 0109_milestone_tracker_links were recorded
-- as applied while their DDL never ran on prod. Both shipped WITHOUT a probe
-- in scripts/drizzle-bootstrap.ts, so the bootstrap backfilled them as
-- "presumed applied" (inserted=2) and drizzle-kit migrate then saw nothing
-- pending. The deploy's db:verify-schema --repair found execution_review_items
-- missing and emitted a minimal CREATE TABLE, which FAILED on the absent enum
-- type "execution_review_status" — planAdditiveRepair creates tables/columns
-- but never enum TYPEs. Same class of failure as 0102's re-assert of 0071.
--
-- This migration re-runs 0108 + 0109 verbatim but FULLY GUARDED
-- (duplicate_object DO blocks / IF NOT EXISTS), so on a healthy DB it is a
-- pure no-op; on a drifted DB it converges the schema. A multi-artifact
-- canary in scripts/drizzle-bootstrap.ts forces replay on any DB where the
-- artifacts are missing.

-- ── 0108: enum types (CREATE TYPE has no IF NOT EXISTS — guard with DO block) ──
DO $$ BEGIN
  CREATE TYPE "public"."execution_review_severity" AS ENUM('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."execution_review_status" AS ENUM('open', 'flagged', 'actioned', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 0108: execution_review_items table ──
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
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 0109: milestone tracker link tables ──
CREATE TABLE IF NOT EXISTS "revenue_milestone_task_links" (
"id" serial PRIMARY KEY NOT NULL,
"project_id" integer NOT NULL,
"revenue_row_hash" text NOT NULL,
"work_item_id" integer NOT NULL,
"created_by" integer,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_cost_line_links" (
"id" serial PRIMARY KEY NOT NULL,
"project_id" integer NOT NULL,
"work_item_id" integer NOT NULL,
"cost_row_hash" text NOT NULL,
"created_by" integer,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_milestone_task_links_uniq" ON "revenue_milestone_task_links" USING btree ("project_id","revenue_row_hash","work_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_milestone_task_links_project_idx" ON "revenue_milestone_task_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_milestone_task_links_task_idx" ON "revenue_milestone_task_links" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_cost_line_links_uniq" ON "task_cost_line_links" USING btree ("project_id","work_item_id","cost_row_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_cost_line_links_project_idx" ON "task_cost_line_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_cost_line_links_task_idx" ON "task_cost_line_links" USING btree ("work_item_id");
