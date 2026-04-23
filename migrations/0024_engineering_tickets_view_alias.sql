-- 0024_engineering_tickets_view_alias.sql
--
-- Vocabulary phase 2 (task #58) — additive read alias.
--
-- Phase 1 (task #56) retired the user-facing "PD ticket" vocabulary in
-- the UI and exposed an `engineeringTickets` payload key alongside the
-- legacy `pdTickets` key. This migration is the **first half** of the
-- schema-side rename: it introduces `engineering_tickets` as a
-- zero-downtime updatable view over `pd_tickets`, and adds a parallel
-- generated `engineering_ticket_id` column on `work_items`. Existing
-- code that reads/writes `pd_tickets` and `work_items.pd_ticket_id`
-- continues to work unchanged.
--
-- The physical rename (table and column) lands in
-- `0025_engineering_tickets_physical_rename.sql`. Splitting the rollout
-- in two migrations gives operations a single-release window in which
-- both the old and new names are valid, and lets us verify the new name
-- in production traffic before flipping the base table.
--
-- Hand-authored, additive, idempotent.

BEGIN;

-- 1. engineering_tickets view ------------------------------------------------
--
-- A bare `SELECT *` over a single base table is automatically updatable
-- in PostgreSQL (no INSTEAD OF trigger required). Drizzle's INSERT,
-- UPDATE, DELETE on `engineering_tickets` will be rewritten by the
-- planner to operate on `pd_tickets` directly until the physical rename
-- happens in 0025.
DROP VIEW IF EXISTS engineering_tickets;
CREATE VIEW engineering_tickets AS
  SELECT * FROM pd_tickets;

COMMENT ON VIEW engineering_tickets IS
  'Phase-2 vocabulary alias for pd_tickets. Auto-updatable. See migration 0024.';

-- 2. work_items.engineering_ticket_id parallel generated column --------------
--
-- A STORED generated column lets Drizzle and any new SQL read the new
-- name without migrating writes yet. The base column `pd_ticket_id`
-- remains the source of truth until 0025 swaps the direction.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_items'
      AND column_name = 'engineering_ticket_id'
  ) THEN
    ALTER TABLE work_items
      ADD COLUMN engineering_ticket_id integer
      GENERATED ALWAYS AS (pd_ticket_id) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_engineering_ticket_id
  ON work_items (engineering_ticket_id) WHERE engineering_ticket_id IS NOT NULL;

COMMIT;
