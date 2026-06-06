ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "revenue_derived" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "revenue_stored" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "recon_delta" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "recognition_method" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "colour_source" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "source_file_hash" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN "source_cell" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "recognition_method" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "colour_source" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "source_file_hash" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "source_cell" text;