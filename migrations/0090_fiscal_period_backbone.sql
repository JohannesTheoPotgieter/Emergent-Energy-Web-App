-- 0090_fiscal_period_backbone.sql
--
-- Additive + idempotent. The bootstrap replays the whole batch >= the lowered
-- watermark in one transaction, so every replayed migration must be safe on an
-- already-applied DB. Rewritten to ADD COLUMN IF NOT EXISTS + FK constraints in
-- duplicate-safe DO blocks (0089 convention). Canary probe in
-- scripts/drizzle-bootstrap.ts.

ALTER TABLE "cashflow_weekly_manual" ADD COLUMN IF NOT EXISTS "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "fye_revised_budget_monthly" ADD COLUMN IF NOT EXISTS "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "opex_budget_monthly" ADD COLUMN IF NOT EXISTS "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "tracker_monthly_manual" ADD COLUMN IF NOT EXISTS "fiscal_period_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cashflow_weekly_manual" ADD CONSTRAINT "cashflow_weekly_manual_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fye_revised_budget_monthly" ADD CONSTRAINT "fye_revised_budget_monthly_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "opex_budget_monthly" ADD CONSTRAINT "opex_budget_monthly_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tracker_monthly_manual" ADD CONSTRAINT "tracker_monthly_manual_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
