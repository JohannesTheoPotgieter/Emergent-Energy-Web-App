-- =========================================================================
-- QB Reconciliation — Tracker Gap support tables (C004).
--
-- Two pure additive tables that back the "Tracker Gap" tab on the COS
-- Tracker page. Trackers remain the source of truth — these tables only
-- store admin-side annotations (ignored gap rows + manual class→project
-- overrides) so the gap report stays actionable.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "qb_recon_ignores" (
        "id" serial PRIMARY KEY NOT NULL,
        "qb_bill_id" text NOT NULL,
        "qb_line_id" text,
        "qb_doc_number" text,
        "vendor_name" text,
        "line_amount_ex_vat" numeric(14,2),
        "resolved_project_name" text,
        "reason" text NOT NULL,
        "ignored_by_user_id" integer,
        "ignored_by_name" text,
        "ignored_at" timestamp DEFAULT now() NOT NULL,
        "deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_recon_ignores" ADD CONSTRAINT "qb_recon_ignores_user_fk" FOREIGN KEY ("ignored_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qb_recon_ignores_bill" ON "qb_recon_ignores" ("qb_bill_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qb_recon_ignores_active" ON "qb_recon_ignores" ("deleted_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_class_project_overrides" (
        "id" serial PRIMARY KEY NOT NULL,
        "class_ref_name" text NOT NULL,
        "project_name" text NOT NULL,
        "note" text,
        "created_by_user_id" integer,
        "created_by_name" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_class_project_overrides" ADD CONSTRAINT "qb_class_project_overrides_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_qb_class_project_overrides_class_active"
  ON "qb_class_project_overrides" (LOWER("class_ref_name")) WHERE "deleted_at" IS NULL;
