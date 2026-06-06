CREATE TABLE "financial_reconciliation" (
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
ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_reconciliation_project_period_active_idx" ON "financial_reconciliation" USING btree ("project_id","fiscal_period_id") WHERE "financial_reconciliation"."effective_to" IS NULL;