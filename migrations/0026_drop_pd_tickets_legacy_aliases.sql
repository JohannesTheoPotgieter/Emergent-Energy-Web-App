-- 0026_drop_pd_tickets_legacy_aliases.sql
--
-- Vocabulary phase 2 cleanup (task #60).
--
-- Migration 0025 (task #58) physically renamed `pd_tickets` →
-- `engineering_tickets` and `work_items.pd_ticket_id` →
-- `engineering_ticket_id`, but kept three backwards-compat aliases in
-- place for one release so any straggler code path that still
-- referenced the old names would keep working:
--
--   * VIEW   `pd_tickets`              → `engineering_tickets`
--   * COLUMN `work_items.pd_ticket_id` (STORED generated from
--                                       `engineering_ticket_id`)
--   * INDEX  `idx_work_items_pd_ticket_id` on the column above
--
-- It also left in place the now-unreferenced PL/pgSQL function
-- `work_items_reject_softdeleted_pd_ticket()` from migration 0021
-- (its trigger was already dropped in step 1 of migration 0025 and
-- replaced by `work_items_reject_softdeleted_engineering_ticket()`).
--
-- Production telemetry has confirmed zero traffic against the old
-- names for a full release, so this migration drops them all to
-- reduce schema clutter and prevent future contributors from being
-- misled by the duplication.
--
-- Hand-authored, idempotent (re-runnable). Each DROP uses
-- `IF EXISTS` so running this migration a second time is a no-op.

BEGIN;

-- 1. Drop the backwards-compat VIEW `pd_tickets` (over engineering_tickets)
DROP VIEW IF EXISTS pd_tickets;

-- 2. Drop the partial index on the legacy generated column. Postgres
--    would drop this automatically when the column goes, but doing it
--    explicitly keeps the migration's intent visible in `\d work_items`
--    diffs and stays idempotent if a previous partial run already
--    dropped the column.
DROP INDEX IF EXISTS idx_work_items_pd_ticket_id;

-- 3. Drop the STORED generated column `work_items.pd_ticket_id`.
ALTER TABLE work_items DROP COLUMN IF EXISTS pd_ticket_id;

-- 4. Drop the unreferenced legacy soft-delete reject function from
--    migration 0021. Its trigger was already removed in step 1 of
--    migration 0025; the function itself was left behind to be
--    cleaned up in a follow-up — this is that follow-up.
DROP FUNCTION IF EXISTS work_items_reject_softdeleted_pd_ticket();

COMMIT;
