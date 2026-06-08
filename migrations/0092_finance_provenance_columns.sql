-- 0092_finance_provenance_columns.sql
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to replay in
-- the bootstrap's batch. Canary probe in scripts/drizzle-bootstrap.ts.

ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "revenue_derived" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "revenue_stored" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "recon_delta" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "recognition_method" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "colour_source" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "source_file_hash" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "source_cell" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "recognition_method" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "colour_source" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "source_file_hash" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "source_cell" text;
