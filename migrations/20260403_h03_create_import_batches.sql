-- Migration: 20260403_h03_create_import_batches.sql
-- Phase H.3: Create core.import_batches.
-- Unifies import_runs and smart_import_runs into a single import tracking table.
-- Supports 3 import types: project, commissioning, project_charter.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS core.import_batches (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_import_id      INTEGER,
  legacy_import_table   TEXT NOT NULL,
  import_type           TEXT NOT NULL,
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  uploaded_by_party_id  BIGINT REFERENCES core.parties(id),
  source_file_name      TEXT,
  source_file_hash      TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  records_attempted     INTEGER,
  records_succeeded     INTEGER,
  records_failed        INTEGER,
  import_data           JSONB NOT NULL DEFAULT '{}',
  uploaded_at           TIMESTAMP,
  committed_at          TIMESTAMP,
  committed_by_party_id BIGINT REFERENCES core.parties(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_import_table, legacy_import_id)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_import_type
  ON core.import_batches (import_type);

CREATE INDEX IF NOT EXISTS idx_import_batches_project_instance_id
  ON core.import_batches (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_status
  ON core.import_batches (status);

CREATE INDEX IF NOT EXISTS idx_import_batches_uploaded_by
  ON core.import_batches (uploaded_by_party_id);

COMMENT ON TABLE core.import_batches IS
  'Phase H.3: Unified import tracking. Consolidates import_runs and smart_import_runs. Supports project, commissioning, and project_charter import types.';

COMMIT;
