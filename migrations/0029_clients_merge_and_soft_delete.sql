-- 0029_clients_merge_and_soft_delete.sql
--
-- Task #73 — Client merge & soft-delete capability.
--
-- Hand-authored, additive, idempotent migration. Adds:
--   1. `clients.deleted_at`              — soft-delete timestamp.
--   2. `clients.merged_into_client_id`   — self-FK; when a client is merged
--      into a survivor, this points the loser at the survivor so deep
--      links to the loser's id can resolve to the survivor.
--   3. New table `client_merges`         — audit ledger; one row per
--      executed merge with the per-table re-pointed counts as JSONB.
--
-- ZERO PK type changes anywhere — `clients.id` stays `serial`,
-- `client_merges.id` is `serial` to match every other table in this
-- codebase. ZERO column-type changes on existing columns. Every
-- statement is wrapped in IF NOT EXISTS / DO blocks so re-running this
-- migration is a no-op.
--
-- See docs/runbooks/foundation-linkage-hardening-2026-04-22.md for the
-- precedent (Task #34, migration 0019) on the soft-delete +
-- cascade-display pattern this migration follows.

BEGIN;

-- 1. clients.deleted_at -------------------------------------------------------

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Partial index used by the `WHERE deleted_at IS NULL` cascade-display
-- filter on every client read path. Mirrors the pd_tickets index added
-- in migration 0019.
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at
  ON clients (deleted_at) WHERE deleted_at IS NULL;

-- 2. clients.merged_into_client_id -------------------------------------------

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS merged_into_client_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'clients'
      AND constraint_name = 'clients_merged_into_client_id_fkey'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_merged_into_client_id_fkey
      FOREIGN KEY (merged_into_client_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_merged_into_client_id
  ON clients (merged_into_client_id) WHERE merged_into_client_id IS NOT NULL;

-- 3. client_merges audit ledger ----------------------------------------------

CREATE TABLE IF NOT EXISTS client_merges (
  id                     SERIAL PRIMARY KEY,
  loser_client_id        INTEGER NOT NULL REFERENCES clients(id),
  survivor_client_id     INTEGER NOT NULL REFERENCES clients(id),
  performed_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  performed_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Snapshot of the loser at merge-time so the survivor's
  -- "previously known as" chip stays meaningful even if the loser row
  -- is later restored or renamed.
  loser_name_snapshot    TEXT NOT NULL,
  loser_client_id_snapshot TEXT NOT NULL,
  -- Per-table counts of rows re-pointed during the merge, e.g.
  -- {"project_info": 4, "opportunities": 7, "engineering_tickets": 12, ...}
  repointed_counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Optional free-form note captured from the merge dialog.
  reason                 TEXT,
  CONSTRAINT client_merges_distinct_chk
    CHECK (loser_client_id <> survivor_client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_merges_survivor
  ON client_merges (survivor_client_id);

CREATE INDEX IF NOT EXISTS idx_client_merges_loser
  ON client_merges (loser_client_id);

COMMIT;
