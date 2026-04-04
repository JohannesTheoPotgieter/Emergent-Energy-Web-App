-- Migration: 20260403_b08_create_phase_definitions.sql
-- Phase B.5: Create core.phase_definitions and core.project_phase_history.
-- core.phase_definitions enriches stage_definitions with phase_group and is_gate.
-- core.project_phase_history tracks per-project phase progression.
-- Additive only. No app code changes. Legacy stage_definitions remains untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.phase_definitions — enriched stage reference
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.phase_definitions (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  phase_group         TEXT,
  sequence_order      INTEGER NOT NULL,
  department_owner    TEXT,
  is_gate             BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase_definitions_phase_group
  ON core.phase_definitions (phase_group);

CREATE INDEX IF NOT EXISTS idx_phase_definitions_sequence_order
  ON core.phase_definitions (sequence_order);

COMMENT ON TABLE core.phase_definitions IS
  'Phase B.5: Enriched phase/stage reference table. Sourced from stage_definitions with phase_group and is_gate additions.';

-- -------------------------------------------------------
-- 2. Seed from stage_definitions (10 rows)
-- -------------------------------------------------------
INSERT INTO core.phase_definitions (code, name, phase_group, sequence_order, department_owner, is_gate)
VALUES
  ('S01_FIRST_ASSESSMENT',          'First Assessment',                'project_development', 1,  'PROJECT_DEVELOPER',       false),
  ('S02_DESIGN_COST_PROPOSAL',      'Design & Cost Proposal Build',    'project_development', 2,  'PROJECT_DEVELOPER',       false),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'Signature & Financial Close',     'project_development', 3,  'PROJECT_DEVELOPER',       true),
  ('S04_PD_PM_HANDOVER',            'PD → PM Handover',                'project_development', 4,  'PROJECT_DEVELOPER',       true),
  ('S05_FINANCIAL_REVIEW',          'Financial Review',                'execution',           5,  'PROGRAM_FINANCE_MANAGER', true),
  ('S06_CONSTRUCTION',              'Construction',                    'execution',           6,  'CONSTRUCTION_MANAGER',    false),
  ('S07_COMMISSIONING',             'Commissioning',                   'execution',           7,  'PROJECT_MANAGER_SITE',    true),
  ('S08_OM_HANDOVER',               'O&M Handover',                    'execution',           8,  'PROJECT_MANAGER_SITE',    true),
  ('S09_CLIENT_HANDOVER',           'Client Handover',                 'execution',           9,  'PROJECT_MANAGER_SITE',    true),
  ('S10_POST_HANDOVER_REVIEW',      '3-Month Post-Handover Review',    'closeout',            10, 'KEY_ACCOUNTS_MANAGER',    false)
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------
-- 3. core.project_phase_history — per-project phase tracking
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.project_phase_history (
  id                    BIGSERIAL PRIMARY KEY,
  project_instance_id   BIGINT NOT NULL REFERENCES core.project_instances(id),
  phase_definition_id   INTEGER NOT NULL REFERENCES core.phase_definitions(id),
  entered_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  exited_at             TIMESTAMP,
  is_current            BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_phase_history_project_instance_id
  ON core.project_phase_history (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_project_phase_history_phase_definition_id
  ON core.project_phase_history (phase_definition_id);

CREATE INDEX IF NOT EXISTS idx_project_phase_history_current
  ON core.project_phase_history (project_instance_id, is_current)
  WHERE is_current = true;

COMMENT ON TABLE core.project_phase_history IS
  'Phase B.5: Per-project phase progression history. One row per phase a project enters. is_current=true marks the active phase.';

COMMIT;
