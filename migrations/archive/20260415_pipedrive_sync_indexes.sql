-- Pipedrive sync: performance + observability indexes.
--
-- Context: the Pipedrive sync service matches deals to opportunities
-- by `opportunities.pipedrive_deal_id` and organisations to clients by
-- `clients.pipedrive_org_id`. Both columns were created nullable with
-- no index, which means every deal in a full sync costs a sequential
-- scan on the opportunities / clients tables, and there is no backstop
-- against duplicate rows for the same Pipedrive key.
--
-- This migration:
--   1. Adds plain b-tree indexes (safe in all cases) so matching is
--      no longer O(n) per deal.
--   2. Emits a NOTICE with the current duplicate count for each key.
--      The unique-constraint hardening is intentionally left as a
--      follow-up: creating a unique index here would fail loudly on a
--      DB that already has duplicate rows (the race-recovery code path
--      in pipedrive-sync-service.ts exists precisely because this is
--      possible), and we do not want this migration to be destructive
--      on a live environment. The follow-up migration is tracked in
--      docs/runbooks/pipedrive-integration-review-2026-04-15.md.

BEGIN;

-- Match performance for opportunity lookups during sync.
CREATE INDEX IF NOT EXISTS ix_opportunities_pipedrive_deal_id
  ON opportunities (pipedrive_deal_id)
  WHERE pipedrive_deal_id IS NOT NULL;

-- Match performance for client lookups during sync.
CREATE INDEX IF NOT EXISTS ix_clients_pipedrive_org_id
  ON clients (pipedrive_org_id)
  WHERE pipedrive_org_id IS NOT NULL;

-- Observability: log current duplicate counts so operators know if
-- dedup is required before a future unique-index rollout.
DO $$
DECLARE
  opp_dupes INTEGER;
  client_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO opp_dupes FROM (
    SELECT pipedrive_deal_id
    FROM opportunities
    WHERE pipedrive_deal_id IS NOT NULL
    GROUP BY pipedrive_deal_id
    HAVING COUNT(*) > 1
  ) t;

  SELECT COUNT(*) INTO client_dupes FROM (
    SELECT pipedrive_org_id
    FROM clients
    WHERE pipedrive_org_id IS NOT NULL
    GROUP BY pipedrive_org_id
    HAVING COUNT(*) > 1
  ) t;

  RAISE NOTICE '[pipedrive-sync] duplicate pipedrive_deal_id groups in opportunities: %', opp_dupes;
  RAISE NOTICE '[pipedrive-sync] duplicate pipedrive_org_id groups in clients: %', client_dupes;
END $$;

COMMIT;
