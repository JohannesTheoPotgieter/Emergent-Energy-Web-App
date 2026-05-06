-- ============================================================
-- Backfill: Populate project_execution_state and project_settings
-- from existing project_info data.
-- Run AFTER 20260330_split_project_info.sql
-- ============================================================

-- 1. Backfill project_execution_state
INSERT INTO project_execution_state (
  project_id,
  phase, phase_updated_at, phase_updated_by_user_id, phase_notes,
  pd_handover_date, construction_start_date, commissioning_date,
  om_handover_date, client_handover_date,
  construction_start_actual, pd_handover_actual,
  commissioning_actual, client_handover_actual,
  escalation_level,
  rag_status, rag_comment, rag_updated_at, rag_updated_by_user_id,
  is_active, archived_status,
  execution_enabled, execution_gate_status, execution_gate_reason, execution_phase,
  signed_status, signed_date, signed_document_link,
  cp_signed, cp_signed_date, cp_signed_by_user_id, cp_evidence_type, cp_evidence_ref,
  pm_task_pack_created, eng_post_cp_task_pack_created
)
SELECT
  id,
  phase, phase_updated_at, phase_updated_by_user_id, phase_notes,
  pd_handover_date, construction_start_date, commissioning_date,
  om_handover_date, client_handover_date,
  construction_start_actual, pd_handover_actual,
  commissioning_actual, client_handover_actual,
  escalation_level,
  rag_status, rag_comment, rag_updated_at, rag_updated_by_user_id,
  is_active, archived_status,
  execution_enabled, execution_gate_status, execution_gate_reason, execution_phase,
  signed_status, signed_date, signed_document_link,
  cp_signed, cp_signed_date, cp_signed_by_user_id, cp_evidence_type, cp_evidence_ref,
  pm_task_pack_created, eng_post_cp_task_pack_created
FROM project_info
ON CONFLICT (project_id) DO NOTHING;

-- 2. Backfill project_settings
INSERT INTO project_settings (
  project_id,
  excel_tracker_link
)
SELECT
  id,
  excel_tracker_link
FROM project_info
ON CONFLICT (project_id) DO NOTHING;

-- 3. Validation queries
-- All three counts must match:
SELECT 'project_info' AS tbl, COUNT(*) AS cnt FROM project_info
UNION ALL
SELECT 'project_execution_state', COUNT(*) FROM project_execution_state
UNION ALL
SELECT 'project_settings', COUNT(*) FROM project_settings;

-- Spot-check: verify a few columns match
SELECT
  pi.id,
  pi.rag_status = pes.rag_status AS rag_match,
  pi.phase = pes.phase AS phase_match,
  pi.is_active = pes.is_active AS active_match,
  pi.excel_tracker_link = ps.excel_tracker_link AS link_match
FROM project_info pi
JOIN project_execution_state pes ON pes.project_id = pi.id
JOIN project_settings ps ON ps.project_id = pi.id
LIMIT 10;
