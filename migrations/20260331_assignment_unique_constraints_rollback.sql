-- =============================================================================
-- Rollback: Remove unique constraint and restore archived duplicates
-- Date: 2026-03-31
-- =============================================================================

-- Drop the unique constraint
ALTER TABLE work_item_assignments
  DROP CONSTRAINT IF EXISTS uq_work_item_user_role;

-- Restore archived duplicates (if any)
INSERT INTO work_item_assignments
SELECT * FROM work_item_assignments_dedup_archive
ON CONFLICT DO NOTHING;

-- Note: work_item_assignments_dedup_archive table is preserved for audit.
-- Drop it manually after confirming rollback is complete:
--   DROP TABLE IF EXISTS work_item_assignments_dedup_archive;
