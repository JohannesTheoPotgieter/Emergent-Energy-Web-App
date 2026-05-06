-- Rollback for 20260415_pipedrive_sync_indexes.sql

BEGIN;

DROP INDEX IF EXISTS ix_opportunities_pipedrive_deal_id;
DROP INDEX IF EXISTS ix_clients_pipedrive_org_id;

COMMIT;
