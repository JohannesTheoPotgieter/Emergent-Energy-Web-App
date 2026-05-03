-- Stage Workspaces 1-5 (Prompt 3)
-- Creates project_stage_data, project_charters tables
-- Seeds checklist templates for stages S01-S05

BEGIN;

-- ============================================================
-- 1. PROJECT STAGE DATA — JSONB storage for stage-specific fields
-- ============================================================

CREATE TABLE IF NOT EXISTS project_stage_data (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT project_stage_data_project_stage_uq UNIQUE (project_id, stage_code)
);
CREATE INDEX IF NOT EXISTS psd_data_project_id_idx ON project_stage_data(project_id);

-- ============================================================
-- 2. PROJECT CHARTERS — Structured charter for Stage 4 PD-PM Handover
-- ============================================================

CREATE TABLE IF NOT EXISTS project_charters (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE UNIQUE,

  -- Section 1: Overview
  charter_project_name TEXT,
  charter_site_name TEXT,
  charter_site_address TEXT,
  charter_gps_coordinates TEXT,
  charter_facility_type TEXT,
  charter_utility_supplier TEXT,
  charter_existing_infrastructure TEXT,
  charter_roof_type TEXT,
  charter_access_method TEXT,
  charter_special_site_notes TEXT,
  charter_structural_assessment_done BOOLEAN DEFAULT FALSE,
  charter_structural_assessment_notes TEXT,

  -- Section 2: Stakeholders (External)
  charter_client_name TEXT,
  charter_client_type TEXT,
  charter_primary_contact_name TEXT,
  charter_primary_contact_email TEXT,
  charter_primary_contact_phone TEXT,
  charter_client_relationship_notes TEXT,

  -- Section 2: Stakeholders (Internal)
  charter_pd_user_id INTEGER REFERENCES users(id),
  charter_programme_manager_user_id INTEGER REFERENCES users(id),
  charter_project_manager_user_id INTEGER REFERENCES users(id),
  charter_procurement_manager_user_id INTEGER REFERENCES users(id),
  charter_om_manager_user_id INTEGER REFERENCES users(id),
  charter_asset_manager_user_id INTEGER REFERENCES users(id),
  charter_compliance_officer_user_id INTEGER REFERENCES users(id),
  charter_safety_officer_user_id INTEGER REFERENCES users(id),
  charter_designer_user_id INTEGER REFERENCES users(id),
  charter_preferred_installer TEXT,

  -- Section 3: Scope — System Specification
  charter_system_type TEXT,
  charter_system_size_kwp REAL,
  charter_inverter_capacity_kva REAL,
  charter_battery_capacity_kwh REAL,
  charter_module_spec TEXT,
  charter_inverter_spec TEXT,
  charter_mounting_type TEXT,
  charter_monitoring_system TEXT,
  charter_metering TEXT,
  charter_diesel_gen_integration BOOLEAN DEFAULT FALSE,
  charter_dedicated_feeder BOOLEAN DEFAULT FALSE,
  charter_transformer_details TEXT,
  charter_tie_in_points TEXT,
  charter_main_breaker_details TEXT,
  charter_internet_provision TEXT,

  -- Section 3: Scope — HSE
  charter_hse_contact_established BOOLEAN DEFAULT FALSE,
  charter_lifelines_required BOOLEAN DEFAULT FALSE,
  charter_additional_security_required BOOLEAN DEFAULT FALSE,
  charter_hse_notes TEXT,

  -- Section 3: Scope — SSEG / Compliance
  charter_sseg_application_status TEXT,
  charter_grid_study_status TEXT,
  charter_notification_number TEXT,

  -- Section 3: Scope — O&M
  charter_om_contract_type TEXT,
  charter_waterpoints_available BOOLEAN DEFAULT FALSE,
  charter_metering_billing_required BOOLEAN DEFAULT FALSE,
  charter_om_special_notes TEXT,

  -- Section 4: Schedule
  charter_alignment_meeting_date DATE,
  charter_installer_walkthrough_date DATE,
  charter_external_intro_meeting_date DATE,
  charter_internal_review_date DATE,
  charter_client_kickoff_date DATE,
  charter_site_establishment_date DATE,
  charter_expected_completion_date DATE,
  charter_handover_date_target DATE,

  -- Section 5: Budget
  charter_funding_model TEXT,
  charter_payment_terms_text TEXT,
  charter_invoice_conditions_text TEXT,
  charter_funding_partner TEXT,
  charter_deposit_status TEXT,
  charter_bdp_commission TEXT,
  charter_budget_notes TEXT,

  -- Section 6: Risks / Opportunities / Triage
  charter_overview_risk_summary TEXT,
  charter_stakeholder_risk_summary TEXT,
  charter_scope_risk_summary TEXT,
  charter_schedule_risk_summary TEXT,
  charter_budget_risk_summary TEXT,
  charter_triage_level TEXT,
  charter_opportunities_text TEXT,

  -- Meta
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_user_id INTEGER REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. SEED CHECKLIST TEMPLATES FOR STAGES 1-5
-- ============================================================

-- ── S01: First Assessment ──────────────────────────────────

-- PD checklist (10 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S01_FIRST_ASSESSMENT', 'PD', 'Client enquiry / lead source captured', 'S01_PD_ENQUIRY_SOURCE', true, 1),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Client need summary (business driver, energy goals, timeline)', 'S01_PD_NEED_SUMMARY', true, 2),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Site identified (address, access, basic physical characteristics)', 'S01_PD_SITE_IDENTIFIED', true, 3),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Preliminary site photos or satellite imagery', 'S01_PD_SITE_PHOTOS', false, 4),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Grid connection type identified (Eskom, municipal, embedded)', 'S01_PD_GRID_CONNECTION', true, 5),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Rough system size estimate (kWp)', 'S01_PD_SYSTEM_SIZE', true, 6),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Funding model indication (self-funded, third-party, PPA, lease)', 'S01_PD_FUNDING_MODEL', true, 7),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Client creditworthiness / risk flag', 'S01_PD_CREDIT_RISK', true, 8),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Strategic fit assessment (aligns with EE target market)', 'S01_PD_STRATEGIC_FIT', true, 9),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Go / No-Go recommendation', 'S01_PD_GO_NO_GO', true, 10)
ON CONFLICT DO NOTHING;

