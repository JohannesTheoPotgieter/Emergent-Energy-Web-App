-- Migration-ledger integrity repair (2026-06-10) — re-assert 0071.
--
-- 0071_handover_signoff_and_cr_approver was recorded as applied while its
-- DDL never ran: drizzle-kit migrate skips any journal entry whose `when`
-- is below MAX(created_at) in drizzle.__drizzle_migrations (a single
-- watermark, not a per-migration check), and hand-rounded future `when`
-- values on neighbouring entries pinned the watermark above 0071.
-- scripts/drizzle-bootstrap.ts then backfilled it as "presumed applied"
-- because it had no canary probe. Result: change_requests was missing the
-- whole VO actor-trail column set (submitted_by_user_id … rejected_at)
-- while every ledger surface reported the migration applied — the same
-- class of failure as the 0090–0096 outage.
--
-- This migration re-runs 0071's statements verbatim. 0071 is fully
-- guarded (IF NOT EXISTS / duplicate_object DO blocks), so on a healthy
-- DB this is a pure no-op; on a drifted DB it converges the schema. A
-- multi-artifact canary in scripts/drizzle-bootstrap.ts forces replay on
-- any DB where the artifacts are missing.

CREATE TABLE IF NOT EXISTS "post_handover_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"review_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_date" date,
	"actual_review_date" date,
	"review_summary" text,
	"performance_notes" text,
	"client_feedback" text,
	"lessons_captured" jsonb DEFAULT '[]'::jsonb,
	"pm_sign_off_user_id" integer,
	"pm_sign_off_at" timestamp,
	"coo_sign_off_user_id" integer,
	"coo_sign_off_at" timestamp,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint

ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "submitted_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "reviewer_user_id" integer;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "review_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "approver_user_id" integer;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "handover_packs" ADD COLUMN IF NOT EXISTS "client_submitted_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "handover_packs" ADD COLUMN IF NOT EXISTS "client_accepted_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "handover_packs" ADD COLUMN IF NOT EXISTS "matriarch_accepted_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "sseg_items" ADD COLUMN IF NOT EXISTS "techsitter_confirmed_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "sseg_items" ADD COLUMN IF NOT EXISTS "techsitter_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "sseg_items" ADD COLUMN IF NOT EXISTS "metering_confirmed_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "sseg_items" ADD COLUMN IF NOT EXISTS "metering_confirmed_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "post_handover_reviews" ADD CONSTRAINT "post_handover_reviews_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "post_handover_reviews" ADD CONSTRAINT "post_handover_reviews_pm_sign_off_user_id_users_id_fk" FOREIGN KEY ("pm_sign_off_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "post_handover_reviews" ADD CONSTRAINT "post_handover_reviews_coo_sign_off_user_id_users_id_fk" FOREIGN KEY ("coo_sign_off_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "post_handover_reviews" ADD CONSTRAINT "post_handover_reviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "handover_packs" ADD CONSTRAINT "handover_packs_client_submitted_by_user_id_users_id_fk" FOREIGN KEY ("client_submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "handover_packs" ADD CONSTRAINT "handover_packs_client_accepted_by_user_id_users_id_fk" FOREIGN KEY ("client_accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "handover_packs" ADD CONSTRAINT "handover_packs_matriarch_accepted_by_user_id_users_id_fk" FOREIGN KEY ("matriarch_accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sseg_items" ADD CONSTRAINT "sseg_items_techsitter_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("techsitter_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sseg_items" ADD CONSTRAINT "sseg_items_metering_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("metering_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
