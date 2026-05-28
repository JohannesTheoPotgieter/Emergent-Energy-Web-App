-- =========================================================================
-- 0079 — Dev DB drift repair.
--
-- Some dev databases marked migrations 0067_sp_settings_error_columns,
-- 0069_priorities_phase3, and 0076_finance_dispute_writeoff_columns as
-- "applied" via the bootstrap's "presumed applied" path (no canary
-- probe registered in scripts/drizzle-bootstrap.ts MODERN_MIGRATION_PROBES)
-- but the SQL never actually ran. Symptoms in those dev envs include:
--
--   * "column \"last_success_at\" does not exist" on sp_settings reads
--   * 500s on /api/priorities, /api/priority-saved-views, /api/priority-templates
--   * "invalid input value for enum revenue_line_status: \"disputed\""
--     in the derived-project-kpis scheduler and /api/cashflow-2026 etc.
--
-- This migration is **additive and fully idempotent** (IF NOT EXISTS,
-- ADD VALUE IF NOT EXISTS, DO blocks for constraints). On a healthy DB
-- where 0067/0069/0076 ran normally every statement is a no-op. On a
-- drifted dev DB it backfills the missing pieces.
--
-- A canary probe for this migration was added in the same change in
-- scripts/drizzle-bootstrap.ts MODERN_MIGRATION_PROBES — it checks all
-- three artifacts (sp_settings.last_success_at, priority_saved_views,
-- normalized_revenue_lines.dispute_opened_at) so future drift in any
-- of the three triggers a replay rather than silently skipping.
-- =========================================================================

-- ----- 0067 backfill: sp_settings error/success columns ------------------
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "last_success_at" timestamp;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "last_error_code" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN IF NOT EXISTS "last_error_message" text;--> statement-breakpoint

-- ----- 0076 backfill: enum values + dispute/write-off columns ------------
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
  ALTER TABLE "normalized_cost_lines"
    ADD CONSTRAINT "normalized_cost_lines_dispute_opened_by_user_id_users_id_fk"
    FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "normalized_revenue_lines"
    ADD CONSTRAINT "normalized_revenue_lines_dispute_opened_by_user_id_users_id_fk"
    FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "normalized_revenue_lines"
    ADD CONSTRAINT "normalized_revenue_lines_write_off_authorised_by_user_id_users_id_fk"
    FOREIGN KEY ("write_off_authorised_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_normalized_revenue_lines_dispute_open"
  ON "normalized_revenue_lines" ("project_id", "dispute_resolved_at")
  WHERE "dispute_opened_at" IS NOT NULL AND "dispute_resolved_at" IS NULL AND "effective_to" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_normalized_cost_lines_dispute_open"
  ON "normalized_cost_lines" ("project_id", "dispute_resolved_at")
  WHERE "dispute_opened_at" IS NOT NULL AND "dispute_resolved_at" IS NULL AND "effective_to" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_normalized_revenue_lines_write_off"
  ON "normalized_revenue_lines" ("project_id", "write_off_authorised_at")
  WHERE "write_off_authorised_at" IS NOT NULL AND "effective_to" IS NULL;--> statement-breakpoint

-- ----- 0069_priorities_phase3 backfill -----------------------------------
CREATE TABLE IF NOT EXISTS "priority_saved_views" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "active_tab" text DEFAULT 'my' NOT NULL,
  "scope" text,
  "department_key" text,
  "level_filter" text,
  "health_filter" text,
  "search_query" text,
  "show_closed" boolean DEFAULT false NOT NULL,
  "show_archived" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "priority_saved_views_user_name_unique" UNIQUE("user_id","name")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "priority_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "title_template" text NOT NULL,
  "body_template" text,
  "scope_default" text DEFAULT 'role' NOT NULL,
  "severity_default" text DEFAULT 'normal' NOT NULL,
  "horizon_default" text DEFAULT 'week' NOT NULL,
  "department_key" text,
  "target_outcome" text,
  "definition_of_done" text,
  "next_action" text,
  "owner_role" text,
  "created_by_user_id" integer,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "mytool_company_priorities" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "mytool_company_priorities" ADD COLUMN IF NOT EXISTS "review_cadence_days" integer;--> statement-breakpoint
ALTER TABLE "mytool_company_priorities" ADD COLUMN IF NOT EXISTS "last_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "mytool_company_priorities" ADD COLUMN IF NOT EXISTS "last_reviewed_by_user_id" integer;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "priority_saved_views"
    ADD CONSTRAINT "priority_saved_views_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "priority_templates"
    ADD CONSTRAINT "priority_templates_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mytool_company_priorities"
    ADD CONSTRAINT "mytool_company_priorities_last_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("last_reviewed_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_priorities_deleted_at"
  ON "mytool_company_priorities" USING btree ("deleted_at")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_priority_templates_dept"
  ON "priority_templates" USING btree ("department_key")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_priority_templates_live"
  ON "priority_templates" USING btree ("deleted_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_priority_saved_views_user"
  ON "priority_saved_views" USING btree ("user_id","sort_order");
