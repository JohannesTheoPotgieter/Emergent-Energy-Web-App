-- ============================================================
-- Migration: Drop duplicated MOVED columns from project_info
-- Date: 2026-03-20
-- Purpose: Now that all reads have been repointed to
--          project_execution_state / project_settings, remove
--          the redundant columns from project_info.
-- Prereq:  All server-side queries must read MOVED columns
--          from project_execution_state, NOT project_info.
--          The dual-write (syncProjectSplitTables) has been
--          keeping both copies in sync since Prompt 7.
-- ============================================================

-- Safety: wrap in a transaction
BEGIN;

-- ===================== MOVED to project_execution_state =====================

ALTER TABLE project_info DROP COLUMN IF EXISTS phase;
ALTER TABLE project_info DROP COLUMN IF EXISTS phase_updated_at;
ALTER TABLE project_info DROP COLUMN IF EXISTS phase_updated_by_user_id;
ALTER TABLE project_info DROP COLUMN IF EXISTS phase_notes;
ALTER TABLE project_info DROP COLUMN IF EXISTS pd_handover_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS construction_start_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS commissioning_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS om_handover_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS client_handover_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS escalation_level;
ALTER TABLE project_info DROP COLUMN IF EXISTS construction_start_actual;
ALTER TABLE project_info DROP COLUMN IF EXISTS pd_handover_actual;
ALTER TABLE project_info DROP COLUMN IF EXISTS commissioning_actual;
ALTER TABLE project_info DROP COLUMN IF EXISTS client_handover_actual;
ALTER TABLE project_info DROP COLUMN IF EXISTS rag_status;
ALTER TABLE project_info DROP COLUMN IF EXISTS rag_comment;
ALTER TABLE project_info DROP COLUMN IF EXISTS rag_updated_at;
ALTER TABLE project_info DROP COLUMN IF EXISTS rag_updated_by_user_id;
ALTER TABLE project_info DROP COLUMN IF EXISTS is_active;
ALTER TABLE project_info DROP COLUMN IF EXISTS execution_enabled;
ALTER TABLE project_info DROP COLUMN IF EXISTS execution_gate_status;
ALTER TABLE project_info DROP COLUMN IF EXISTS execution_gate_reason;
ALTER TABLE project_info DROP COLUMN IF EXISTS signed_status;
ALTER TABLE project_info DROP COLUMN IF EXISTS signed_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS signed_document_link;
ALTER TABLE project_info DROP COLUMN IF EXISTS execution_phase;
ALTER TABLE project_info DROP COLUMN IF EXISTS archived_status;
ALTER TABLE project_info DROP COLUMN IF EXISTS cp_signed;
ALTER TABLE project_info DROP COLUMN IF EXISTS cp_signed_date;
ALTER TABLE project_info DROP COLUMN IF EXISTS cp_signed_by_user_id;
ALTER TABLE project_info DROP COLUMN IF EXISTS cp_evidence_type;
ALTER TABLE project_info DROP COLUMN IF EXISTS cp_evidence_ref;
ALTER TABLE project_info DROP COLUMN IF EXISTS pm_task_pack_created;
ALTER TABLE project_info DROP COLUMN IF EXISTS eng_post_cp_task_pack_created;

-- ===================== MOVED to project_settings =====================

ALTER TABLE project_info DROP COLUMN IF EXISTS excel_tracker_link;

COMMIT;
