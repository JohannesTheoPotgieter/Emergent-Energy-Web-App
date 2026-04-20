-- 2026-04-20 — add province to opportunities
-- Additive only, IF NOT EXISTS, no destructive operations.
-- Backfills from the linked PD shadow (pd_tickets.province) so the new
-- column is immediately useful even before the next Pipedrive sync run.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS province text;

UPDATE opportunities o
SET province = pd.province
FROM pd_tickets pd
WHERE pd.opportunity_id = o.id
  AND o.province IS NULL
  AND pd.province IS NOT NULL
  AND pd.province <> '';
