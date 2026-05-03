-- =========================================================================
-- Priority activity log — append-only audit trail for mytool_company_priorities.
-- Powers the "Activity" tab on the priority detail page.
-- Additive + idempotent so it's safe to re-run against environments that
-- already have the table.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "priority_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority_id" integer NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "priority_activity" ADD CONSTRAINT "priority_activity_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "priority_activity" ADD CONSTRAINT "priority_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_priority_activity_priority_id" ON "priority_activity" ("priority_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_priority_activity_created_at" ON "priority_activity" ("created_at" DESC);
