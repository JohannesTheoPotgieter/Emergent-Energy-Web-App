-- Rollback for 20260415_pd_data_trust_uniques.sql
--
-- Reverts the UNIQUE partial indexes to plain btree partial indexes
-- so the rollback state matches the baseline shipped by
-- 20260415_pipedrive_sync_indexes.sql.

BEGIN;

DROP INDEX IF EXISTS uq_opportunities_pipedrive_deal_id;
CREATE INDEX IF NOT EXISTS ix_opportunities_pipedrive_deal_id
  ON opportunities (pipedrive_deal_id)
  WHERE pipedrive_deal_id IS NOT NULL;

DROP INDEX IF EXISTS uq_clients_pipedrive_org_id;
CREATE INDEX IF NOT EXISTS ix_clients_pipedrive_org_id
  ON clients (pipedrive_org_id)
  WHERE pipedrive_org_id IS NOT NULL;

COMMIT;
