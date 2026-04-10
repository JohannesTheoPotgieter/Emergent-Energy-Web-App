-- S01: Create category_revenue_allocations table
-- Purpose: Canonical store for per-category revenue allocation values (J_cat)
--          used in the category-based revenue release formula (Q/X_cat)*J_cat.
-- Safety: Additive — new table creation only, no existing tables modified.
-- Rollback: 20260411_create_category_revenue_allocations_rollback.sql

-- Allocation confidence classification
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allocation_confidence') THEN
    CREATE TYPE allocation_confidence AS ENUM ('DIRECT', 'HEADER_ERROR_POSITIONAL', 'PROVISIONAL', 'MANUAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS category_revenue_allocations (
  id                    SERIAL PRIMARY KEY,
  project_id            INTEGER NOT NULL REFERENCES project_info(id),
  project_name          TEXT NOT NULL,
  category_number       TEXT NOT NULL,
  category_name         TEXT NOT NULL,
  category_key          TEXT NOT NULL,
  category_sort_order   INTEGER NOT NULL,
  revenue_allocation    NUMERIC(15,2),
  allocation_confidence allocation_confidence NOT NULL DEFAULT 'PROVISIONAL',
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

-- Enforce exactly one active allocation per (project, category).
-- PostgreSQL UNIQUE constraints treat NULL as distinct, so a partial index
-- on effective_to IS NULL is required for correct temporal uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_revenue_allocations_active
  ON category_revenue_allocations (project_id, category_key)
  WHERE effective_to IS NULL;

-- Index for historical lookups (non-unique, allows multiple closed rows).
CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_history
  ON category_revenue_allocations (project_id, category_key, effective_to);

-- Index for import-run-based queries (rollback, audit).
CREATE INDEX IF NOT EXISTS idx_category_revenue_allocations_import_run
  ON category_revenue_allocations (import_run_id);
