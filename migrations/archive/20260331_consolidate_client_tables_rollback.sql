-- ============================================================
-- ROLLBACK: Consolidate legacy client tables migration
-- Date: 2026-03-31
-- Transaction: YES
-- ============================================================
--
-- This rollback:
--   1. Deletes only rows that were migrated from legacy (migrated_from_legacy = true)
--   2. Drops the migrated_from_legacy columns
--   3. Drops the temporary dedup index
--   4. Does NOT touch the legacy tables (they were never modified)
-- ============================================================

BEGIN;

-- ── Step 1: Remove migrated rows from canonical tables ──

DELETE FROM project_client_commitments WHERE migrated_from_legacy = true;
DELETE FROM project_client_updates WHERE migrated_from_legacy = true;

-- ── Step 2: Drop temporary dedup index ──

DROP INDEX IF EXISTS pcc_legacy_dedup_idx;

-- ── Step 3: Drop migrated_from_legacy columns ──

ALTER TABLE project_client_commitments DROP COLUMN IF EXISTS migrated_from_legacy;
ALTER TABLE project_client_updates DROP COLUMN IF EXISTS migrated_from_legacy;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES (run after rollback)
-- ============================================================
--
-- 1. Confirm no migrated rows remain:
--    SELECT COUNT(*) FROM project_client_commitments WHERE migrated_from_legacy = true;
--    -- Should error (column dropped) or return 0
--
-- 2. Confirm canonical tables still have non-migrated rows:
--    SELECT COUNT(*) FROM project_client_commitments;
--    SELECT COUNT(*) FROM project_client_updates;
--
-- 3. Confirm legacy tables are untouched:
--    SELECT COUNT(*) FROM client_commitments;
--    SELECT COUNT(*) FROM client_updates;
-- ============================================================
