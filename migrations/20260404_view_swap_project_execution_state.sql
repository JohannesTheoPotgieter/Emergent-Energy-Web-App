-- View-swap: public.project_execution_state → core.projects + core.project_state_history
--
-- Converts the legacy project_execution_state table into a view backed by core.projects.
-- All existing INSERT/UPDATE/DELETE statements continue to work transparently
-- via INSTEAD OF triggers — zero application code changes required.
--
-- Design decisions:
--   - project_execution_state.id (its own serial PK) is preserved via a new
--     legacy_execution_state_id column on core.projects
--   - project_execution_state.project_id maps to core.projects.id
--   - UPDATE triggers also create a snapshot in core.project_state_history
--     (matching the existing syncProjectExecutionState() + snapshotProjectState() behavior)
--   - DELETE is soft-delete (sets deleted_at on core.projects)
--
-- Rollback: see 20260404_view_swap_project_execution_state_rollback.sql

BEGIN;

-- ============================================================================
-- 1. Add legacy_execution_state_id to core.projects for PK mapping
-- ============================================================================

ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS legacy_execution_state_id INTEGER UNIQUE;

-- ============================================================================
-- 2. Backfill legacy_execution_state_id from current data
-- ============================================================================

UPDATE core.projects p SET
  legacy_execution_state_id = pes.id
FROM public.project_execution_state pes
WHERE p.id = pes.project_id
  AND pes.deleted_at IS NULL
  AND p.legacy_execution_state_id IS NULL;

-- ============================================================================
-- 3. Backfill any execution state columns not yet synced to core.projects
-- ============================================================================

UPDATE core.projects p SET
  phase_updated_at = COALESCE(p.phase_updated_at, pes.phase_updated_at),
  phase_updated_by_user_id = COALESCE(p.phase_updated_by_user_id, pes.phase_updated_by_user_id),
  phase_notes = COALESCE(p.phase_notes, pes.phase_notes),
  pd_handover_date = COALESCE(p.pd_handover_date, pes.pd_handover_date),
  construction_start_date = COALESCE(p.construction_start_date, pes.construction_start_date),
  commissioning_date = COALESCE(p.commissioning_date, pes.commissioning_date),
  om_handover_date = COALESCE(p.om_handover_date, pes.om_handover_date),
  client_handover_date = COALESCE(p.client_handover_date, pes.client_handover_date),
  construction_start_actual = COALESCE(p.construction_start_actual, pes.construction_start_actual),
  pd_handover_actual = COALESCE(p.pd_handover_actual, pes.pd_handover_actual),
  commissioning_actual = COALESCE(p.commissioning_actual, pes.commissioning_actual),
  client_handover_actual = COALESCE(p.client_handover_actual, pes.client_handover_actual),
  escalation_level = COALESCE(p.escalation_level, pes.escalation_level),
  rag_updated_at = COALESCE(p.rag_updated_at, pes.rag_updated_at),
  rag_updated_by_user_id = COALESCE(p.rag_updated_by_user_id, pes.rag_updated_by_user_id),
  construction_manager_user_id = COALESCE(p.construction_manager_user_id, pes.construction_manager_user_id),
  quality_lead_user_id = COALESCE(p.quality_lead_user_id, pes.quality_lead_user_id),
  engineering_lead_user_id = COALESCE(p.engineering_lead_user_id, pes.engineering_lead_user_id),
  program_manager_user_id = COALESCE(p.program_manager_user_id, pes.program_manager_user_id),
  project_finance_user_id = COALESCE(p.project_finance_user_id, pes.project_finance_user_id),
  matriarch_handover_target = COALESCE(p.matriarch_handover_target, pes.matriarch_handover_target),
  practical_completion_target = COALESCE(p.practical_completion_target, pes.practical_completion_target),
  practical_completion_actual = COALESCE(p.practical_completion_actual, pes.practical_completion_actual),
  cost_baseline = COALESCE(p.cost_baseline, pes.cost_baseline),
  margin_baseline = COALESCE(p.margin_baseline, pes.margin_baseline),
  waiting_on_department = COALESCE(p.waiting_on_department, pes.waiting_on_department),
  waiting_on_user_id = COALESCE(p.waiting_on_user_id, pes.waiting_on_user_id),
  next_required_action = COALESCE(p.next_required_action, pes.next_required_action),
  stage_owner_user_id = COALESCE(p.stage_owner_user_id, pes.stage_owner_user_id),
  stage_approver_user_id = COALESCE(p.stage_approver_user_id, pes.stage_approver_user_id),
  kam_user_id = COALESCE(p.kam_user_id, pes.kam_user_id),
  site_establishment_date = COALESCE(p.site_establishment_date, pes.site_establishment_date),
  site_establishment_actual = COALESCE(p.site_establishment_actual, pes.site_establishment_actual),
  financial_review_status = COALESCE(p.financial_review_status, pes.financial_review_status),
  financial_review_id = COALESCE(p.financial_review_id, pes.financial_review_id)
