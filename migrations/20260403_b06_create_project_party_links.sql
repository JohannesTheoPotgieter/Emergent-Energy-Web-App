-- Migration: 20260403_b06_create_project_party_links.sql
-- Phase B.4: Create core.project_party_links junction table.
-- Replaces inline client_id, pm_user_id, pd_user_id on core.projects
-- and role-assignment user_id columns on project_execution_state.
-- Additive only. No app code changes. Legacy columns remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.project_party_links — junction table
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_party_links (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  party_id              BIGINT NOT NULL REFERENCES core.parties(id),
  project_role          TEXT NOT NULL,
  is_primary            BOOLEAN,
  start_date            DATE,
  end_date              DATE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (project_instance_id, party_id, project_role)
);

-- -------------------------------------------------------
-- 2. Indexes
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_party_links_project_instance_id
  ON core.project_party_links (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_project_party_links_party_id
  ON core.project_party_links (party_id);

CREATE INDEX IF NOT EXISTS idx_project_party_links_project_role
  ON core.project_party_links (project_role);

CREATE INDEX IF NOT EXISTS idx_project_party_links_active
  ON core.project_party_links (project_instance_id, project_role)
  WHERE end_date IS NULL;

-- -------------------------------------------------------
-- 3. Comments
-- -------------------------------------------------------
COMMENT ON TABLE core.project_party_links IS
  'Phase B.4: Junction table linking project_instances to parties with typed roles. Replaces inline client_id, pm_user_id, pd_user_id on core.projects and role user_id columns on project_execution_state.';

COMMIT;
