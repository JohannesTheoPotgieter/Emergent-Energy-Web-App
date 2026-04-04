-- Migration: 20260403_d01_create_governed_processes.sql
-- Phase D.1: Create core.governed_processes + core.governed_process_checklist_items.
-- Unifies 6 scattered governance systems into a single model:
--   pd_to_pm_handover, financial_review, phase_gate_review,
--   gate_exception, change_request, payment_batch.
-- Type-specific data stored in process_data JSONB.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

-- -------------------------------------------------------
-- 1. core.governed_processes — unified governance spine
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.governed_processes (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_entity_id      INTEGER,
  legacy_entity_table   TEXT NOT NULL,
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  process_type          TEXT NOT NULL,
  phase_definition_id   INTEGER REFERENCES core.phase_definitions(id),
  status                TEXT NOT NULL DEFAULT 'draft',
  owner_party_id        BIGINT REFERENCES core.parties(id),
  reviewer_party_id     BIGINT REFERENCES core.parties(id),
  title                 TEXT,
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  process_data          JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_entity_table, legacy_entity_id)
);

-- -------------------------------------------------------
-- 2. Indexes on governed_processes
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_governed_processes_project_instance_id
  ON core.governed_processes (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_governed_processes_process_type
  ON core.governed_processes (process_type);

CREATE INDEX IF NOT EXISTS idx_governed_processes_status
  ON core.governed_processes (status);

CREATE INDEX IF NOT EXISTS idx_governed_processes_phase_definition_id
  ON core.governed_processes (phase_definition_id);

CREATE INDEX IF NOT EXISTS idx_governed_processes_owner_party_id
  ON core.governed_processes (owner_party_id);

CREATE INDEX IF NOT EXISTS idx_governed_processes_reviewer_party_id
  ON core.governed_processes (reviewer_party_id);

COMMENT ON TABLE core.governed_processes IS
  'Phase D.1: Unified governance spine. Consolidates handovers, financial reviews, gate evaluations, gate exceptions, change requests, and payment batches. Type-specific data in process_data JSONB.';

-- -------------------------------------------------------
-- 3. core.governed_process_checklist_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.governed_process_checklist_items (
  id                    BIGSERIAL PRIMARY KEY,
  governed_process_id   BIGINT NOT NULL REFERENCES core.governed_processes(id),
  legacy_item_id        INTEGER,
  legacy_item_table     TEXT,
  item_code             TEXT,
  title                 TEXT NOT NULL,
  category              TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  blocks_gate           BOOLEAN DEFAULT false,
  owner_party_id        BIGINT REFERENCES core.parties(id),
  completed_at          TIMESTAMP,
  evidence_url          TEXT,
  notes                 TEXT,
  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- 4. Indexes on checklist_items
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_gp_checklist_governed_process_id
  ON core.governed_process_checklist_items (governed_process_id);

CREATE INDEX IF NOT EXISTS idx_gp_checklist_status
  ON core.governed_process_checklist_items (status);

CREATE INDEX IF NOT EXISTS idx_gp_checklist_blocks_gate
  ON core.governed_process_checklist_items (governed_process_id)
  WHERE blocks_gate = true;

CREATE INDEX IF NOT EXISTS idx_gp_checklist_owner_party_id
  ON core.governed_process_checklist_items (owner_party_id);

COMMENT ON TABLE core.governed_process_checklist_items IS
  'Phase D.1: Unified checklist items across all governed process types. Sources include handover_checklist_items and project_stage_requirements.';

COMMIT;
