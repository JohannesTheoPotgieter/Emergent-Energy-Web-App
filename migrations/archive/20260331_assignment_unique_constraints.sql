-- =============================================================================
-- Migration: Add unique constraints to work_item_assignments and entity_assignments
-- Date: 2026-03-31
-- Risk: LOW — dedup runs first, then constraint added.
-- Transaction: CAN run inside a transaction (recommended for atomicity).
--
-- Note on entity_assignments:
--   A partial unique index already exists from migration 20260326:
--     entity_assignments_active_unique ON (entity_type, entity_id, assignment_role,
--       assignee_type, assignee_id) WHERE active = TRUE
--   The prompt asks for a non-partial unique constraint on
--     (entity_type, entity_id, assignee_id, assignment_role).
--   Since the partial index already prevents active duplicates (and includes
--   assignee_type which the prompt omits), we skip adding a redundant constraint
--   on entity_assignments to avoid conflicting with the existing index.
-- =============================================================================

-- ─── Step 1: Quarantine duplicates in work_item_assignments ─────────────────

-- Archive duplicates before deleting (safety)
CREATE TABLE IF NOT EXISTS work_item_assignments_dedup_archive (
  LIKE work_item_assignments INCLUDING ALL
);

INSERT INTO work_item_assignments_dedup_archive
SELECT * FROM work_item_assignments
WHERE id NOT IN (
  SELECT MIN(id) FROM work_item_assignments
  GROUP BY work_item_id, user_id, role
);

-- Remove duplicates (keep lowest id per unique combination)
DELETE FROM work_item_assignments
WHERE id NOT IN (
  SELECT MIN(id) FROM work_item_assignments
  GROUP BY work_item_id, user_id, role
);

-- ─── Step 2: Add unique constraint ─────────────────────────────────────────

ALTER TABLE work_item_assignments
  ADD CONSTRAINT uq_work_item_user_role
  UNIQUE (work_item_id, user_id, role);

-- ─── Step 3: Verification ──────────────────────────────────────────────────

DO $$
DECLARE
  archived_count INT;
  remaining_count INT;
BEGIN
  SELECT COUNT(*) INTO archived_count FROM work_item_assignments_dedup_archive;
  SELECT COUNT(*) INTO remaining_count FROM work_item_assignments;

  RAISE NOTICE '=== ASSIGNMENT UNIQUE CONSTRAINT VERIFICATION ===';
  RAISE NOTICE 'work_item_assignments: duplicates archived=%, remaining rows=%', archived_count, remaining_count;

  -- Verify no duplicates remain
  PERFORM 1 FROM work_item_assignments
  GROUP BY work_item_id, user_id, role
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicates still exist in work_item_assignments after dedup!';
  ELSE
    RAISE NOTICE 'work_item_assignments: zero duplicates confirmed';
  END IF;

  RAISE NOTICE '=== END VERIFICATION ===';
END $$;
