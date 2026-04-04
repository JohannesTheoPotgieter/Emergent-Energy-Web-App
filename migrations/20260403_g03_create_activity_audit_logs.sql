-- Migration: 20260403_g03_create_activity_audit_logs.sql
-- Phase G.3: Create core.activity_log + core.audit_log.
-- Separates operational events (day-to-day activity) from compliance events
-- (regulatory/governance audit trail).
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.activity_log — operational events (day-to-day)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.activity_log (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_event_id       INTEGER,
  legacy_event_table    TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT,
  aggregate_id          BIGINT,
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  actor_party_id        BIGINT REFERENCES core.parties(id),
  payload               JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMP,
  UNIQUE (legacy_event_table, legacy_event_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_log_project_instance_id
  ON core.activity_log (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_event_type
  ON core.activity_log (event_type);

CREATE INDEX IF NOT EXISTS idx_activity_log_aggregate
  ON core.activity_log (aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON core.activity_log (actor_party_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
  ON core.activity_log (created_at);

COMMENT ON TABLE core.activity_log IS
  'Phase G.3: Operational activity events (day-to-day). Backfilled from domain_events and deliverable_events. Used for activity feeds, notifications, and operational reporting.';

-- -------------------------------------------------------
-- 2. core.audit_log — compliance events (governance)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.audit_log (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_audit_id       INTEGER,
  legacy_audit_table    TEXT NOT NULL,
  actor_party_id        BIGINT REFERENCES core.parties(id),
  actor_role            TEXT,
  source                TEXT,
  entity_type           TEXT NOT NULL,
  entity_id             TEXT,
  action                TEXT NOT NULL,
  changes               JSONB NOT NULL DEFAULT '{}',
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  correlation_id        TEXT,
  ip_address            TEXT,
  request_path          TEXT,
  request_method        TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_audit_table, legacy_audit_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_project_instance_id
  ON core.audit_log (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON core.audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON core.audit_log (actor_party_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON core.audit_log (action);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON core.audit_log (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id
  ON core.audit_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE core.audit_log IS
  'Phase G.3: Compliance audit trail. Backfilled from audit_events and audit_trail. Preserved long-term for regulatory and governance requirements. Includes before/after change snapshots.';

COMMIT;
