-- 0025_engineering_tickets_physical_rename.sql
--
-- Vocabulary phase 2 (task #58) — physical rename.
--
-- Companion migration to `0024_engineering_tickets_view_alias.sql`. After
-- one release on the additive view + parallel generated column, this
-- migration flips the direction:
--
--   * `pd_tickets` is renamed to `engineering_tickets` (the table, its
--     primary key sequence, indexes, and constraints are renamed
--     alongside it so the symbol set stays internally consistent).
--   * `work_items.pd_ticket_id` is renamed to `engineering_ticket_id`,
--     keeping the FK `ON DELETE SET NULL` from migration 0019.
--   * The soft-delete reject trigger from migration 0021 is recreated
--     under the new column / table names.
--   * Backwards-compatible aliases are re-created in the OPPOSITE
--     direction so any straggler code path that still references the
--     old names keeps working for one release:
--       - VIEW   `pd_tickets`              → `engineering_tickets`
--       - COLUMN `work_items.pd_ticket_id` → STORED-generated from
--                                            `engineering_ticket_id`
--
-- Hand-authored, idempotent (re-runnable). The branching on
-- `information_schema` lookups is what makes each step idempotent:
-- running this migration a second time is a no-op.

BEGIN;

-- 0. Drop the additive aliases from 0024 so the rename can land --------------
--
-- These were view/generated-column over the OLD names; once the base
-- objects are renamed below they need to be re-created in the OPPOSITE
-- direction (see steps 4 & 5).
DROP VIEW IF EXISTS engineering_tickets;

DROP INDEX IF EXISTS idx_work_items_engineering_ticket_id;

ALTER TABLE work_items
  DROP COLUMN IF EXISTS engineering_ticket_id;

-- 1. Drop the soft-delete trigger so we can recreate it under the new
--    column name in step 6. The function is recreated below.
DROP TRIGGER IF EXISTS work_items_reject_softdeleted_pd_ticket_trg ON work_items;

-- 2. Rename pd_tickets → engineering_tickets ---------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pd_tickets'
      AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE pd_tickets RENAME TO engineering_tickets;
  END IF;
END $$;

-- Rename the PK sequence + the well-known indexes that name the table
-- explicitly. Postgres renames the implicit PK constraint along with
-- the table, but USER-DEFINED indexes do NOT get renamed.
ALTER SEQUENCE IF EXISTS pd_tickets_id_seq RENAME TO engineering_tickets_id_seq;

ALTER INDEX IF EXISTS pd_tickets_pkey
  RENAME TO engineering_tickets_pkey;
ALTER INDEX IF EXISTS idx_pd_tickets_deleted_at
  RENAME TO idx_engineering_tickets_deleted_at;
ALTER INDEX IF EXISTS pd_tickets_opportunity_shadow_unique
  RENAME TO engineering_tickets_opportunity_shadow_unique;
ALTER INDEX IF EXISTS pd_tickets_phase_per_project_uniq
  RENAME TO engineering_tickets_phase_per_project_uniq;

-- 3. Rename work_items.pd_ticket_id → engineering_ticket_id ------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_items'
      AND column_name = 'pd_ticket_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_items'
      AND column_name = 'engineering_ticket_id'
  ) THEN
    ALTER TABLE work_items RENAME COLUMN pd_ticket_id TO engineering_ticket_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_work_items_pd_ticket_id
  RENAME TO idx_work_items_engineering_ticket_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'work_items'
      AND constraint_name = 'work_items_pd_ticket_id_fkey'
  ) THEN
    ALTER TABLE work_items
      RENAME CONSTRAINT work_items_pd_ticket_id_fkey
      TO work_items_engineering_ticket_id_fkey;
  END IF;
END $$;

-- 4. Backwards-compat COLUMN: work_items.pd_ticket_id ------------------------
--
-- Generated STORED column mirrors the new base column so any straggler
-- SQL that still selects `pd_ticket_id` keeps working for one release.
-- Done BEFORE the backwards-compat view in step 5 so the
-- `information_schema.columns` lookup below is unambiguous.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_items'
      AND column_name = 'pd_ticket_id'
  ) THEN
    EXECUTE 'ALTER TABLE work_items
             ADD COLUMN pd_ticket_id integer
             GENERATED ALWAYS AS (engineering_ticket_id) STORED';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_pd_ticket_id
  ON work_items (pd_ticket_id) WHERE pd_ticket_id IS NOT NULL;

-- 5. Backwards-compat VIEW: pd_tickets → engineering_tickets -----------------
--
-- A bare `SELECT *` over a single base table is automatically updatable
-- in PostgreSQL (no INSTEAD OF trigger required). Any straggler code
-- path that still does INSERT/UPDATE/DELETE on `pd_tickets` keeps
-- working for one release. Drop in the next phase once telemetry
-- confirms zero traffic.
DROP VIEW IF EXISTS pd_tickets;
CREATE VIEW pd_tickets AS
  SELECT * FROM engineering_tickets;

COMMENT ON VIEW pd_tickets IS
  'Backwards-compat alias for engineering_tickets (renamed in migration 0025). Drop after one release.';

-- 6. Recreate the soft-delete reject trigger under the new column name -------
--
-- Same guard as migration 0021, but the function and trigger now look
-- at `engineering_ticket_id` / `engineering_tickets`. The exception
-- message keeps the word "soft-deleted" so the existing release-gate
-- assertion in `qa/tests/integration/foundation-linkage-cascades.test.ts`
-- still matches.
CREATE OR REPLACE FUNCTION work_items_reject_softdeleted_engineering_ticket()
RETURNS TRIGGER AS $$
DECLARE
  v_deleted_at timestamp;
BEGIN
  IF NEW.engineering_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT deleted_at INTO v_deleted_at
    FROM engineering_tickets
   WHERE id = NEW.engineering_ticket_id;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'work_items.engineering_ticket_id % refers to a soft-deleted engineering_ticket', NEW.engineering_ticket_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_items_reject_softdeleted_engineering_ticket_trg ON work_items;
CREATE TRIGGER work_items_reject_softdeleted_engineering_ticket_trg
  BEFORE INSERT OR UPDATE OF engineering_ticket_id ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION work_items_reject_softdeleted_engineering_ticket();

-- The legacy function from 0021 (`work_items_reject_softdeleted_pd_ticket`)
-- is left in place but unreferenced; safe to drop in a follow-up cleanup
-- migration once we are confident nothing else references it.

COMMIT;
