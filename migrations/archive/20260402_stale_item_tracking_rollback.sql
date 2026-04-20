-- Rollback: 20260402_stale_item_tracking_rollback.sql
-- WARNING: If bridge writes have started populating last_synced_at, dropping these columns
-- destroys the only record of sync timestamps. Only safe pre-bridge-write.
BEGIN;
ALTER TABLE core.projects DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE core.clients DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE documentation.document_approvals DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE documentation.documents DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE finance.cost_lines DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE finance.revenue_lines DROP COLUMN IF EXISTS last_synced_at;

DROP INDEX IF EXISTS internal.idx_sync_watermarks_domain_checked;
DROP TABLE IF EXISTS internal.sync_watermarks;
COMMIT;
