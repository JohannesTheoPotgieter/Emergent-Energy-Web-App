-- 0096_cos_line_recognition_override.sql
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS + FK in duplicate-safe DO
-- block) so it is safe to replay in the bootstrap's batch. Canary probe in
-- scripts/drizzle-bootstrap.ts.

ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "recognition_date_override" date;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "recognition_date_override_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "recognition_date_override_by" integer;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "recognition_date_override_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_recognition_date_override_by_users_id_fk" FOREIGN KEY ("recognition_date_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
