-- C1 — Integration health registry
--
-- Adds a central connector registry + per-run audit log so the
-- "integration health" dashboard can render a tile per integration
-- with a derived healthy / stale / failing / unknown status.
--
-- Read-only for C1. C3 will wire alerting on status transitions
-- (healthy -> failing) to the notification engine.
--
-- Rollback: 20260413_integrations_registry_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS integrations (
  id                     serial PRIMARY KEY,
  name                   text NOT NULL UNIQUE,
  display_name           text NOT NULL,
  description            text,
  auth_type              text NOT NULL DEFAULT 'api_key',
  owner_process          text,
  fallback_description   text,
  alert_target           text,
  metadata               jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT chk_integrations_auth_type
    CHECK (auth_type IN ('api_key', 'oauth2', 'basic', 'none'))
);

CREATE INDEX IF NOT EXISTS idx_integrations_name_active
  ON integrations(name)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE integrations IS
  'C1: Connector registry. One row per external integration. Source of truth for the integration health dashboard.';
COMMENT ON COLUMN integrations.name IS
  'Machine key (e.g. pipedrive, microsoft_365, clickup). Unique.';
COMMENT ON COLUMN integrations.alert_target IS
  'Role or team notified when this integration transitions to failing. Wired in C3.';

CREATE TABLE IF NOT EXISTS integration_run_events (
  id                   serial PRIMARY KEY,
  integration_id       integer NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  run_type             text,
  started_at           timestamptz NOT NULL,
  finished_at          timestamptz,
  status               text NOT NULL,
  records_processed    integer,
  error_code           text,
  error_detail         text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_integration_run_events_status
    CHECK (status IN ('success', 'failure', 'partial'))
);

-- Hot path: latest event per integration (reverse chron).
CREATE INDEX IF NOT EXISTS idx_integration_run_events_int_started
  ON integration_run_events(integration_id, started_at DESC);

-- Hot path: latest success per integration (for healthy/stale derivation).
CREATE INDEX IF NOT EXISTS idx_integration_run_events_int_success
  ON integration_run_events(integration_id, started_at DESC)
  WHERE status = 'success';

COMMENT ON TABLE integration_run_events IS
  'C1: Per-run audit log for every integration. Used to derive health status (healthy / stale / failing / unknown).';

COMMIT;
