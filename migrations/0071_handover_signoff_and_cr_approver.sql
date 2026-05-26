-- Project Delivery deep audit pass 2 (2026-05-26) — handover sign-off
-- gaps + VO approver tracking + S10 post-handover review table.
--
-- Generated via `npm run db:generate --name=handover_signoff_and_cr_approver`,
-- then hardened with IF NOT EXISTS / EXCEPTION guards per § 6 of
-- docs/AGENT_GUARDRAILS.md ("additive only, every statement guarded").
--
-- Closes the gaps the deeper audit flagged:
--   - Six Rule #6 / handover sign-off: handoverPacks + ssegItems had
--     submission/acceptance dates but no user-id columns, so audit
--     couldn't show WHO signed off the EPC→Client / EPC→Compliance
--     handovers. Additive nullable FKs to users(id).
--   - Stage S10 (3-month Post-HO Review): no dedicated table at all.
--     New post_handover_reviews persists PM + COO sign-off and lessons.
--   - Change Request (VO) workflow: status moved through draft →
--     submitted → under_review → approved / rejected with no actor
--     captured per transition. Additive submittedByUserId / reviewerUserId
--     / approverUserId + timestamps + rejection reason.
--
-- All changes are additive — every existing row stays valid with NULL.

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
