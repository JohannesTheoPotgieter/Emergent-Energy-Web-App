-- ============================================================
-- Migration: Collapse Override Tables Into Base Tables
-- Date: 2026-03-30
-- Purpose: Add source/snapshot/edit-tracking columns to 6 base
--          tables so override data can be merged inline, removing
--          the merge-on-read pattern.
--
-- Base tables receiving new columns:
--   1. program_expense        (← expenditure_overrides, cos_status_overrides)
--   2. program_inflows        (← revenue_tracking_overrides)
--   3. cashflow_points        (← cashflow_planning_overrides)
--   4. finance_revenue_monthly (← finance_revenue_overrides)
--   5. finance_cos_monthly     (← finance_cos_overrides)
--   6. project_plan           (← project_plan_overrides)
--
-- Override tables are NOT dropped — marked deprecated.
-- ============================================================

-- 1. Create source enum
DO $$ BEGIN
  CREATE TYPE row_source AS ENUM ('imported', 'manual', 'imported_edited');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add columns to program_expense
ALTER TABLE program_expense
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 3. Add columns to program_inflows
ALTER TABLE program_inflows
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 4. Add columns to cashflow_points
ALTER TABLE cashflow_points
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 5. Add columns to finance_revenue_monthly
ALTER TABLE finance_revenue_monthly
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 6. Add columns to finance_cos_monthly
ALTER TABLE finance_cos_monthly
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 7. Add columns to project_plan
ALTER TABLE project_plan
  ADD COLUMN IF NOT EXISTS source row_source NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS import_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by integer DEFAULT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamp DEFAULT NULL;

-- 8. Create tracking tables for backfill diagnostics
CREATE TABLE IF NOT EXISTS override_migration_orphans (
  id serial PRIMARY KEY,
  override_table text NOT NULL,
  override_id integer NOT NULL,
  override_data jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'no_matching_base_row',
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS override_migration_ambiguous (
  id serial PRIMARY KEY,
  override_table text NOT NULL,
  override_id integer NOT NULL,
  override_data jsonb NOT NULL,
  matching_base_ids integer[] NOT NULL,
  reason text NOT NULL DEFAULT 'multiple_matching_base_rows',
  created_at timestamp NOT NULL DEFAULT NOW()
);

-- 9. Indexes for efficient backfill lookups
CREATE INDEX IF NOT EXISTS idx_program_expense_source ON program_expense(source);
CREATE INDEX IF NOT EXISTS idx_program_inflows_source ON program_inflows(source);
CREATE INDEX IF NOT EXISTS idx_cashflow_points_source ON cashflow_points(source);
CREATE INDEX IF NOT EXISTS idx_finance_revenue_monthly_source ON finance_revenue_monthly(source);
CREATE INDEX IF NOT EXISTS idx_finance_cos_monthly_source ON finance_cos_monthly(source);
CREATE INDEX IF NOT EXISTS idx_project_plan_source ON project_plan(source);

-- 10. Mark existing manual rows
UPDATE program_expense SET source = 'manual' WHERE is_manual = true;

-- 11. Add deprecation comments to override tables
COMMENT ON TABLE expenditure_overrides IS 'DEPRECATED: Override data migrated into program_expense.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE revenue_tracking_overrides IS 'DEPRECATED: Override data migrated into program_inflows.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE cashflow_planning_overrides IS 'DEPRECATED: Override data migrated into cashflow_points.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE cos_status_overrides IS 'DEPRECATED: Override data migrated into program_expense.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE finance_revenue_overrides IS 'DEPRECATED: Override data migrated into finance_revenue_monthly.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE finance_cos_overrides IS 'DEPRECATED: Override data migrated into finance_cos_monthly.import_snapshot. Will be dropped after verification.';
COMMENT ON TABLE project_plan_overrides IS 'DEPRECATED: Override data migrated into project_plan.import_snapshot. Will be dropped after verification.';
