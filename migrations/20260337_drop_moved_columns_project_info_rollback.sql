-- ============================================================
-- Rollback: Re-add duplicated columns to project_info
-- Date: 2026-03-20
-- Purpose: Reverse the column drop migration. After re-adding
--          columns, run the backfill to copy data back from
--          project_execution_state / project_settings.
-- ============================================================

BEGIN;

-- ===================== Restore execution-state columns =====================

ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMPTZ;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_updated_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS phase_notes TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pd_handover_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS construction_start_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS commissioning_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS om_handover_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_handover_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS escalation_level TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS construction_start_actual TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pd_handover_actual TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS commissioning_actual TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS client_handover_actual TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_status TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_comment TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_updated_at TIMESTAMPTZ;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_updated_by_user_id INTEGER;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE';
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_gate_reason TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_status TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS signed_document_link TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS execution_phase TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS archived_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_type TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_ref TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_task_pack_created BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS eng_post_cp_task_pack_created BOOLEAN NOT NULL DEFAULT false;

-- ===================== Restore settings column =====================

ALTER TABLE project_info ADD COLUMN IF NOT EXISTS excel_tracker_link TEXT;

-- ===================== Backfill from split tables =====================

UPDATE project_info pi SET
  phase = pes.phase,
  phase_updated_at = pes.phase_updated_at,
  phase_updated_by_user_id = pes.phase_updated_by_user_id,
  phase_notes = pes.phase_notes,
  pd_handover_date = pes.pd_handover_date,
  construction_start_date = pes.construction_start_date,
  commissioning_date = pes.commissioning_date,
  om_handover_date = pes.om_handover_date,
  client_handover_date = pes.client_handover_date,
  escalation_level = pes.escalation_level,
  construction_start_actual = pes.construction_start_actual,
  pd_handover_actual = pes.pd_handover_actual,
  commissioning_actual = pes.commissioning_actual,
  client_handover_actual = pes.client_handover_actual,
  rag_status = pes.rag_status,
  rag_comment = pes.rag_comment,
  rag_updated_at = pes.rag_updated_at,
  rag_updated_by_user_id = pes.rag_updated_by_user_id,
  is_active = pes.is_active,
  execution_enabled = pes.execution_enabled,
  execution_gate_status = pes.execution_gate_status,
  execution_gate_reason = pes.execution_gate_reason,
  signed_status = pes.signed_status,
  signed_date = pes.signed_date,
  signed_document_link = pes.signed_document_link,
  execution_phase = pes.execution_phase,
  archived_status = pes.archived_status,
  cp_signed = pes.cp_signed,
  cp_signed_date = pes.cp_signed_date,
  cp_signed_by_user_id = pes.cp_signed_by_user_id,
  cp_evidence_type = pes.cp_evidence_type,
  cp_evidence_ref = pes.cp_evidence_ref,
  pm_task_pack_created = pes.pm_task_pack_created,
  eng_post_cp_task_pack_created = pes.eng_post_cp_task_pack_created
FROM project_execution_state pes
WHERE pes.project_id = pi.id;

UPDATE project_info pi SET
  excel_tracker_link = ps.excel_tracker_link
FROM project_settings ps
WHERE ps.project_id = pi.id;

COMMIT;
