-- ============================================================
-- Rollback: Prompt 12 — Dashboard Materialized Metrics
-- ============================================================

DROP INDEX IF EXISTS idx_dpm_project_id;
DROP INDEX IF EXISTS idx_dpm_organization_id;
DROP INDEX IF EXISTS idx_dpm_phase;
DROP INDEX IF EXISTS idx_dpm_rag_status;
DROP INDEX IF EXISTS idx_dpgm_organization_id;

DROP TABLE IF EXISTS dashboard_project_metrics;
DROP TABLE IF EXISTS dashboard_program_metrics;
