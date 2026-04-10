-- Rollback for S02: Remove category fields from normalized_cost_lines
-- Safety: Only drops objects created by the forward migration.

DROP INDEX IF EXISTS idx_ncl_category_key;
ALTER TABLE normalized_cost_lines
  DROP COLUMN IF EXISTS category_allocation_id,
  DROP COLUMN IF EXISTS category_key;
