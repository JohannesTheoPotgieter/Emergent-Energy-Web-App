-- Migration: 20260402_stale_item_tracking.sql
-- Phase 1B Blocker 6: Add last_synced_at columns and internal.sync_watermarks table
BEGIN;

-- Add sync watermark columns to all promoted tables that will receive bridge writes
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE documentation.document_approvals ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE documentation.documents ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

-- Create a sync watermark log for aggregate lag tracking
CREATE TABLE IF NOT EXISTS internal.sync_watermarks (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  last_legacy_write_at TIMESTAMP,
  last_promoted_sync_at TIMESTAMP,
  lag_seconds NUMERIC(10,2),
  stale_row_count INTEGER DEFAULT 0,
  checked_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_watermarks_domain_checked
  ON internal.sync_watermarks (domain, checked_at DESC);

COMMENT ON TABLE internal.sync_watermarks IS 'Tracks replication lag between legacy and promoted tables. Populated by reconciliation checks, not by bridge writes directly.';
COMMENT ON COLUMN internal.sync_watermarks.lag_seconds IS 'NULL means no bridge writes active yet; 0 means fully caught up.';

COMMIT;
