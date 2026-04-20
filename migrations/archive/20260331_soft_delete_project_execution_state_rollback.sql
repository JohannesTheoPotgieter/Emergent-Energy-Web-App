-- =============================================================================
-- Rollback: Revert soft-delete migration on project_execution_state
-- Date: 2026-03-31
--
-- Note: This does NOT clear deleted_at values that were set independently
-- of the backfill (e.g., by application code). It only syncs is_active
-- back to be the canonical flag.
-- =============================================================================

-- Ensure is_active matches deleted_at state
UPDATE project_execution_state SET is_active = true WHERE deleted_at IS NULL;
UPDATE project_execution_state SET is_active = false WHERE deleted_at IS NOT NULL;

-- Remove deprecation comment
COMMENT ON COLUMN project_execution_state.is_active IS NULL;
