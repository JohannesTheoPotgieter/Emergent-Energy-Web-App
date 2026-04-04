-- Migration: 20260403_e04_create_approval_rules_instances.sql
-- Phase E.4: Create core.approval_rules + core.approval_instances.
-- approval_rules: configurable business rules for admin settings.
-- approval_instances: unified approval records from 4 legacy sources.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.approval_rules — configurable business rules
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.approval_rules (
  id                    BIGSERIAL PRIMARY KEY,
  entity_type           TEXT NOT NULL,
  approval_type         TEXT NOT NULL,
  required_role         TEXT,
  is_mandatory          BOOLEAN NOT NULL DEFAULT true,
  escalation_days       INTEGER,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  rule_data             JSONB NOT NULL DEFAULT '{}',
  created_by_party_id   BIGINT REFERENCES core.parties(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_entity_type
  ON core.approval_rules (entity_type);

CREATE INDEX IF NOT EXISTS idx_approval_rules_approval_type
  ON core.approval_rules (approval_type);

CREATE INDEX IF NOT EXISTS idx_approval_rules_active
  ON core.approval_rules (is_active)
  WHERE is_active = true;

COMMENT ON TABLE core.approval_rules IS
  'Phase E.4: Configurable approval business rules. Admin-managed via settings. Defines which actions require approval, from which roles, with escalation thresholds.';

-- -------------------------------------------------------
-- 2. core.approval_instances — actual approval records
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.approval_instances (
  id                      BIGSERIAL PRIMARY KEY,
  legacy_approval_id      INTEGER,
  legacy_approval_table   TEXT NOT NULL,
  approval_rule_id        BIGINT REFERENCES core.approval_rules(id),
  project_instance_id     BIGINT REFERENCES core.project_instances(id),
  entity_type             TEXT NOT NULL,
  entity_id               BIGINT,
  status                  TEXT NOT NULL DEFAULT 'pending',
  title                   TEXT,
  requested_by_party_id   BIGINT REFERENCES core.parties(id),
  decided_by_party_id     BIGINT REFERENCES core.parties(id),
  decision_note           TEXT,
  urgency                 TEXT,
  requested_at            TIMESTAMP,
  decided_at              TIMESTAMP,
  due_date                TIMESTAMP,
  approval_data           JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_approval_table, legacy_approval_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_instances_project_instance_id
  ON core.approval_instances (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_approval_instances_entity_type
  ON core.approval_instances (entity_type);

CREATE INDEX IF NOT EXISTS idx_approval_instances_status
  ON core.approval_instances (status);

CREATE INDEX IF NOT EXISTS idx_approval_instances_rule_id
  ON core.approval_instances (approval_rule_id);

CREATE INDEX IF NOT EXISTS idx_approval_instances_requested_by
  ON core.approval_instances (requested_by_party_id);

CREATE INDEX IF NOT EXISTS idx_approval_instances_decided_by
  ON core.approval_instances (decided_by_party_id);

COMMENT ON TABLE core.approval_instances IS
  'Phase E.4: Unified approval records. Backfilled from approvals, project_eng_approvals, document_approvals, and approval_workflows. Type-specific data in approval_data JSONB.';

COMMIT;
