-- =========================================================================
-- Tier 4 · PR 2: priority_opportunities junction.
-- Lets a Priority attach to a pre-contract opportunity, so the strategic
-- view can see pipeline risk — stalled proposals, overdue feasibility —
-- not just post-signature project work.
-- Additive + idempotent so it's safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "priority_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"linked_by" integer,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "priority_opportunities_unique" UNIQUE("priority_id","opportunity_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "priority_opportunities" ADD CONSTRAINT "priority_opportunities_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "priority_opportunities" ADD CONSTRAINT "priority_opportunities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "priority_opportunities" ADD CONSTRAINT "priority_opportunities_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_priority_opportunities_priority_id" ON "priority_opportunities" ("priority_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_priority_opportunities_opportunity_id" ON "priority_opportunities" ("opportunity_id");
