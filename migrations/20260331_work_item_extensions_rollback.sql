-- ============================================================
-- Rollback: Prompt 5 — Work Item Extension Tables
--
-- Drops the 3 extension tables. No data loss since these
-- tables were created empty (no backfill in this prompt).
-- ============================================================

DROP TABLE IF EXISTS work_item_scheduling CASCADE;
DROP TABLE IF EXISTS work_item_engineering CASCADE;
DROP TABLE IF EXISTS work_item_pm CASCADE;
