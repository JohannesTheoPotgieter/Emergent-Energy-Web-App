-- Migration: 20260403_e01_create_deliverable_definitions.sql
-- Phase E.1: Create core.deliverable_definitions + core.deliverable_instances.
-- Unifies eng_deliverable_templates, deliverables, project_eng_deliverables,
-- and task_deliverables into a clean two-table model.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.deliverable_definitions — template catalog
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.deliverable_definitions (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_template_id    INTEGER UNIQUE,
  code                  TEXT,
  name                  TEXT NOT NULL,
  description           TEXT,
  applies_to_scope      TEXT NOT NULL DEFAULT 'stage',
  is_required           BOOLEAN NOT NULL DEFAULT true,
  allowed_file_types    TEXT[],
  required_count        INTEGER NOT NULL DEFAULT 1,
  is_ad_hoc             BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliverable_definitions_code
  ON core.deliverable_definitions (code);

CREATE INDEX IF NOT EXISTS idx_deliverable_definitions_scope
  ON core.deliverable_definitions (applies_to_scope);

COMMENT ON TABLE core.deliverable_definitions IS
  'Phase E.1: Template catalog for deliverables. Seeded from eng_deliverable_templates. Supports ad-hoc definitions via is_ad_hoc flag.';

-- -------------------------------------------------------
-- 2. core.deliverable_instances — actual deliverables per project
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.deliverable_instances (
  id                        BIGSERIAL PRIMARY KEY,
  legacy_deliverable_id     INTEGER,
  legacy_deliverable_table  TEXT NOT NULL,
  deliverable_definition_id BIGINT REFERENCES core.deliverable_definitions(id),
  project_instance_id       BIGINT REFERENCES core.project_instances(id),
  phase_definition_id       INTEGER REFERENCES core.phase_definitions(id),
  owner_party_id            BIGINT REFERENCES core.parties(id),
  reviewer_party_id         BIGINT REFERENCES core.parties(id),
  title                     TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending',
  current_version           INTEGER,
  completed_at              TIMESTAMP,
  deliverable_data          JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_deliverable_table, legacy_deliverable_id)
);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_project_instance_id
  ON core.deliverable_instances (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_definition_id
  ON core.deliverable_instances (deliverable_definition_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_status
  ON core.deliverable_instances (status);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_owner_party_id
  ON core.deliverable_instances (owner_party_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_reviewer_party_id
  ON core.deliverable_instances (reviewer_party_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_instances_phase_definition_id
  ON core.deliverable_instances (phase_definition_id);

COMMENT ON TABLE core.deliverable_instances IS
  'Phase E.1: Actual deliverables per project. Backfilled from deliverables, project_eng_deliverables, and task_deliverables. Type-specific data in deliverable_data JSONB.';

COMMIT;
