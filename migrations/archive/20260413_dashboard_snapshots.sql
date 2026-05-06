-- C2 — Dashboard snapshot cache
--
-- Materialized cache of dashboard payloads so the read path is a
-- single row lookup instead of a multi-table aggregate. A scheduled
-- refresh job overwrites the latest snapshot; the read API serves it
-- with a freshness indicator.
--
-- Rollback: 20260413_dashboard_snapshots_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id                serial PRIMARY KEY,
  dashboard_key     text NOT NULL,
  scope_key         text NOT NULL DEFAULT 'global',
  payload_json      jsonb,
  status            text NOT NULL DEFAULT 'ok',
  error_detail      text,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at   timestamptz,
  compute_ms        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_dashboard_snapshots_status
    CHECK (status IN ('ok', 'failed'))
);

-- One active row per (dashboard, scope).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_snapshots_key
  ON dashboard_snapshots(dashboard_key, scope_key);

-- Freshness panel reads: sort by computed_at desc per dashboard key.
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_key_computed
  ON dashboard_snapshots(dashboard_key, computed_at DESC);

COMMENT ON TABLE dashboard_snapshots IS
  'C2: Materialized dashboard cache. Overwritten on every refresh — one row per (dashboard_key, scope_key).';
COMMENT ON COLUMN dashboard_snapshots.scope_key IS
  'Narrower scope like user:42 or project:17. Use "global" for org-wide dashboards.';
COMMENT ON COLUMN dashboard_snapshots.last_success_at IS
  'C2: timestamp of the most recent SUCCESSFUL refresh. Drives the freshness indicator.';

COMMIT;
