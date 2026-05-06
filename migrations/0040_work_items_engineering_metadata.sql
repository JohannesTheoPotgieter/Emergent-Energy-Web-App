-- Path 2 — engineering metadata consolidation onto work_items.
--
-- Background (Task: opportunity-drawer phantom duplicate fix):
--   The "Add Engineering Ticket" form on /opportunities writes BOTH a
--   row to engineering_tickets AND a sibling row to work_items
--   (workstream='ENG', engineering_ticket_id=ticket.id). This
--   duplication produced two cards on the drawer board because the
--   drawer rendered both the ticket-promoted synthetic card AND the
--   sibling work_item.
--
--   We are NOT removing the engineering_tickets table — finance/FYE
--   revenue rollup, PD dashboard, gate auto-evaluator, Pipedrive sync
--   and 5 other modules still read from it. Instead, work_items
--   becomes the canonical engineering-execution row, and the sibling
--   is enriched with the solar/site metadata so the drawer (and any
--   future consumer) can read everything from work_items alone.
--
-- Changes (all additive, all idempotent, NO data loss):
--   1. Add 6 nullable solar/site columns to work_items.
--   2. Add a composite index supporting the tightened drawer query
--      (workstream + engineering_ticket_id + deleted_at).
--   3. One-shot backfill: for every existing work_items row that is
--      already linked back to an engineering_tickets row via
--      engineering_ticket_id, copy the 6 metadata fields across so
--      historical rows match the post-cutover shape.
--
-- Reversal: if you ever need to undo this, the columns are nullable
-- and unused by any pre-existing reader, so a DROP COLUMN is safe in
-- isolation. The backfill UPDATE is idempotent — re-running this
-- migration is a no-op.

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS funding_type      text,
  ADD COLUMN IF NOT EXISTS size_kwp          numeric(12, 2),
  ADD COLUMN IF NOT EXISTS province          text,
  ADD COLUMN IF NOT EXISTS gps_coordinates   text,
  ADD COLUMN IF NOT EXISTS batteries_needed  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS battery_size      numeric(12, 2);

-- Composite partial index for the drawer query:
--   WHERE workstream = 'ENG'
--     AND engineering_ticket_id IS NOT NULL
--     AND deleted_at IS NULL
--     AND project_id = $1
-- Active-row partial keeps the index small.
CREATE INDEX IF NOT EXISTS idx_work_items_eng_ticket_active
  ON work_items (workstream, engineering_ticket_id, project_id)
  WHERE deleted_at IS NULL AND engineering_ticket_id IS NOT NULL;

-- Backfill the 6 new columns on sibling rows from their linked ticket.
-- Idempotent — only writes when the work_items column is NULL so re-runs
-- never overwrite hand-edits made on work_items.* after cutover.
UPDATE work_items wi
SET
  funding_type     = COALESCE(wi.funding_type,     et.funding_type),
  size_kwp         = COALESCE(wi.size_kwp,         et.size_kwp),
  province         = COALESCE(wi.province,         et.province),
  gps_coordinates  = COALESCE(wi.gps_coordinates,  et.gps_coordinates),
  batteries_needed = COALESCE(wi.batteries_needed, et.batteries_needed),
  battery_size     = COALESCE(wi.battery_size,     et.battery_size)
FROM engineering_tickets et
WHERE wi.engineering_ticket_id = et.id
  AND wi.deleted_at IS NULL;
