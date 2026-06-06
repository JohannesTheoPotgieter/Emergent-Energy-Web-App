ALTER TABLE "normalized_cost_lines" ADD COLUMN "recognition_date_override" date;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "recognition_date_override_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "recognition_date_override_by" integer;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "recognition_date_override_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_recognition_date_override_by_users_id_fk" FOREIGN KEY ("recognition_date_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;