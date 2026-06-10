-- HARDENED 2026-06-10 (migration-ledger integrity repair).
-- Same situation as 0061 (see its header): shipped unguarded, never
-- executed by drizzle-kit migrate anywhere because of the journal
-- `when` ordering. Guarded per § 6 now that the journal repair makes it
-- live on fresh migrate-from-zero. Content otherwise unchanged.

CREATE TABLE IF NOT EXISTS "standup_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer,
	"facilitator_user_id" integer,
	"session_date" text NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"avg_seconds_per_speaker" integer DEFAULT 0 NOT NULL,
	"blocker_count" integer DEFAULT 0 NOT NULL,
	"task_movements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mood_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"facilitator_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_schedule_id_standup_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."standup_schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_facilitator_user_id_users_id_fk" FOREIGN KEY ("facilitator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standup_sessions_schedule_date_idx" ON "standup_sessions" USING btree ("schedule_id","session_date");