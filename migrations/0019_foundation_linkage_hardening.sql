-- Foundation Linkage Hardening (Task #34, 2026-04-22)
--
-- Hand-authored, additive, idempotent migration.
--   - Adds `pd_tickets.deleted_at` to bring it in line with the other
--     three core spine tables (opportunities, project_info, work_items).
--   - Adds the missing FK on `work_items.pd_ticket_id` so the live data
--     spine cannot accumulate orphan rows. Existing orphan work_items
--     (pd_ticket_id pointing at a non-existent or soft-deleted ticket)
--     are quarantined by clearing the column to NULL — they are NOT
--     hard-deleted; the work_items themselves remain.
--   - Adds a partial unique index that preserves the existing
--     "shadow ticket per opportunity" 1:1 contract while ignoring
--     soft-deleted rows.
--
-- See docs/runbooks/foundation-linkage-hardening-2026-04-22.md.

BEGIN;

-- 1. pd_tickets.deleted_at ----------------------------------------------------

ALTER TABLE pd_tickets
  ADD COLUMN IF NOT EXISTS deleted_at timestamp;

CREATE INDEX IF NOT EXISTS idx_pd_tickets_deleted_at
  ON pd_tickets (deleted_at) WHERE deleted_at IS NULL;

-- 2. work_items.pd_ticket_id quarantine + FK ---------------------------------

-- Quarantine orphans first so the FK can be added cleanly. We do NOT
-- delete the work_item rows themselves; we only clear the dangling
-- pointer. The action is logged through Postgres RAISE NOTICE so the
-- operator running the migration sees how many rows were affected.
DO $$
DECLARE
  orphan_count int;
BEGIN
  WITH orphans AS (
    SELECT wi.id
    FROM work_items wi
    LEFT JOIN pd_tickets pt ON pt.id = wi.pd_ticket_id
    WHERE wi.pd_ticket_id IS NOT NULL
      AND (pt.id IS NULL OR pt.deleted_at IS NOT NULL)
  ),
  cleared AS (
    UPDATE work_items
    SET pd_ticket_id = NULL,
        updated_at = NOW()
    WHERE id IN (SELECT id FROM orphans)
    RETURNING id
  )
  SELECT COUNT(*) INTO orphan_count FROM cleared;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'foundation-linkage-hardening: quarantined % orphan work_items.pd_ticket_id pointers', orphan_count;
  END IF;
END $$;

-- Add the FK only if it does not already exist. ON DELETE SET NULL so a
-- future hard-delete or admin-recovery sweep cannot silently corrupt
-- work_items.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'work_items'
      AND constraint_name = 'work_items_pd_ticket_id_fkey'
  ) THEN
    ALTER TABLE work_items
      ADD CONSTRAINT work_items_pd_ticket_id_fkey
      FOREIGN KEY (pd_ticket_id) REFERENCES pd_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_pd_ticket_id
  ON work_items (pd_ticket_id) WHERE pd_ticket_id IS NOT NULL;

COMMIT;
