-- Restore finance tracker support tables for environments that missed the
-- 2026-04 baseline. Additive only: safe to run on databases where the tables
-- and columns already exist.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allocation_confidence') THEN
    CREATE TYPE allocation_confidence AS ENUM ('direct', 'header_error_positional', 'provisional', 'manual');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS category_revenue_allocations (
  id                    SERIAL PRIMARY KEY,
  project_id            INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  project_name          TEXT NOT NULL,
  category_number       TEXT NOT NULL,
  category_name         TEXT NOT NULL,
  category_key          TEXT NOT NULL,
  category_sort_order   INTEGER NOT NULL,
  revenue_allocation    NUMERIC(15,2),
  allocation_confidence allocation_confidence NOT NULL DEFAULT 'provisional',
  budget_total          NUMERIC(15,2),
  budget_cos            NUMERIC(15,2),
  import_run_id         INTEGER REFERENCES smart_import_runs(id),
  effective_from        TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to          TIMESTAMP,
  snapshot_run_id       INTEGER REFERENCES smart_import_runs(id) ON DELETE SET NULL,
  source_sheet          TEXT,
  source_row            INTEGER,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_revenue_allocations_active
  ON category_revenue_allocations (project_id, category_key)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_history
  ON category_revenue_allocations (project_id, category_key, effective_to);

CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_import_run
  ON category_revenue_allocations (import_run_id);

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS category_key TEXT;

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS category_allocation_id INTEGER REFERENCES category_revenue_allocations(id);

CREATE TABLE IF NOT EXISTS tracker_monthly_manual (
  id           SERIAL PRIMARY KEY,
  tracker_type TEXT NOT NULL,
  month_key    TEXT NOT NULL,
  realised     NUMERIC(15,2),
  outstanding  NUMERIC(15,2),
  budget       NUMERIC(15,2),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_monthly_manual_type_month
  ON tracker_monthly_manual (tracker_type, month_key);
