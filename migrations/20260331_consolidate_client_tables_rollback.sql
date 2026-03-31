-- =============================================================================
-- Rollback: Revert client table consolidation
-- Date: 2026-03-31
--
-- Removes migrated rows from canonical tables.
-- Restores legacy table comments.
-- Does NOT drop canonical tables (they existed before the migration).
-- =============================================================================

-- Remove rows that were migrated (keep any that were created natively)
DELETE FROM client_commitments WHERE migrated_from_legacy = true;
DELETE FROM client_updates WHERE migrated_from_legacy = true;

-- Remove migration tracking column
ALTER TABLE client_commitments DROP COLUMN IF EXISTS migrated_from_legacy;
ALTER TABLE client_updates DROP COLUMN IF EXISTS migrated_from_legacy;

-- Remove deprecation comments
COMMENT ON TABLE project_client_commitments IS NULL;
COMMENT ON TABLE project_client_updates IS NULL;
