-- Migration: 20260403_c01_create_work_packages.sql
-- Phase C.1: Create core.work_packages — groups work items by project + workstream.
-- Derived from unique (project_id, workstream) combinations on work_items.
-- Personal tasks (no project_id) are excluded.
-- Additive only. No app code changes. Existing work_items remains untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.work_packages
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.work_packages (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  phase_definition_id   INTEGER REFERENCES core.phase_definitions(id),
  workstream            TEXT NOT NULL,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  owner_party_id        BIGINT REFERENCES core.parties(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_instance_id, workstream)
);

-- -------------------------------------------------------
-- 2. Indexes
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_packages_project_instance_id
  ON core.work_packages (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_work_packages_workstream
  ON core.work_packages (workstream);

CREATE INDEX IF NOT EXISTS idx_work_packages_phase_definition_id
  ON core.work_packages (phase_definition_id);

CREATE INDEX IF NOT EXISTS idx_work_packages_owner_party_id
  ON core.work_packages (owner_party_id);

CREATE INDEX IF NOT EXISTS idx_work_packages_status
  ON core.work_packages (status);

COMMENT ON TABLE core.work_packages IS
  'Phase C.1: Groups work items by project + workstream. One row per unique (project_instance_id, workstream). Personal tasks excluded.';

COMMIT;
