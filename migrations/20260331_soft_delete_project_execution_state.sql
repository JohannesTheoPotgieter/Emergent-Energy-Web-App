-- =============================================================================
-- Migration: Standardize soft-delete on project_execution_state
-- Date: 2026-03-31
-- Risk: MEDIUM
-- Transaction: CAN run inside a transaction.
--
-- The table already has both is_active (boolean) and deleted_at (timestamp).
-- This migration:
--   1. Backfills deleted_at = NOW() where is_active = false AND deleted_at IS NULL
--   2. Verifies consistency between is_active and deleted_at
--   3. Does NOT drop is_active (30-day observation window)
-- =============================================================================

-- ─── Step 1: Backfill deleted_at from is_active ─────────────────────────────

UPDATE project_execution_state
SET deleted_at = NOW()
WHERE is_active = false
  AND deleted_at IS NULL;

-- ─── Step 2: Verify consistency ─────────────────────────────────────────────

DO $$
DECLARE
  total_rows INT;
  active_with_null_deleted INT;
  inactive_with_deleted INT;
  inconsistent_active_deleted INT;
  inconsistent_inactive_null INT;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM project_execution_state;

  -- Active rows should have deleted_at IS NULL
  SELECT COUNT(*) INTO active_with_null_deleted
  FROM project_execution_state
  WHERE is_active = true AND deleted_at IS NULL;

  -- Inactive rows should have deleted_at IS NOT NULL
  SELECT COUNT(*) INTO inactive_with_deleted
  FROM project_execution_state
  WHERE is_active = false AND deleted_at IS NOT NULL;

  -- Inconsistencies: active but deleted_at set
  SELECT COUNT(*) INTO inconsistent_active_deleted
  FROM project_execution_state
  WHERE is_active = true AND deleted_at IS NOT NULL;

  -- Inconsistencies: inactive but deleted_at null (should be 0 after backfill)
  SELECT COUNT(*) INTO inconsistent_inactive_null
  FROM project_execution_state
  WHERE is_active = false AND deleted_at IS NULL;

  RAISE NOTICE '=== SOFT-DELETE MIGRATION VERIFICATION: project_execution_state ===';
  RAISE NOTICE 'Total rows: %', total_rows;
  RAISE NOTICE 'Active (is_active=true, deleted_at IS NULL): %', active_with_null_deleted;
  RAISE NOTICE 'Deleted (is_active=false, deleted_at IS NOT NULL): %', inactive_with_deleted;
  RAISE NOTICE 'Inconsistent (active + deleted_at set): %', inconsistent_active_deleted;
  RAISE NOTICE 'Inconsistent (inactive + deleted_at null): %', inconsistent_inactive_null;

  IF inconsistent_inactive_null > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % rows are inactive but deleted_at is still NULL', inconsistent_inactive_null;
  END IF;

  RAISE NOTICE '=== END VERIFICATION ===';
END $$;

-- ─── Step 3: Add deprecation comment ────────────────────────────────────────

COMMENT ON COLUMN project_execution_state.is_active IS
  'DEPRECATED 2026-03-31: Use deleted_at IS NULL instead. Drop after 30-day observation window.';
