-- Migration: Add retry tracking columns to internal.bridge_sync_failures
-- Supports the bridge retry queue scheduler introduced alongside bridgeCatch upgrade.
--
-- Also relaxes the UNIQUE constraint to allow multiple failures per domain/entity_id
-- (a single entity can fail multiple times with different errors).
--
-- Rollback: ALTER TABLE internal.bridge_sync_failures DROP COLUMN IF EXISTS retry_count;
--           ALTER TABLE internal.bridge_sync_failures DROP COLUMN IF EXISTS last_retry_at;

BEGIN;

ALTER TABLE internal.bridge_sync_failures
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE internal.bridge_sync_failures
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;

-- Drop the old unique constraint that prevents multiple failure records per entity
-- and replace with a partial unique index on unresolved failures only
DO $$
BEGIN
  -- Drop the named constraint if it exists (Postgres names it automatically)
  ALTER TABLE internal.bridge_sync_failures
    DROP CONSTRAINT IF EXISTS bridge_sync_failures_domain_entity_id_key;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Allow at most one UNRESOLVED failure per domain+entity at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_sync_failures_unique_unresolved
  ON internal.bridge_sync_failures (domain, entity_id)
  WHERE resolved_at IS NULL;

COMMIT;
