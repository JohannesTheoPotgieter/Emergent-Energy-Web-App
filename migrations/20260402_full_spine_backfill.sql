-- Full Spine Backfill: Populate all new promoted columns from legacy
BEGIN;

-- ============================================================================
-- 1. core.projects ← project_info (direct columns)
-- ============================================================================
UPDATE core.projects cp SET
  size_kwp = pi.size_kwp,
  pd = pi.pd,
  pm = pi.pm,
  contract_value = pi.contract_value,
  is_active = COALESCE(pi.is_active, true),
  execution_enabled = COALESCE(pi.execution_enabled, false),
  signed_date = pi.signed_date,
  signed_document_link = pi.signed_document_link,
  excel_tracker_link = pi.excel_tracker_link,
  canonical_project_id = pi.canonical_project_id,
  cp_signed = COALESCE(pi.cp_signed, false),
  cp_signed_date = pi.cp_signed_date,
  cp_signed_by_user_id = pi.cp_signed_by_user_id,
  cp_evidence_type = pi.cp_evidence_type,
  cp_evidence_ref = pi.cp_evidence_ref,
  pm_task_pack_created = COALESCE(pi.pm_task_pack_created, false),
  eng_post_cp_task_pack_created = COALESCE(pi.eng_post_cp_task_pack_created, false),
  deleted_at = pi.deleted_at,
  site_id = pi.site_id,
  opportunity_id = pi.opportunity_id,
  delivery_model = pi.delivery_model
FROM public.project_info pi
WHERE cp.legacy_project_info_id = pi.id;

-- ============================================================================
-- 2. core.projects ← project_execution_state (lifecycle + date fields)
--    Uses ROW_NUMBER to pick the latest non-deleted row per project
-- ============================================================================
UPDATE core.projects cp SET
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
  rag_updated_at = pes.rag_updated_at,
  phase_updated_by_user_id = pes.phase_updated_by_user_id,
  phase_notes = pes.phase_notes,
  rag_updated_by_user_id = pes.rag_updated_by_user_id,
  construction_manager_user_id = pes.construction_manager_user_id,
  quality_lead_user_id = pes.quality_lead_user_id,
  engineering_lead_user_id = pes.engineering_lead_user_id,
  program_manager_user_id = pes.program_manager_user_id,
  project_finance_user_id = pes.project_finance_user_id,
  matriarch_handover_target = pes.matriarch_handover_target,
  practical_completion_target = pes.practical_completion_target,
  practical_completion_actual = pes.practical_completion_actual,
  cost_baseline = pes.cost_baseline,
  margin_baseline = pes.margin_baseline,
  site_establishment_date = pes.site_establishment_date,
  site_establishment_actual = pes.site_establishment_actual,
  financial_review_status = pes.financial_review_status,
  financial_review_id = pes.financial_review_id,
  waiting_on_department = pes.waiting_on_department,
  waiting_on_user_id = pes.waiting_on_user_id,
  next_required_action = pes.next_required_action,
  stage_owner_user_id = pes.stage_owner_user_id,
  stage_approver_user_id = pes.stage_approver_user_id,
  kam_user_id = pes.kam_user_id
FROM (
  SELECT DISTINCT ON (project_id) *
  FROM public.project_execution_state
  WHERE deleted_at IS NULL
  ORDER BY project_id, updated_at DESC, id DESC
) pes
WHERE cp.legacy_project_info_id = pes.project_id;

-- ============================================================================
-- 3. finance.cost_lines ← normalized_cost_lines
-- ============================================================================
UPDATE finance.cost_lines cl SET
  cost_category = ncl.cost_category,
  counterparty_id = ncl.counterparty_id,
  counterparty_type = ncl.counterparty_type,
  po_number = ncl.po_number,
  cost_line_status = ncl.cost_line_status::TEXT,
  source_sheet = ncl.source_sheet,
  source_row = ncl.source_row,
  turnaround_days = ncl.turnaround_days,
  invoice_date_font_color = ncl.invoice_date_font_color,
  invoice_date_confirmed = ncl.invoice_date_confirmed,
  paid_date_font_color = ncl.paid_date_font_color,
  paid_date_confirmed = ncl.paid_date_confirmed,
  cos_realised = ncl.cos_realised,
  cashflow_confirmed = ncl.cashflow_confirmed,
  no_revenue_linked = ncl.no_revenue_linked,
  sub_project_name = ncl.sub_project_name,
  budget_qty = ncl.budget_qty,
  budget_rate = ncl.budget_rate,
  budget_total = ncl.budget_total,
  budget_cos = ncl.budget_cos,
  revenue_recognition_amount = ncl.revenue_recognition_amount,
  forecast_payment_date = ncl.forecast_payment_date,
  effective_from = ncl.effective_from,
  effective_to = ncl.effective_to,
  snapshot_run_id = ncl.snapshot_run_id,
  last_edited_by = ncl.last_edited_by,
  last_edited_at = ncl.last_edited_at,
  deleted_at = ncl.deleted_at,
  cos_status_override = ncl.cos_status_override,
  cos_status_override_by = ncl.cos_status_override_by,
  cos_status_override_at = ncl.cos_status_override_at,
  cos_status_override_reason = ncl.cos_status_override_reason
FROM public.normalized_cost_lines ncl
WHERE cl.legacy_normalized_cost_line_id = ncl.id;

-- ============================================================================
-- 4. finance.revenue_lines ← normalized_revenue_lines
-- ============================================================================
UPDATE finance.revenue_lines rl SET
  description = nrl.description,
  vat = nrl.vat,
  in_bank_date = nrl.in_bank_date,
  source_sheet = nrl.source_sheet,
  source_row = nrl.source_row,
  turnaround_days = nrl.turnaround_days,
  invoice_date_font_color = nrl.invoice_date_font_color,
  invoice_date_confirmed = nrl.invoice_date_confirmed,
  paid_date_font_color = nrl.paid_date_font_color,
  paid_date_confirmed = nrl.paid_date_confirmed,
  sub_project_name = nrl.sub_project_name,
  effective_from = nrl.effective_from,
  effective_to = nrl.effective_to,
  snapshot_run_id = nrl.snapshot_run_id,
  last_edited_by = nrl.last_edited_by,
  last_edited_at = nrl.last_edited_at,
  deleted_at = nrl.deleted_at
FROM public.normalized_revenue_lines nrl
WHERE rl.legacy_normalized_revenue_line_id = nrl.id;

COMMIT;
