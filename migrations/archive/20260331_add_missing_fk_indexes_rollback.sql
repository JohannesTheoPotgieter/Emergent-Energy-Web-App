-- =============================================================================
-- Rollback: Drop indexes added by 20260331_add_missing_fk_indexes.sql
-- Date: 2026-03-31
-- Risk: LOW — dropping indexes only affects query performance, not data.
-- =============================================================================

DROP INDEX IF EXISTS idx_ncl_import_run_id;
DROP INDEX IF EXISTS idx_nrl_import_run_id;
DROP INDEX IF EXISTS idx_hci_handover_pack_id;
DROP INDEX IF EXISTS idx_sites_client_id;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_cs_entity;
DROP INDEX IF EXISTS idx_ncl_project_snapshot;
DROP INDEX IF EXISTS idx_nrl_project_snapshot;
DROP INDEX IF EXISTS idx_psi_project_stage;
