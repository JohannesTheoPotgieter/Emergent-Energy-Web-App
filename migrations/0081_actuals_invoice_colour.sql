ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "invoice_date_font_color" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "invoice_date_confirmed" boolean;
