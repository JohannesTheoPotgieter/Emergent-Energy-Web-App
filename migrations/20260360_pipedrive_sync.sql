-- D1: Pipedrive sync log table for audit trail of sync operations

CREATE TABLE IF NOT EXISTS pipedrive_sync_log (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,          -- 'full', 'incremental', 'manual'
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  deals_processed INTEGER DEFAULT 0,
  deals_created INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  errors TEXT,                      -- JSON array of error messages
  status TEXT DEFAULT 'running'     -- 'running', 'completed', 'failed'
);
