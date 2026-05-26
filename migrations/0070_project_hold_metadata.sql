-- Project Delivery deep audit (2026-05-26) — Hold/Blocked six-field metadata.
-- Generated via `npm run db:generate --name=project_hold_metadata`, then
-- hardened with IF NOT EXISTS / EXCEPTION guards per § 6 of
-- docs/AGENT_GUARDRAILS.md ("additive only, every statement guarded").
--
-- Implements the playbook + AGENT_GUARDRAILS § 4A requirement that Hold
-- and Blocked status capture the six fields (reason, owner, review_date,
-- dependency, decision_owner, evidence_link). Until now the rule lived
-- only in docs — the project_status enum could flip with no metadata.
--
-- Soft rule (§ 3A.4): when one of the six is missing, the caller supplies
-- `override_reason` and the audit log captures actor + role. Override path
-- matches § 0A.

CREATE TABLE IF NOT EXISTS "project_hold_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"owner_user_id" integer,
	"review_date" text,
	"dependency" text,
	"decision_owner_user_id" integer,
	"evidence_link" text,
	"override_reason" text,
	"created_by_user_id" integer,
	"created_by_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" integer,
	"resolution_note" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_hold_metadata" ADD CONSTRAINT "project_hold_metadata_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_hold_metadata" ADD CONSTRAINT "project_hold_metadata_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_hold_metadata" ADD CONSTRAINT "project_hold_metadata_decision_owner_user_id_users_id_fk" FOREIGN KEY ("decision_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_hold_metadata" ADD CONSTRAINT "project_hold_metadata_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_hold_metadata" ADD CONSTRAINT "project_hold_metadata_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_hold_metadata_project" ON "project_hold_metadata" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_hold_metadata_open" ON "project_hold_metadata" USING btree ("project_id","resolved_at");
