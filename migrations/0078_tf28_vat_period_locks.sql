-- =========================================================================
-- TF-28 (audit V3) — VAT period tracking + snapshot-chain repair.
--
-- This migration does two things:
--
--   1. Creates the new `vat_period_locks` table for SA bi-monthly VAT 201
--      tracking. Mirrors the cos_period_locks shape so the lock / unlock
--      flow + audit pattern is familiar.
--
--   2. Repairs the snapshot-chain drift that built up across migrations
--      0073 / 0076 / 0077 — the 0076 dispute / write-off columns + enum
--      values were added by an earlier migration that ran successfully
--      on the live DB, but the drizzle snapshot chain lost them. All
--      statements below use IF NOT EXISTS / DO blocks so the re-apply
--      is idempotent.
--
-- Safe to apply on:
--   - A fresh DB (creates vat_period_locks + adds dispute columns).
--   - A DB where migration 0076 already ran (skips the dispute columns
--     because they already exist).
--
-- NOT applied automatically — needs `npm run db:migrate` approval per
-- § 6 of docs/AGENT_GUARDRAILS.md.
-- =========================================================================

-- 1. VAT period locks table -----------------------------------------------

CREATE TABLE IF NOT EXISTS "vat_period_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_month" date NOT NULL,
	"vat_201_submission_ref" text,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"locked_by_user_id" integer,
	"output_vat_total" numeric(15, 2),
	"input_vat_total" numeric(15, 2),
	"unlocked_at" timestamp,
	"unlocked_by_user_id" integer,
	"unlock_reason" text,
	"notes" text
);
--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'vat_period_locks_locked_by_user_id_users_id_fk') THEN
		ALTER TABLE "vat_period_locks" ADD CONSTRAINT "vat_period_locks_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'vat_period_locks_unlocked_by_user_id_users_id_fk') THEN
		ALTER TABLE "vat_period_locks" ADD CONSTRAINT "vat_period_locks_unlocked_by_user_id_users_id_fk" FOREIGN KEY ("unlocked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vat_period_locks_period" ON "vat_period_locks" USING btree ("period_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vat_period_locks_active" ON "vat_period_locks" USING btree ("period_month") WHERE "vat_period_locks"."unlocked_at" IS NULL;--> statement-breakpoint

-- 2. Snapshot-chain repair — re-apply the 0076 dispute / write-off columns
-- with IF NOT EXISTS guards so the migration is a no-op on a DB where
-- 0076 already ran. The corresponding enum values are added with IF NOT
-- EXISTS (Postgres 12+ syntax).

ALTER TYPE "public"."cost_line_status" ADD VALUE IF NOT EXISTS 'disputed';--> statement-breakpoint
ALTER TYPE "public"."revenue_line_status" ADD VALUE IF NOT EXISTS 'disputed';--> statement-breakpoint
ALTER TYPE "public"."revenue_line_status" ADD VALUE IF NOT EXISTS 'written_off';--> statement-breakpoint

ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "dispute_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "dispute_resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "dispute_opened_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "dispute_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "dispute_resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "dispute_opened_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "write_off_authorised_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "write_off_authorised_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "write_off_reason" text;--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'normalized_cost_lines_dispute_opened_by_user_id_users_id_fk') THEN
		ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_dispute_opened_by_user_id_users_id_fk" FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'normalized_revenue_lines_dispute_opened_by_user_id_users_id_fk') THEN
		ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_dispute_opened_by_user_id_users_id_fk" FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'normalized_revenue_lines_write_off_authorised_by_user_id_users_id_fk') THEN
		ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_write_off_authorised_by_user_id_users_id_fk" FOREIGN KEY ("write_off_authorised_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
