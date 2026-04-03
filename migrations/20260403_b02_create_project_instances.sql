-- Migration: 20260403_b02_create_project_instances.sql
-- Phase B.2: Create core.project_instances — the narrow project spine.
-- Contains only identity, status, and key FK columns.
-- User assignments (pm, pd) are NOT on this table — they go to project_party_links (B.4).
-- Additive only. No app code changes. core.projects remains untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS core.project_instances (
  id                  BIGSERIAL PRIMARY KEY,
  legacy_project_id   INTEGER UNIQUE NOT NULL,
  project_code        TEXT,
  project_name        TEXT NOT NULL,
  project_type_id     INTEGER REFERENCES core.project_types(id),
  client_party_id     BIGINT REFERENCES core.parties(id),
  status              TEXT NOT NULL DEFAULT 'active',
  current_phase       TEXT,
  planned_start_date  DATE,
  planned_end_date    DATE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_instances_project_code
  ON core.project_instances (project_code);

CREATE INDEX IF NOT EXISTS idx_project_instances_project_type_id
  ON core.project_instances (project_type_id);

CREATE INDEX IF NOT EXISTS idx_project_instances_client_party_id
  ON core.project_instances (client_party_id);

CREATE INDEX IF NOT EXISTS idx_project_instances_status
  ON core.project_instances (status);

CREATE INDEX IF NOT EXISTS idx_project_instances_current_phase
  ON core.project_instances (current_phase);

COMMENT ON TABLE core.project_instances IS
  'Phase B.2: narrow project spine. Identity + status + key FKs only. No user assignments (see project_party_links). core.projects remains as compatibility layer.';

COMMIT;
