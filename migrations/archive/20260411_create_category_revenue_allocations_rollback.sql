-- Rollback for S01: Drop category_revenue_allocations table
-- Safety: Only drops objects created by the forward migration.

DROP INDEX IF EXISTS idx_category_revenue_allocations_import_run;
DROP INDEX IF EXISTS idx_category_revenue_allocations_history;
DROP INDEX IF EXISTS uq_category_revenue_allocations_active;
DROP TABLE IF EXISTS category_revenue_allocations;
DROP TYPE IF EXISTS allocation_confidence;
