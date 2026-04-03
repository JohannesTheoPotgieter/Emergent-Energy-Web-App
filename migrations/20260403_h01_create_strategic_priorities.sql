-- Migration: 20260403_h01_create_strategic_priorities.sql
-- Phase H.1: Create core.strategic_priorities + core.strategic_priority_links.
-- Company-wide operational priorities that projects and tasks align to.
-- Many-to-many: one priority → many projects/tasks, one project → many priorities.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.strategic_priorities — company-wide priorities
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.strategic_priorities (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_priority_id    INTEGER UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  department            TEXT,
  horizon               TEXT,
  severity              TEXT,
  status                TEXT NOT NULL DEFAULT 'active',
  priority_rank         INTEGER,
  scope                 TEXT,
  owner_party_id        BIGINT REFERENCES core.parties(id),
  accountable_party_id  BIGINT REFERENCES core.parties(id),
  assigned_party_id     BIGINT REFERENCES core.parties(id),
  parent_id             BIGINT REFERENCES core.strategic_priorities(id),
  fiscal_year           TEXT,
  target_start_date     TEXT,
  target_outcome        TEXT,
  definition_of_done    TEXT,
  due_date              TEXT,
  manual_health         TEXT,
  manual_progress       INTEGER,
  escalated             BOOLEAN NOT NULL DEFAULT false,
  escalated_at          TIMESTAMP,
  escalation_reason     TEXT,
  sort_order            INTEGER DEFAULT 0,
  priority_data         JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategic_priorities_status
  ON core.strategic_priorities (status);

CREATE INDEX IF NOT EXISTS idx_strategic_priorities_department
  ON core.strategic_priorities (department);

CREATE INDEX IF NOT EXISTS idx_strategic_priorities_owner
  ON core.strategic_priorities (owner_party_id);

CREATE INDEX IF NOT EXISTS idx_strategic_priorities_parent
  ON core.strategic_priorities (parent_id);

COMMENT ON TABLE core.strategic_priorities IS
  'Phase H.1: Company-wide operational priorities. Drives alignment across projects and tasks. Backfilled from mytool_company_priorities.';

-- -------------------------------------------------------
-- 2. core.strategic_priority_links — many-to-many junction
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.strategic_priority_links (
  id                      BIGSERIAL PRIMARY KEY,
  strategic_priority_id   BIGINT NOT NULL REFERENCES core.strategic_priorities(id),
  entity_type             TEXT NOT NULL,
  entity_id               BIGINT NOT NULL,
  linked_by_party_id      BIGINT REFERENCES core.parties(id),
  link_data               JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (strategic_priority_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_strategic_priority_links_priority
  ON core.strategic_priority_links (strategic_priority_id);

CREATE INDEX IF NOT EXISTS idx_strategic_priority_links_entity
  ON core.strategic_priority_links (entity_type, entity_id);

COMMENT ON TABLE core.strategic_priority_links IS
  'Phase H.1: Many-to-many junction between strategic priorities and any entity (projects, tasks, etc.). One priority can have multiple projects, one project can serve multiple priorities.';

COMMIT;