FROM public.project_execution_state pes
WHERE p.id = pes.project_id
  AND pes.deleted_at IS NULL;

-- ============================================================================
-- 4. Rename legacy table
-- ============================================================================

ALTER TABLE public.project_execution_state RENAME TO _project_execution_state_legacy;

-- ============================================================================
-- 5. Create view with legacy column names
-- ============================================================================

CREATE OR REPLACE VIEW public.project_execution_state AS
SELECT
  p.legacy_execution_state_id AS id,
  p.id AS project_id,
  p.phase,
  p.phase_updated_at,
  p.phase_updated_by_user_id,
  p.phase_notes,
  p.pd_handover_date,
  p.construction_start_date,
  p.commissioning_date,
  p.om_handover_date,
  p.client_handover_date,
  p.construction_start_actual,
  p.pd_handover_actual,
  p.commissioning_actual,
  p.client_handover_actual,
  p.escalation_level,
  p.rag_status,
  p.rag_comment,
  p.rag_updated_at,
  p.rag_updated_by_user_id,
  p.is_active,
  p.deleted_at,
  p.archived_status,
  p.execution_enabled,
  p.execution_gate_status,
  p.execution_gate_reason,
  p.execution_phase,
  p.signed_status,
  p.signed_date,
  p.signed_document_link,
  p.cp_signed,
  p.cp_signed_date,
  p.cp_signed_by_user_id,
  p.cp_evidence_type,
  p.cp_evidence_ref,
  p.pm_task_pack_created,
  p.eng_post_cp_task_pack_created,
  p.construction_manager_user_id,
  p.quality_lead_user_id,
  p.engineering_lead_user_id,
  p.program_manager_user_id,
  p.project_finance_user_id,
  p.matriarch_handover_target,
  p.practical_completion_target,
  p.practical_completion_actual,
  p.cost_baseline,
  p.margin_baseline,
  p.current_stage_code,
  p.gate_status,
  p.gate_readiness_pct,
  p.waiting_on_department,
  p.waiting_on_user_id,
  p.next_required_action,
  p.stage_owner_user_id,
  p.stage_approver_user_id,
  p.kam_user_id,
  p.site_establishment_date,
  p.site_establishment_actual,
  p.financial_review_status,
  p.financial_review_id,
  p.created_at,
  p.updated_at
FROM core.projects p
WHERE p.legacy_execution_state_id IS NOT NULL;

-- ============================================================================
-- 6. INSTEAD OF triggers
-- ============================================================================

