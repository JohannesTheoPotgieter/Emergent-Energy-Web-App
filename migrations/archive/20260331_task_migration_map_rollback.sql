-- ============================================================
-- Rollback: Prompt 6 — Task Migration Map + Extension Data
--
-- 1. Truncate extension tables (data came from work_items, no data loss)
-- 2. Drop task_migration_map
--
-- work_items core data is NOT touched.
-- Extension table schemas are NOT dropped (that's Prompt 5 rollback).
-- ============================================================

-- Clear extension table data (populated by backfill)
TRUNCATE TABLE work_item_pm CASCADE;
TRUNCATE TABLE work_item_engineering CASCADE;
TRUNCATE TABLE work_item_scheduling CASCADE;

-- Drop migration map
DROP TABLE IF EXISTS task_migration_map CASCADE;
