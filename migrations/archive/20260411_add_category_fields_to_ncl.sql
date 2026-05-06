-- S02: Add category_key and category_allocation_id to normalized_cost_lines
-- Purpose: category_key stores the canonical numbered category key (e.g. "1. Panels")
--          for grouping and frontend sorting. category_allocation_id is a FK to the
--          category_revenue_allocations row for direct formula lookup.
-- Safety: Additive — nullable columns only, no data changes, no existing columns modified.
-- Rollback: 20260411_add_category_fields_to_ncl_rollback.sql

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS category_key TEXT,
  ADD COLUMN IF NOT EXISTS category_allocation_id INTEGER REFERENCES category_revenue_allocations(id);

-- Index for category-level aggregation queries (SUM of COS per category).
CREATE INDEX IF NOT EXISTS idx_ncl_category_key
  ON normalized_cost_lines (project_id, category_key)
  WHERE effective_to IS NULL;
