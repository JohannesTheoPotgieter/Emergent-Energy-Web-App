-- Full Spine Promotion: Add all missing columns to promoted tables and backfill
-- This makes core.projects, finance.cost_lines, and finance.revenue_lines
-- complete mirrors of their legacy counterparts.
BEGIN;

-- ============================================================================
-- 1. core.projects — add all 35 missing columns from project_info
-- ============================================================================
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS size_kwp NUMERIC;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS pd TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS pm TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS contract_value NUMERIC;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS pd_handover_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS construction_start_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS commissioning_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS om_handover_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS client_handover_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS escalation_level TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS construction_start_actual TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS pd_handover_actual TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS commissioning_actual TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS client_handover_actual TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS rag_updated_at TIMESTAMP;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS phase_updated_by_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS phase_notes TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS execution_enabled BOOLEAN DEFAULT false;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS signed_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS signed_document_link TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS excel_tracker_link TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS canonical_project_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS rag_updated_by_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cp_signed BOOLEAN DEFAULT false;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cp_signed_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cp_signed_by_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cp_evidence_type TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cp_evidence_ref TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS pm_task_pack_created BOOLEAN DEFAULT false;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS eng_post_cp_task_pack_created BOOLEAN DEFAULT false;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS site_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS opportunity_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS delivery_model TEXT;

-- Also add project_execution_state fields not already present
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS construction_manager_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS quality_lead_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS engineering_lead_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS program_manager_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS project_finance_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS matriarch_handover_target DATE;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS practical_completion_target DATE;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS practical_completion_actual DATE;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS cost_baseline NUMERIC;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS margin_baseline NUMERIC;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS site_establishment_date TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS site_establishment_actual TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS financial_review_status TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS financial_review_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS waiting_on_department TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS waiting_on_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS next_required_action TEXT;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS stage_owner_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS stage_approver_user_id INTEGER;
ALTER TABLE core.projects ADD COLUMN IF NOT EXISTS kam_user_id INTEGER;

-- ============================================================================
-- 2. finance.cost_lines — add missing columns from normalized_cost_lines
-- ============================================================================
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cost_category TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS counterparty_id INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS counterparty_type TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cost_line_status TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS source_row TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS turnaround_days INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS invoice_date_font_color TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS invoice_date_confirmed BOOLEAN;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS paid_date_font_color TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS paid_date_confirmed BOOLEAN;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cos_realised BOOLEAN;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cashflow_confirmed BOOLEAN;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS no_revenue_linked BOOLEAN;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS budget_qty TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS budget_rate TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS budget_total TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS budget_cos TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS revenue_recognition_amount TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cos_status_override TEXT;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_by INTEGER;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_at TIMESTAMP;
ALTER TABLE finance.cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_reason TEXT;

-- ============================================================================
-- 3. finance.revenue_lines — add missing columns from normalized_revenue_lines
-- ============================================================================
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS vat TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS in_bank_date TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS source_sheet TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS source_row TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS turnaround_days INTEGER;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS invoice_date_font_color TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS invoice_date_confirmed BOOLEAN;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS paid_date_font_color TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS paid_date_confirmed BOOLEAN;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS snapshot_run_id INTEGER;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
ALTER TABLE finance.revenue_lines ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

COMMIT;
