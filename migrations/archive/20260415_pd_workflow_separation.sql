-- PD workflow separation: make the three objects distinguishable without
-- breaking any existing data.
--
-- Context: opportunities, pd_tickets and project_info are three loosely
-- coupled tables today. Problems proven by code inspection:
--   1. No way to tell a Pipedrive-synced opportunity from an internal one.
--   2. pd_tickets has no link back to the commercial opportunity that
--      triggered it — only to a project_info row that may not exist yet.
--   3. opportunities.handover_readiness duplicates projectPdPmHandover.
--
-- This migration is additive only. No columns are dropped, renamed or
-- retyped. Existing data remains valid. Nullable/defaulted columns are
-- safe to add on a live database.

BEGIN;

-- 1. Tag every opportunity with its source so the UI, reports, and the
--    sync engine can distinguish CRM-synced records from internal ones.
--    Default is 'internal' because that is the safe assumption for any
--    manually-created row from the /api/opportunities POST path.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal';

-- Backfill: any row that already has a Pipedrive deal id is CRM-synced.
-- Guarded so this stays idempotent on re-run.
UPDATE opportunities
   SET source = 'pipedrive'
 WHERE pipedrive_deal_id IS NOT NULL
   AND source = 'internal';

-- Observability: log the current counts so operators can see the
-- backfill ran cleanly.
DO $$
DECLARE
  pipedrive_count INTEGER;
  internal_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pipedrive_count FROM opportunities WHERE source = 'pipedrive';
  SELECT COUNT(*) INTO internal_count FROM opportunities WHERE source = 'internal';
  RAISE NOTICE '[pd-workflow] opportunities.source backfill: pipedrive=%, internal=%', pipedrive_count, internal_count;
END $$;

-- 2. Give pd_tickets an optional link to the commercial opportunity that
--    triggered the PD work. Nullable so existing tickets stay valid.
--    ON DELETE SET NULL so removing an opportunity does not cascade into
--    the work queue.
ALTER TABLE pd_tickets
  ADD COLUMN IF NOT EXISTS opportunity_id INTEGER
    REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_pd_tickets_opportunity_id
  ON pd_tickets (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- 3. Observability for the handover-readiness duplication. We do NOT
--    drop `opportunities.handover_readiness` here — that is a structural
--    change that requires UI and report updates. This migration only
--    logs the current spread so operators know how many rows rely on it.
DO $$
DECLARE
  non_default_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO non_default_count
    FROM opportunities
   WHERE handover_readiness IS NOT NULL
     AND handover_readiness <> 'not_ready';
  RAISE NOTICE '[pd-workflow] opportunities.handover_readiness rows with non-default value: %', non_default_count;
END $$;

COMMIT;
