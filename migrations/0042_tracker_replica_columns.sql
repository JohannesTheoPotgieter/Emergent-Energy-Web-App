-- =========================================================================
-- Tracker replica — schema additions for full sheet fidelity.
--
-- Background:
--   The Smart Import pipeline silently drops several columns present in
--   the source Tracker workbook (Project Plan / Revenue Tracking /
--   Expenditure Breakdown sheets). The synonym map collapses distinct
--   columns onto a single canonical field (Owner ↔ Lead ↔ Resource 1 ↔
--   Resource 2; Comments ↔ Resource 2; Milestone Notes → /dev/null) and
--   the schema lacks fields for actual-side QTY/Rate, USD exchange rate,
--   price per watt, line comments, the CHECK validation flag, and the
--   Saving / Overrun column.
--
--   This migration prepares the storage side. The importer + UI changes
--   land in subsequent PRs.
--
-- Changes (all additive, all idempotent — every statement uses
-- IF NOT EXISTS so this migration is safe to re-run):
--   1. Six new columns on `work_items` (Project Plan replica).
--   2. Two new columns on `normalized_revenue_lines` (Revenue replica).
--   3. Eight new columns on `normalized_cost_lines` (Expenditure replica).
--   4. New child table `normalized_cost_line_actuals` for 1:N actuals
--      against a single costed line — the Tracker can record multiple
--      invoice batches per costed item, which the previous schema lost.
--   5. New table `tracker_project_metadata` for the top-of-Project-Plan
--      block (baseline / forecasted completion dates, project start,
--      duration metrics).
--   6. New table `tracker_revenue_summary` for the top-of-Revenue-Tracking
--      block (Planned Revenue / Expenditure / Profit / Margin × Costed /
--      Actual).
--
-- Font / fill colour fidelity is encoded via a JSONB `cell_format` column
-- on every relevant table, keyed by canonical field name:
--   { "<field>": { "font": "#RRGGBB", "fill": "#RRGGBB", "bold": true } }
--
-- The legacy `*_font_color` text columns on the normalized_* tables are
-- preserved for backward compatibility.
-- =========================================================================

-- 1. work_items — six new columns for Project Plan sheet fidelity.
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "lead" text;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "resource_1" text;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "resource_2" text;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "tracker_comments" text;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "work_days" integer;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "cell_format" jsonb;

-- 2. normalized_revenue_lines — milestone notes + cell format.
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "milestone_notes" text;
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "cell_format" jsonb;

-- 3. normalized_cost_lines — actual-side QTY/Rate, comments, validation
-- flag, saving/overrun, USD rate, price per watt, cell format.
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "actual_qty" text;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "actual_rate" text;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "comments" text;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "check_flag" text;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "saving_overrun" numeric(15, 2);
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "usd_exchange_rate" numeric(10, 4);
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "price_per_watt" numeric(12, 6);
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "cell_format" jsonb;

-- 4. normalized_cost_line_actuals — 1:N child of normalized_cost_lines.
CREATE TABLE IF NOT EXISTS "normalized_cost_line_actuals" (
    "id" serial PRIMARY KEY NOT NULL,
    "cost_line_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "actual_no" integer NOT NULL,
    "description" text,
    "qty" text,
    "rate" text,
    "actual_total" numeric(15, 2),
    "po_number" text,
    "invoice_number" text,
    "invoice_date" date,
    "revenue_recognition_amount" numeric(15, 2),
    "finance_payment_date" date,
    "comments" text,
    "check_flag" text,
    "saving_overrun" numeric(15, 2),
    "cell_format" jsonb,
    "source_sheet" text,
    "source_row" integer,
    "import_run_id" integer NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "deleted_at" timestamp,
    "effective_from" timestamp DEFAULT now() NOT NULL,
    "effective_to" timestamp,
    "snapshot_run_id" integer
);

DO $$ BEGIN
    ALTER TABLE "normalized_cost_line_actuals"
        ADD CONSTRAINT "normalized_cost_line_actuals_cost_line_id_normalized_cost_lines_id_fk"
        FOREIGN KEY ("cost_line_id") REFERENCES "public"."normalized_cost_lines"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "normalized_cost_line_actuals"
        ADD CONSTRAINT "normalized_cost_line_actuals_project_id_project_info_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "normalized_cost_line_actuals"
        ADD CONSTRAINT "normalized_cost_line_actuals_import_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "normalized_cost_line_actuals"
        ADD CONSTRAINT "normalized_cost_line_actuals_snapshot_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "normalized_cost_line_actuals_cost_line_id_idx"
    ON "normalized_cost_line_actuals" USING btree ("cost_line_id");
CREATE INDEX IF NOT EXISTS "normalized_cost_line_actuals_project_id_idx"
    ON "normalized_cost_line_actuals" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "normalized_cost_line_actuals_effective_to_idx"
    ON "normalized_cost_line_actuals" USING btree ("effective_to");

-- 5. tracker_project_metadata — top-of-Project-Plan rows 1–7.
CREATE TABLE IF NOT EXISTS "tracker_project_metadata" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" integer NOT NULL,
    "import_run_id" integer NOT NULL,
    "baseline_completion_date" date,
    "forecasted_completion_date" date,
    "project_start_date" date,
    "duration_months_from_site_estab" numeric(8, 4),
    "duration_months_to_capacity_test" numeric(8, 4),
    "cell_format" jsonb,
    "source_sheet" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "effective_from" timestamp DEFAULT now() NOT NULL,
    "effective_to" timestamp,
    "snapshot_run_id" integer
);

DO $$ BEGIN
    ALTER TABLE "tracker_project_metadata"
        ADD CONSTRAINT "tracker_project_metadata_project_id_project_info_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "tracker_project_metadata"
        ADD CONSTRAINT "tracker_project_metadata_import_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "tracker_project_metadata"
        ADD CONSTRAINT "tracker_project_metadata_snapshot_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "tracker_project_metadata_project_id_idx"
    ON "tracker_project_metadata" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "tracker_project_metadata_effective_to_idx"
    ON "tracker_project_metadata" USING btree ("effective_to");

-- 6. tracker_revenue_summary — top-of-Revenue-Tracking rows 4–7.
CREATE TABLE IF NOT EXISTS "tracker_revenue_summary" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" integer NOT NULL,
    "import_run_id" integer NOT NULL,
    "planned_revenue_costed" numeric(15, 2),
    "planned_revenue_actual" numeric(15, 2),
    "planned_expenditure_costed" numeric(15, 2),
    "planned_expenditure_actual" numeric(15, 2),
    "planned_profit_costed" numeric(15, 2),
    "planned_profit_actual" numeric(15, 2),
    "planned_margin_costed" numeric(8, 6),
    "planned_margin_actual" numeric(8, 6),
    "cell_format" jsonb,
    "source_sheet" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "effective_from" timestamp DEFAULT now() NOT NULL,
    "effective_to" timestamp,
    "snapshot_run_id" integer
);

DO $$ BEGIN
    ALTER TABLE "tracker_revenue_summary"
        ADD CONSTRAINT "tracker_revenue_summary_project_id_project_info_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "tracker_revenue_summary"
        ADD CONSTRAINT "tracker_revenue_summary_import_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "tracker_revenue_summary"
        ADD CONSTRAINT "tracker_revenue_summary_snapshot_run_id_smart_import_runs_id_fk"
        FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "tracker_revenue_summary_project_id_idx"
    ON "tracker_revenue_summary" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "tracker_revenue_summary_effective_to_idx"
    ON "tracker_revenue_summary" USING btree ("effective_to");
