ALTER TABLE "cashflow_weekly_manual" ADD COLUMN "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "fye_revised_budget_monthly" ADD COLUMN "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "opex_budget_monthly" ADD COLUMN "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "tracker_monthly_manual" ADD COLUMN "fiscal_period_id" integer;--> statement-breakpoint
ALTER TABLE "cashflow_weekly_manual" ADD CONSTRAINT "cashflow_weekly_manual_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fye_revised_budget_monthly" ADD CONSTRAINT "fye_revised_budget_monthly_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opex_budget_monthly" ADD CONSTRAINT "opex_budget_monthly_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_monthly_manual" ADD CONSTRAINT "tracker_monthly_manual_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;