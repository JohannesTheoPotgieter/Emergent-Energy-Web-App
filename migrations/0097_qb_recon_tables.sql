-- 0097_qb_recon_tables.sql
--
-- Additive + idempotent (0089/0091 drift-repair convention): CREATE TABLE IF
-- NOT EXISTS, FK constraints in duplicate-safe DO blocks, indexes IF NOT EXISTS.
-- Safe no-op on a healthy DB; creates everything fresh on prod. Canary probe in
-- scripts/drizzle-bootstrap.ts (required because 0079_dev_drift_repair carries a
-- future-dated journal `when` that pins drizzle's created_at watermark above
-- this migration, so the bootstrap must reset it for plain migrate to apply 0097).
--
-- Company-wide tracker-vs-QuickBooks reconciliation (NO project dimension).

CREATE TABLE IF NOT EXISTS "qb_recon_line" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"invoice_no_raw" text,
	"invoice_no_norm" text NOT NULL,
	"tracker_amount_ex_vat" numeric(15, 2),
	"qb_amount_ex_vat" numeric(15, 2),
	"delta" numeric(15, 2),
	"status" text NOT NULL,
	"tracker_date" date,
	"qb_date" date,
	"fiscal_period_id" integer,
	"timing_flag" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_recon_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_grain" text NOT NULL,
	"period_key" text NOT NULL,
	"fiscal_period_id" integer,
	"stream" text NOT NULL,
	"tracker_total" numeric(15, 2),
	"qb_total" numeric(15, 2),
	"matched_total" numeric(15, 2),
	"variance_total" numeric(15, 2),
	"tracker_only_total" numeric(15, 2),
	"qb_only_total" numeric(15, 2),
	"computed_at" timestamp with time zone,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "qb_recon_line" ADD CONSTRAINT "qb_recon_line_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "qb_recon_summary" ADD CONSTRAINT "qb_recon_summary_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_recon_line_active_idx" ON "qb_recon_line" USING btree ("stream","status") WHERE "qb_recon_line"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_recon_line_period_active_idx" ON "qb_recon_line" USING btree ("fiscal_period_id") WHERE "qb_recon_line"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_recon_summary_active_idx" ON "qb_recon_summary" USING btree ("period_grain","stream") WHERE "qb_recon_summary"."effective_to" IS NULL;
