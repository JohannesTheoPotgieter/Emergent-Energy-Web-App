-- 0091_financial_reconciliation_table.sql
--
-- Additive + idempotent. The original raw `CREATE TABLE` (no IF NOT EXISTS)
-- collided on a dev DB where this table was partially materialized by an
-- earlier `drizzle-kit push` (table + pkey present, FKs/indexes missing),
-- which rolled back the whole `db:migrate` transaction. Rewritten to the
-- 0089 drift-repair convention: CREATE TABLE IF NOT EXISTS, FK constraints in
-- duplicate-safe DO blocks, indexes IF NOT EXISTS. Safe no-op on a healthy DB;
-- creates everything fresh on prod. Canary probe in scripts/drizzle-bootstrap.ts.

CREATE TABLE IF NOT EXISTS "financial_reconciliation" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fiscal_period_id" integer NOT NULL,
	"app_vs_tracker_status" text,
	"app_vs_tracker_delta" numeric(15, 2),
	"tracker_vs_qb_status" text,
	"tracker_vs_qb_delta" numeric(15, 2),
	"computed_at" timestamp with time zone,
	"notes" text,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_reconciliation_project_period_active_idx" ON "financial_reconciliation" USING btree ("project_id","fiscal_period_id") WHERE "financial_reconciliation"."effective_to" IS NULL;