-- Engineering checklist (3 items, light touch)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S01_FIRST_ASSESSMENT', 'ENGINEERING', 'Roof or ground suitability flag (obvious constraints)', 'S01_ENG_SUITABILITY', false, 1),
  ('S01_FIRST_ASSESSMENT', 'ENGINEERING', 'SSEG requirement identified (Y/N)', 'S01_ENG_SSEG', false, 2),
  ('S01_FIRST_ASSESSMENT', 'ENGINEERING', 'Preliminary irradiation / yield estimate (if available)', 'S01_ENG_IRRADIATION', false, 3)
ON CONFLICT DO NOTHING;

-- Finance checklist (2 items, light touch)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S01_FIRST_ASSESSMENT', 'FINANCE', 'Rough deal value estimate', 'S01_FIN_DEAL_VALUE', false, 1),
  ('S01_FIRST_ASSESSMENT', 'FINANCE', 'Funding model viability flag', 'S01_FIN_FUNDING_VIABILITY', false, 2)
ON CONFLICT DO NOTHING;

-- ── S02: Design & Cost Proposal ────────────────────────────

-- PD checklist (6 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Client need captured (site, load, business need)', 'S02_PD_CLIENT_NEED', true, 1),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Scope statement finalized', 'S02_PD_SCOPE_STATEMENT', true, 2),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Funding structure outline', 'S02_PD_FUNDING_STRUCTURE', true, 3),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Client constraints logged', 'S02_PD_CLIENT_CONSTRAINTS', false, 4),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'O&M quote trigger raised where applicable', 'S02_PD_OM_TRIGGER', false, 5),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Scope-change alerts reviewed', 'S02_PD_SCOPE_CHANGE_ALERTS', false, 6)
ON CONFLICT DO NOTHING;

-- Engineering checklist (6 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Site data complete (irradiation, grid, structural assumption)', 'S02_ENG_SITE_DATA', true, 1),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Preliminary design done', 'S02_ENG_PRELIM_DESIGN', true, 2),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Design assumptions register populated', 'S02_ENG_ASSUMPTIONS', true, 3),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'SSEG requirements identified', 'S02_ENG_SSEG', false, 4),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Preliminary metering concept defined', 'S02_ENG_METERING', false, 5),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Structural and electrical constraints documented', 'S02_ENG_CONSTRAINTS', false, 6)
ON CONFLICT DO NOTHING;

-- Finance checklist (3 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S02_DESIGN_COST_PROPOSAL', 'FINANCE', 'Cost build-up complete', 'S02_FIN_COST_BUILDUP', true, 1),
  ('S02_DESIGN_COST_PROPOSAL', 'FINANCE', 'Margin baseline set', 'S02_FIN_MARGIN_BASELINE', true, 2),
  ('S02_DESIGN_COST_PROPOSAL', 'FINANCE', 'PD price vs cost vs funding structure aligned', 'S02_FIN_ALIGNMENT', true, 3)
ON CONFLICT DO NOTHING;

-- Quality checklist (1 item)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S02_DESIGN_COST_PROPOSAL', 'QUALITY', 'Design peer review flag (for larger projects)', 'S02_QA_PEER_REVIEW', false, 1)
ON CONFLICT DO NOTHING;

-- ── S03: Signature & Financial Close ───────────────────────

-- PD checklist (4 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'Contract documents uploaded', 'S03_PD_CONTRACTS_UPLOADED', true, 1),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'Deviations from proposal captured', 'S03_PD_DEVIATIONS', true, 2),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'Client commitments that deviate from standard logged', 'S03_PD_CLIENT_COMMITMENTS', false, 3),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'Changes since proposal summary prepared for handover', 'S03_PD_CHANGES_SUMMARY', true, 4)
ON CONFLICT DO NOTHING;

