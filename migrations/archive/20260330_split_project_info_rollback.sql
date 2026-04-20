-- ============================================================
-- Rollback: Drop the two new tables created by split_project_info
-- Original project_info columns are untouched (never dropped).
-- ============================================================

DROP TABLE IF EXISTS project_settings CASCADE;
DROP TABLE IF EXISTS project_execution_state CASCADE;
