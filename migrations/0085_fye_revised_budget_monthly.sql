CREATE TABLE "fye_revised_budget_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"fye" integer NOT NULL,
	"metric" text NOT NULL,
	"month_key" text NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fye_revised_budget_monthly" ADD CONSTRAINT "fye_revised_budget_monthly_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fye_revised_budget_monthly_fye_metric_month_idx" ON "fye_revised_budget_monthly" USING btree ("fye","metric","month_key");