-- INSERT: Create or update core.projects execution state columns + snapshot
CREATE OR REPLACE FUNCTION public._pes_view_insert() RETURNS trigger AS $$
BEGIN
  -- Update core.projects with execution state columns
  UPDATE core.projects SET
    legacy_execution_state_id = COALESCE(NEW.id, legacy_execution_state_id),
    phase = COALESCE(NEW.phase, phase),
    phase_updated_at = COALESCE(NEW.phase_updated_at, phase_updated_at),
    phase_updated_by_user_id = COALESCE(NEW.phase_updated_by_user_id, phase_updated_by_user_id),
    phase_notes = COALESCE(NEW.phase_notes, phase_notes),
    pd_handover_date = COALESCE(NEW.pd_handover_date, pd_handover_date),
    construction_start_date = COALESCE(NEW.construction_start_date, construction_start_date),
    commissioning_date = COALESCE(NEW.commissioning_date, commissioning_date),
    om_handover_date = COALESCE(NEW.om_handover_date, om_handover_date),
    client_handover_date = COALESCE(NEW.client_handover_date, client_handover_date),
    construction_start_actual = COALESCE(NEW.construction_start_actual, construction_start_actual),
    pd_handover_actual = COALESCE(NEW.pd_handover_actual, pd_handover_actual),
    commissioning_actual = COALESCE(NEW.commissioning_actual, commissioning_actual),
    client_handover_actual = COALESCE(NEW.client_handover_actual, client_handover_actual),
    escalation_level = COALESCE(NEW.escalation_level, escalation_level),
    rag_status = COALESCE(NEW.rag_status, rag_status),
    rag_comment = COALESCE(NEW.rag_comment, rag_comment),
    rag_updated_at = COALESCE(NEW.rag_updated_at, rag_updated_at),
    rag_updated_by_user_id = COALESCE(NEW.rag_updated_by_user_id, rag_updated_by_user_id),
    is_active = COALESCE(NEW.is_active, is_active),
    deleted_at = NEW.deleted_at,
    archived_status = COALESCE(NEW.archived_status, archived_status),
    execution_enabled = COALESCE(NEW.execution_enabled, execution_enabled),
    execution_gate_status = COALESCE(NEW.execution_gate_status, execution_gate_status),
    execution_gate_reason = NEW.execution_gate_reason,
    execution_phase = COALESCE(NEW.execution_phase, execution_phase),
    signed_status = COALESCE(NEW.signed_status, signed_status),
    signed_date = COALESCE(NEW.signed_date, signed_date),
    signed_document_link = COALESCE(NEW.signed_document_link, signed_document_link),
    cp_signed = COALESCE(NEW.cp_signed, cp_signed),
    cp_signed_date = COALESCE(NEW.cp_signed_date, cp_signed_date),
    cp_signed_by_user_id = COALESCE(NEW.cp_signed_by_user_id, cp_signed_by_user_id),
    cp_evidence_type = COALESCE(NEW.cp_evidence_type, cp_evidence_type),
    cp_evidence_ref = COALESCE(NEW.cp_evidence_ref, cp_evidence_ref),
    pm_task_pack_created = COALESCE(NEW.pm_task_pack_created, pm_task_pack_created),
    eng_post_cp_task_pack_created = COALESCE(NEW.eng_post_cp_task_pack_created, eng_post_cp_task_pack_created),
    construction_manager_user_id = COALESCE(NEW.construction_manager_user_id, construction_manager_user_id),
    quality_lead_user_id = COALESCE(NEW.quality_lead_user_id, quality_lead_user_id),
    engineering_lead_user_id = COALESCE(NEW.engineering_lead_user_id, engineering_lead_user_id),
    program_manager_user_id = COALESCE(NEW.program_manager_user_id, program_manager_user_id),
    project_finance_user_id = COALESCE(NEW.project_finance_user_id, project_finance_user_id),
    matriarch_handover_target = COALESCE(NEW.matriarch_handover_target, matriarch_handover_target),
    practical_completion_target = COALESCE(NEW.practical_completion_target, practical_completion_target),
    practical_completion_actual = COALESCE(NEW.practical_completion_actual, practical_completion_actual),
    cost_baseline = COALESCE(NEW.cost_baseline, cost_baseline),
    margin_baseline = COALESCE(NEW.margin_baseline, margin_baseline),
    current_stage_code = COALESCE(NEW.current_stage_code, current_stage_code),
    gate_status = COALESCE(NEW.gate_status, gate_status),
    gate_readiness_pct = COALESCE(NEW.gate_readiness_pct, gate_readiness_pct),
    waiting_on_department = COALESCE(NEW.waiting_on_department, waiting_on_department),
    waiting_on_user_id = COALESCE(NEW.waiting_on_user_id, waiting_on_user_id),
    next_required_action = COALESCE(NEW.next_required_action, next_required_action),
    stage_owner_user_id = COALESCE(NEW.stage_owner_user_id, stage_owner_user_id),
    stage_approver_user_id = COALESCE(NEW.stage_approver_user_id, stage_approver_user_id),
    kam_user_id = COALESCE(NEW.kam_user_id, kam_user_id),
    site_establishment_date = COALESCE(NEW.site_establishment_date, site_establishment_date),
    site_establishment_actual = COALESCE(NEW.site_establishment_actual, site_establishment_actual),
    financial_review_status = COALESCE(NEW.financial_review_status, financial_review_status),
    financial_review_id = COALESCE(NEW.financial_review_id, financial_review_id),
    last_synced_at = NOW(),
    updated_at = NOW()
  WHERE id = NEW.project_id;

  -- Also maintain legacy table for rollback safety
  INSERT INTO public._project_execution_state_legacy VALUES (NEW.*)
  ON CONFLICT (project_id) DO UPDATE SET
    phase = EXCLUDED.phase,
    rag_status = EXCLUDED.rag_status,
    rag_comment = EXCLUDED.rag_comment,
    execution_gate_status = EXCLUDED.execution_gate_status,
    execution_gate_reason = EXCLUDED.execution_gate_reason,
    is_active = EXCLUDED.is_active,
    deleted_at = EXCLUDED.deleted_at,
    archived_status = EXCLUDED.archived_status,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UPDATE: Update core.projects + create state history snapshot