-- Finance checklist (4 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Funding approval from partner confirmed', 'S03_FIN_FUNDING_APPROVAL', true, 1),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Payment schedule aligned with milestones', 'S03_FIN_PAYMENT_SCHEDULE', true, 2),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Platform fees and drawdown flows set', 'S03_FIN_PLATFORM_FEES', false, 3),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Deposit required / received', 'S03_FIN_DEPOSIT', true, 4)
ON CONFLICT DO NOTHING;

-- Exco checklist (2 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'EXCO', 'Strategic risk reviewed (client, site, credit, complexity)', 'S03_EXCO_RISK_REVIEW', true, 1),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'EXCO', 'GO / NO GO sign-off', 'S03_EXCO_GO_NO_GO', true, 2)
ON CONFLICT DO NOTHING;

-- ── S04: PD → PM Handover ──────────────────────────────────

-- PD checklist (7 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'PD', 'Project charter completed (all 6 sections)', 'S04_PD_CHARTER_COMPLETE', true, 1),
  ('S04_PD_PM_HANDOVER', 'PD', 'Assumptions list finalized', 'S04_PD_ASSUMPTIONS', true, 2),
  ('S04_PD_PM_HANDOVER', 'PD', 'Open risks listed', 'S04_PD_RISKS_LISTED', true, 3),
  ('S04_PD_PM_HANDOVER', 'PD', 'Commercial commitments logged', 'S04_PD_COMMERCIAL_COMMITMENTS', true, 4),
  ('S04_PD_PM_HANDOVER', 'PD', 'Client stakeholders identified', 'S04_PD_STAKEHOLDERS', true, 5),
  ('S04_PD_PM_HANDOVER', 'PD', 'Special conditions documented', 'S04_PD_SPECIAL_CONDITIONS', false, 6),
  ('S04_PD_PM_HANDOVER', 'PD', 'Changes since proposal summary attached', 'S04_PD_CHANGES_SUMMARY', true, 7)
ON CONFLICT DO NOTHING;

-- PM checklist (3 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'PM', 'Read charter (all 6 sections)', 'S04_PM_READ_CHARTER', true, 1),
  ('S04_PD_PM_HANDOVER', 'PM', 'Clarification questions asked and answered', 'S04_PM_CLARIFICATIONS', false, 2),
  ('S04_PD_PM_HANDOVER', 'PM', 'Acceptance decision recorded', 'S04_PM_ACCEPTANCE', true, 3)
ON CONFLICT DO NOTHING;

-- Engineering checklist (2 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'ENGINEERING', 'Design pack ready (SLD, layouts, design reports)', 'S04_ENG_DESIGN_PACK', true, 1),
  ('S04_PD_PM_HANDOVER', 'ENGINEERING', 'Open technical assumptions flagged', 'S04_ENG_ASSUMPTIONS', false, 2)
ON CONFLICT DO NOTHING;

-- Quality checklist (1 item)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'QUALITY', 'Pre-kickoff QA items defined (Red Team requirement Y/N)', 'S04_QA_PREKICKOFF', false, 1)
ON CONFLICT DO NOTHING;

-- Finance checklist (2 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'FINANCE', 'Budget version aligned with PD margin and contract terms', 'S04_FIN_BUDGET_ALIGNED', true, 1),
  ('S04_PD_PM_HANDOVER', 'FINANCE', 'Financial baseline set', 'S04_FIN_BASELINE', true, 2)
ON CONFLICT DO NOTHING;

-- ── S05: Financial Review ──────────────────────────────────

-- PM checklist (3 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S05_FINANCIAL_REVIEW', 'PM', 'Updated forecast costs submitted', 'S05_PM_FORECAST_COSTS', true, 1),
  ('S05_FINANCIAL_REVIEW', 'PM', 'Variations captured with reasons', 'S05_PM_VARIATIONS', true, 2),
  ('S05_FINANCIAL_REVIEW', 'PM', 'Milestone evidence uploaded', 'S05_PM_MILESTONE_EVIDENCE', false, 3)
ON CONFLICT DO NOTHING;

-- Finance checklist (4 items)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Committed vs budget comparison done', 'S05_FIN_BUDGET_COMPARISON', true, 1),
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Margin forecast updated', 'S05_FIN_MARGIN_FORECAST', true, 2),
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Drawdowns vs plan reviewed', 'S05_FIN_DRAWDOWNS', false, 3),
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Upcoming cash exposures flagged', 'S05_FIN_CASH_EXPOSURES', true, 4)
ON CONFLICT DO NOTHING;

-- Exco checklist (1 item)
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S05_FINANCIAL_REVIEW', 'EXCO', 'Approves/acknowledges projects crossing thresholds', 'S05_EXCO_THRESHOLD_APPROVAL', false, 1)
ON CONFLICT DO NOTHING;

COMMIT;
