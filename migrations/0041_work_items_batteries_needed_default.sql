-- Path 2 follow-up — drop the `DEFAULT false` on work_items.batteries_needed
-- so the migration 0040 backfill semantics actually work for any future
-- linked rows.
--
-- Background:
--   Migration 0040 added `batteries_needed boolean DEFAULT false` and
--   then ran an idempotent COALESCE backfill from engineering_tickets.
--   Because the DEFAULT made the column non-NULL on insert, the
--   COALESCE(wi.batteries_needed, et.batteries_needed) clause would
--   always pick the wi value (false) instead of inheriting `true`
--   from the linked ticket. The 3 historical rows were unaffected
--   because their tickets were also `false`, but going forward this
--   would silently mis-classify any ticket that flips `true` later.
--
-- This migration:
--   1. Drops the DEFAULT (additive metadata change — does NOT touch
--      existing row values).
--   2. Re-runs the COALESCE backfill, this time gated on the new NULL
--      semantics so any future linked row that was inserted before the
--      DEFAULT was dropped (and therefore is currently `false` from
--      the DEFAULT) gets a chance to inherit `true` from its ticket
--      iff the ticket says so.
--
-- Reversal: re-add `DEFAULT false`. No data is lost either way.

ALTER TABLE work_items
  ALTER COLUMN batteries_needed DROP DEFAULT;

-- Conservative re-backfill: only flip rows from false→true when the
-- linked ticket explicitly says batteries are needed. Never overwrites
-- a true value (the wi side wins on truth) and never touches
-- unlinked or soft-deleted rows.
UPDATE work_items wi
SET batteries_needed = true,
    updated_at       = now()
FROM engineering_tickets et
WHERE wi.engineering_ticket_id = et.id
  AND wi.workstream            = 'ENG'
  AND wi.deleted_at            IS NULL
  AND et.batteries_needed      IS TRUE
  AND (wi.batteries_needed IS NULL OR wi.batteries_needed = false);
