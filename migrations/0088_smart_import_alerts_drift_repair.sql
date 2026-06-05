-- =========================================================================
-- 0088 — Smart Import alerts/bindings drift repair.
--
-- 0087_smart_import_bindings_and_alerts was marked "applied" via the
-- bootstrap's "presumed applied" path (no canary probe registered in
-- scripts/drizzle-bootstrap.ts MODERN_MIGRATION_PROBES) but its DDL never
-- actually ran — on dev OR prod. Symptoms:
--
--   * "column \"alerts_enabled\" does not exist" on sp_settings reads
--     (getSpSettings) -> 500s when saving Smart Import / auto-import
--     settings, plus repeated unhandled rejections in the scheduler.
--   * the smart_import_project_bindings table is missing entirely.
--
-- This migration is **additive and fully idempotent** (CREATE TABLE IF NOT
-- EXISTS, ADD COLUMN IF NOT EXISTS, DO blocks for constraints). On a DB
-- where 0087 ran normally every statement is a no-op; on a drifted DB it
-- backfills the missing table, columns, and foreign keys.
--
-- A canary probe for this tag is registered in the same change in
-- scripts/drizzle-bootstrap.ts MODERN_MIGRATION_PROBES (bindings table +
-- alert column + sender FK) so future drift replays rather than silently
-- skipping.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "smart_import_project_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"match_type" text DEFAULT 'filename' NOT NULL,
	"project_id" integer NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"confirmed_by_user_id" integer,
	"last_used_at" timestamp,
	"times_used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alert_team_id" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alert_channel_id" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alert_sender_user_id" integer;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alert_on_failure" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "alert_on_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "last_alert_state" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_import_project_bindings" ADD CONSTRAINT "smart_import_project_bindings_source_key_unique" UNIQUE("source_key");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_import_project_bindings" ADD CONSTRAINT "smart_import_project_bindings_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_import_project_bindings" ADD CONSTRAINT "smart_import_project_bindings_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sp_settings" ADD CONSTRAINT "sp_settings_alert_sender_user_id_users_id_fk" FOREIGN KEY ("alert_sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
