-- Migration: 20260403_create_bridge_sync_failures.sql
-- Creates internal.bridge_sync_failures for tracking failed bridge writes.
-- Reconciliation runner can query this to identify rows needing re-sync.
-- Additive only.
BEGIN;

CREATE SCHEMA IF NOT EXISTS internal;

CREATE TABLE IF NOT EXISTS internal.bridge_sync_failures (
  id              BIGSERIAL PRIMARY KEY,
  domain          TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  error_message   TEXT,
  resolved_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (domain, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_bridge_sync_failures_unresolved
  ON internal.bridge_sync_failures (domain)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE internal.bridge_sync_failures IS
  'Tracks bridge write failures for reconciliation pickup. Rows are inserted on persistent failure and marked resolved_at when successfully re-synced.';

COMMIT;
