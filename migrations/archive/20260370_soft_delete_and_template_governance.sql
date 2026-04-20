-- Migration: Soft-delete normalization + Template governance columns
-- Part of: Consolidation & Production Hardening (VSv15)
--
-- This migration:
-- 1. Adds deleted_at / deleted_by columns to 18 tables that currently hard-delete
-- 2. Adds template governance columns to stage_checklist_templates
-- 3. Creates the template_overrides table for project-level template customization
-- 4. Backfills deleted_at for rows where is_active = false on mixed tables

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Add soft-delete columns to tables that currently hard-delete
-- ═══════════════════════════════════════════════════════════════════════════════

-- Governance / Audit-critical
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- Portfolio management
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE portfolio_rollout_plans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE portfolio_rollout_plans ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Lifecycle / Quality / Commissioning
ALTER TABLE commissioning_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE commissioning_items ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE raid_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE raid_items ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Finance / Procurement
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE invoice_captures ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE invoice_captures ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Collaboration
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE feedback_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE feedback_tickets ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Tasks / Work items
ALTER TABLE work_item_dependencies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE work_item_dependencies ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE task_tags ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE task_tags ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Handover
ALTER TABLE handover_stakeholders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE handover_stakeholders ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Access / Permissions
ALTER TABLE project_access ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE project_access ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- Stage lifecycle (already have isActive; add deletedAt as authority)
ALTER TABLE stage_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE stage_definitions ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Template governance columns on stage_checklist_templates
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS is_system_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS edited_by INTEGER;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE stage_checklist_templates ADD COLUMN IF NOT EXISTS edit_reason TEXT;

-- Mark all existing checklist templates as system defaults
UPDATE stage_checklist_templates SET is_system_default = true WHERE is_system_default = false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: Template overrides table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS template_overrides (
  id SERIAL PRIMARY KEY,
  template_type TEXT NOT NULL,                                      -- 'stage_checklist', 'eng_stage', 'qc', 'intake'
  source_template_id INTEGER NOT NULL,                              -- FK to original template
  project_id INTEGER REFERENCES project_info(id),                   -- NULL = org-wide override
  override_data JSONB NOT NULL,                                     -- customized template content
  override_reason TEXT NOT NULL,
  overridden_by INTEGER REFERENCES users(id),
  overridden_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  deleted_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_overrides_type ON template_overrides(template_type);
CREATE INDEX IF NOT EXISTS idx_template_overrides_project ON template_overrides(project_id);
CREATE INDEX IF NOT EXISTS idx_template_overrides_source ON template_overrides(source_template_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: Backfill deleted_at for mixed isActive/deletedAt tables
-- Sets deleted_at = NOW() for any row where is_active = false but deleted_at is NULL
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE stage_definitions SET deleted_at = NOW() WHERE is_active = false AND deleted_at IS NULL;
UPDATE stage_checklist_templates SET deleted_at = NOW() WHERE is_active = false AND deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 5: Gate override trust hardening
-- Backfill overrides without expiry to 90 days from creation
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE stage_gate_overrides
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL AND is_active = true;
