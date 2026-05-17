CREATE TABLE "standup_sessions" (
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
ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_schedule_id_standup_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."standup_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_facilitator_user_id_users_id_fk" FOREIGN KEY ("facilitator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standup_sessions_schedule_date_idx" ON "standup_sessions" USING btree ("schedule_id","session_date");