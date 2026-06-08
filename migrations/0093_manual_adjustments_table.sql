-- 0093_manual_adjustments_table.sql
--
-- Additive + idempotent. The original raw `CREATE TABLE` (no IF NOT EXISTS)
-- collided on a dev DB where this table was partially materialized by an
-- earlier `drizzle-kit push` (table + pkey present, FKs/indexes missing),
-- which rolled back the whole `db:migrate` transaction. Rewritten to the
-- 0089 drift-repair convention: CREATE TABLE IF NOT EXISTS, FK constraints in
-- duplicate-safe DO blocks, indexes IF NOT EXISTS. Safe no-op on a healthy DB;
-- creates everything fresh on prod. Canary probe in scripts/drizzle-bootstrap.ts.

CREATE TABLE IF NOT EXISTS "manual_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"project_id" integer,
	"fiscal_period_id" integer,
	"adjustment_type" text NOT NULL,
	"value" numeric(15, 2),
	"reason" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_adjustments_scope_period_active_idx" ON "manual_adjustments" USING btree ("scope","fiscal_period_id") WHERE "manual_adjustments"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_adjustments_project_active_idx" ON "manual_adjustments" USING btree ("project_id") WHERE "manual_adjustments"."effective_to" IS NULL;
