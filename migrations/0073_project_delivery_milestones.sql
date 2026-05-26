-- Project Delivery wave-4 audit (2026-05-26) — split delivery milestones
-- out of the (now Revenue-only) milestone tracker. Per audit scope #3
-- a delivery-milestone surface must capture planned date, actual date,
-- owner, blocker, evidence link, status, project link, stage link.
--
-- Generated via `npm run db:generate --name=project_delivery_milestones`,
-- then hardened with IF NOT EXISTS / EXCEPTION guards per § 6 of
-- docs/AGENT_GUARDRAILS.md ("additive only, every statement guarded").

CREATE TABLE IF NOT EXISTS "project_delivery_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"milestone_code" text NOT NULL,
	"milestone_name" text NOT NULL,
	"phase_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"planned_date" date,
	"actual_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"owner_user_id" integer,
	"blocker" text,
	"blocker_set_at" timestamp,
	"blocker_cleared_at" timestamp,
	"evidence_link" text,
	"notes" text,
	"created_by_user_id" integer,
	"completed_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_milestones" ADD CONSTRAINT "project_delivery_milestones_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_milestones" ADD CONSTRAINT "project_delivery_milestones_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_milestones" ADD CONSTRAINT "project_delivery_milestones_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_milestones" ADD CONSTRAINT "project_delivery_milestones_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_delivery_milestones_project" ON "project_delivery_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_delivery_milestones_project_code" ON "project_delivery_milestones" USING btree ("project_id","milestone_code") WHERE deleted_at IS NULL;
