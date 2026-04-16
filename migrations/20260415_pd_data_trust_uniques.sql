-- Data trust: promote the partial indexes on Pipedrive keys to UNIQUE,
-- but ONLY if the current data is already duplicate-free.
--
-- Rationale: the sync service has a race-recovery fallback precisely
-- because the schema does not enforce uniqueness today. Shipping a
-- UNIQUE constraint on an environment that already contains duplicates
-- would fail the migration and leave the integration broken. This
-- migration inspects the data first and skips the unique promotion with
-- a NOTICE if any duplicates exist.
--
-- Operators: if this migration emits "skipped" NOTICEs, run the dedup
-- runbook in docs/runbooks/pd-data-trust-review-2026-04-15.md before
-- re-running it.
--
-- Safe to re-run; every step is guarded by EXISTS / information_schema
-- checks.

BEGIN;

-- 1. opportunities.pipedrive_deal_id: UNIQUE where not null, gated.
DO $$
DECLARE
  opp_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO opp_dupes FROM (
    SELECT 1 FROM opportunities
    WHERE pipedrive_deal_id IS NOT NULL
    GROUP BY pipedrive_deal_id
    HAVING COUNT(*) > 1
  ) t;

  IF opp_dupes = 0 THEN
    -- Safe to promote. Drop the plain index and recreate as UNIQUE.
    DROP INDEX IF EXISTS ix_opportunities_pipedrive_deal_id;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunities_pipedrive_deal_id
      ON opportunities (pipedrive_deal_id)
      WHERE pipedrive_deal_id IS NOT NULL;
    RAISE NOTICE '[pd-data-trust] opportunities.pipedrive_deal_id promoted to UNIQUE partial index';
  ELSE
    RAISE NOTICE '[pd-data-trust] skipped UNIQUE promotion on opportunities.pipedrive_deal_id: % duplicate group(s) exist. Dedup first, then re-run.', opp_dupes;
  END IF;
END $$;

-- 2. clients.pipedrive_org_id: UNIQUE where not null, gated.
DO $$
DECLARE
  client_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO client_dupes FROM (
    SELECT 1 FROM clients
    WHERE pipedrive_org_id IS NOT NULL
    GROUP BY pipedrive_org_id
    HAVING COUNT(*) > 1
  ) t;

  IF client_dupes = 0 THEN
    DROP INDEX IF EXISTS ix_clients_pipedrive_org_id;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_pipedrive_org_id
      ON clients (pipedrive_org_id)
      WHERE pipedrive_org_id IS NOT NULL;
    RAISE NOTICE '[pd-data-trust] clients.pipedrive_org_id promoted to UNIQUE partial index';
  ELSE
    RAISE NOTICE '[pd-data-trust] skipped UNIQUE promotion on clients.pipedrive_org_id: % duplicate group(s) exist. Dedup first, then re-run.', client_dupes;
  END IF;
END $$;

-- 3. pd_tickets.project_id: emit NOTICE of any NULL project_id rows.
--    The API already rejects missing projectId on create. Historical
--    rows or imports may still contain NULLs; log the count so an
--    operator can follow up, but DO NOT NOT-NULL the column here —
--    that would fail the migration on any existing NULL row and we do
--    not yet have a safe repair flow.
DO $$
DECLARE
  null_proj INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_proj FROM pd_tickets WHERE project_id IS NULL;
  RAISE NOTICE '[pd-data-trust] pd_tickets rows with NULL project_id: % (investigate before any NOT NULL promotion)', null_proj;
END $$;

COMMIT;