CREATE OR REPLACE FUNCTION public._pes_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE core.projects SET
    phase = NEW.phase,
    phase_updated_at = NEW.phase_updated_at,
    phase_updated_by_user_id = NEW.phase_updated_by_user_id,
    phase_notes = NEW.phase_notes,
    pd_handover_date = NEW.pd_handover_date,
    construction_start_date = NEW.construction_start_date,
    commissioning_date = NEW.commissioning_date,
    om_handover_date = NEW.om_handover_date,
    client_handover_date = NEW.client_handover_date,
    construction_start_actual = NEW.construction_start_actual,
    pd_handover_actual = NEW.pd_handover_actual,
    commissioning_actual = NEW.commissioning_actual,
    client_handover_actual = NEW.client_handover_actual,
    escalation_level = NEW.escalation_level,
    rag_status = NEW.rag_status,
    rag_comment = NEW.rag_comment,
    rag_updated_at = NEW.rag_updated_at,
    rag_updated_by_user_id = NEW.rag_updated_by_user_id,
    is_active = NEW.is_active,
    deleted_at = NEW.deleted_at,
    archived_status = NEW.archived_status,
    execution_enabled = NEW.execution_enabled,
    execution_gate_status = NEW.execution_gate_status,
    execution_gate_reason = NEW.execution_gate_reason,
    execution_phase = NEW.execution_phase,
    signed_status = NEW.signed_status,
    signed_date = NEW.signed_date,
    signed_document_link = NEW.signed_document_link,
    cp_signed = NEW.cp_signed,
    cp_signed_date = NEW.cp_signed_date,
    cp_signed_by_user_id = NEW.cp_signed_by_user_id,
    cp_evidence_type = NEW.cp_evidence_type,
    cp_evidence_ref = NEW.cp_evidence_ref,
    pm_task_pack_created = NEW.pm_task_pack_created,
    eng_post_cp_task_pack_created = NEW.eng_post_cp_task_pack_created,
    construction_manager_user_id = NEW.construction_manager_user_id,
    quality_lead_user_id = NEW.quality_lead_user_id,
    engineering_lead_user_id = NEW.engineering_lead_user_id,
    program_manager_user_id = NEW.program_manager_user_id,
    project_finance_user_id = NEW.project_finance_user_id,
    matriarch_handover_target = NEW.matriarch_handover_target,
    practical_completion_target = NEW.practical_completion_target,
    practical_completion_actual = NEW.practical_completion_actual,
    cost_baseline = NEW.cost_baseline,
    margin_baseline = NEW.margin_baseline,
    current_stage_code = NEW.current_stage_code,
    gate_status = NEW.gate_status,
    gate_readiness_pct = NEW.gate_readiness_pct,
    waiting_on_department = NEW.waiting_on_department,
    waiting_on_user_id = NEW.waiting_on_user_id,
    next_required_action = NEW.next_required_action,
    stage_owner_user_id = NEW.stage_owner_user_id,
    stage_approver_user_id = NEW.stage_approver_user_id,
    kam_user_id = NEW.kam_user_id,
    site_establishment_date = NEW.site_establishment_date,
    site_establishment_actual = NEW.site_establishment_actual,
    financial_review_status = NEW.financial_review_status,
    financial_review_id = NEW.financial_review_id,
    last_synced_at = NOW(),
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.project_id;

  -- Create state history snapshot for audit trail
  INSERT INTO core.project_state_history (
    project_id, legacy_execution_state_id,
    phase, phase_updated_at, current_stage_code, execution_phase,
    execution_gate_status, execution_gate_reason,
    gate_status, gate_readiness_pct,
    rag_status, rag_comment, rag_updated_at,
    signed_status, signed_date, cp_signed, cp_signed_date,
    pd_handover_date, construction_start_date, commissioning_date,
    om_handover_date, client_handover_date,
    construction_start_actual, pd_handover_actual,
    commissioning_actual, client_handover_actual,
    is_active, archived_status, escalation_level,
    is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
  ) VALUES (
    NEW.project_id, NEW.id,
    NEW.phase, NEW.phase_updated_at, NEW.current_stage_code, NEW.execution_phase,
    NEW.execution_gate_status, NEW.execution_gate_reason,
    NEW.gate_status, NEW.gate_readiness_pct,
    NEW.rag_status, NEW.rag_comment, NEW.rag_updated_at,
    NEW.signed_status, NEW.signed_date, NEW.cp_signed, NEW.cp_signed_date,
    NEW.pd_handover_date, NEW.construction_start_date, NEW.commissioning_date,
    NEW.om_handover_date, NEW.client_handover_date,
    NEW.construction_start_actual, NEW.pd_handover_actual,
    NEW.commissioning_actual, NEW.client_handover_actual,
    NEW.is_active, NEW.archived_status, NEW.escalation_level,
    true, 'view_swap_trigger', 'public.project_execution_state',
    COALESCE(NEW.updated_at, NOW()), NOW()
  );

  -- Mark previous snapshots as not current
  UPDATE core.project_state_history
  SET is_current = false
  WHERE project_id = NEW.project_id
    AND is_current = true
    AND id != (
      SELECT id FROM core.project_state_history
      WHERE project_id = NEW.project_id
      ORDER BY snapshot_at DESC, id DESC
      LIMIT 1
    );

  -- Also update legacy table
  UPDATE public._project_execution_state_legacy SET
    phase = NEW.phase,
    phase_updated_at = NEW.phase_updated_at,
    phase_updated_by_user_id = NEW.phase_updated_by_user_id,
    phase_notes = NEW.phase_notes,
    rag_status = NEW.rag_status,
    rag_comment = NEW.rag_comment,
    rag_updated_at = NEW.rag_updated_at,
    is_active = NEW.is_active,
    deleted_at = NEW.deleted_at,
    archived_status = NEW.archived_status,
    execution_enabled = NEW.execution_enabled,
    execution_gate_status = NEW.execution_gate_status,
    execution_gate_reason = NEW.execution_gate_reason,
    execution_phase = NEW.execution_phase,
    signed_status = NEW.signed_status,
    signed_date = NEW.signed_date,
    current_stage_code = NEW.current_stage_code,
    gate_status = NEW.gate_status,
    gate_readiness_pct = NEW.gate_readiness_pct,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE project_id = NEW.project_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DELETE: Soft-delete in promoted schema
CREATE OR REPLACE FUNCTION public._pes_view_delete() RETURNS trigger AS $$
BEGIN
  UPDATE core.projects SET deleted_at = NOW(), is_active = false
  WHERE id = OLD.project_id;
  DELETE FROM public._project_execution_state_legacy
  WHERE project_id = OLD.project_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pes_view_insert INSTEAD OF INSERT ON public.project_execution_state
  FOR EACH ROW EXECUTE FUNCTION public._pes_view_insert();
CREATE TRIGGER pes_view_update INSTEAD OF UPDATE ON public.project_execution_state
  FOR EACH ROW EXECUTE FUNCTION public._pes_view_update();
CREATE TRIGGER pes_view_delete INSTEAD OF DELETE ON public.project_execution_state
  FOR EACH ROW EXECUTE FUNCTION public._pes_view_delete();

COMMIT;
