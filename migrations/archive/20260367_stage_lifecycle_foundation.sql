-- Stage Lifecycle Foundation (Prompt 1)
-- Gate-driven 10-stage project lifecycle: tables, indexes, seed data

BEGIN;

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

-- Admin-managed stage configuration
CREATE TABLE IF NOT EXISTS stage_definitions (
  id SERIAL PRIMARY KEY,
  stage_code TEXT NOT NULL UNIQUE,
  stage_name TEXT NOT NULL,
  stage_sequence INTEGER NOT NULL,
  description TEXT,
  default_owner_role TEXT,
  default_approver_role TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Admin-managed default checklists per stage per department
CREATE TABLE IF NOT EXISTS stage_checklist_templates (
  id SERIAL PRIMARY KEY,
  stage_code TEXT NOT NULL,
  department TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_code TEXT NOT NULL,
  blocks_gate BOOLEAN NOT NULL DEFAULT FALSE,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per project per stage (10 rows per project)
CREATE TABLE IF NOT EXISTS project_stage_instances (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  stage_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  stage_owner_user_id INTEGER REFERENCES users(id),
  approver_user_id INTEGER REFERENCES users(id),
  readiness_pct INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  target_exit_date DATE,
  waiting_on_department TEXT,
  waiting_on_user_id INTEGER REFERENCES users(id),
  next_required_action TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT project_stage_instances_project_stage_uq UNIQUE (project_id, stage_code)
);
CREATE INDEX IF NOT EXISTS psi_project_id_idx ON project_stage_instances(project_id);
CREATE INDEX IF NOT EXISTS psi_stage_status_idx ON project_stage_instances(stage_status);

-- Checklist items per stage per department
CREATE TABLE IF NOT EXISTS project_stage_requirements (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_instance_id INTEGER NOT NULL REFERENCES project_stage_instances(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  department TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_code TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  blocks_gate BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_url TEXT,
  evidence_attached BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by_user_id INTEGER REFERENCES users(id),
  completed_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS psr_stage_instance_idx ON project_stage_requirements(stage_instance_id);
CREATE INDEX IF NOT EXISTS psr_department_idx ON project_stage_requirements(department);
CREATE INDEX IF NOT EXISTS psr_status_idx ON project_stage_requirements(status);

-- Evidence documents per stage
CREATE TABLE IF NOT EXISTS project_stage_evidence (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_instance_id INTEGER NOT NULL REFERENCES project_stage_instances(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  evidence_type TEXT,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  inherited_from_stage TEXT,
  review_status TEXT DEFAULT 'pending',
  reviewed_by_user_id INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  notes TEXT
);

-- Decision register
CREATE TABLE IF NOT EXISTS project_stage_decisions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  decision_summary TEXT NOT NULL,
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_date TIMESTAMP NOT NULL DEFAULT NOW(),
  rationale TEXT,
  impacted_departments JSONB DEFAULT '[]',
  impacted_downstream_stages JSONB DEFAULT '[]',
  evidence_url TEXT,
  related_exception_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Exception/bypass records
CREATE TABLE IF NOT EXISTS project_stage_exceptions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  requirement_code TEXT,
  reason_text TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
  mitigation_text TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  approver_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  conditions_text TEXT,
  closeout_due_date DATE,
  downstream_blocking_stage TEXT,
  approved_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pse_project_id_idx ON project_stage_exceptions(project_id);
CREATE INDEX IF NOT EXISTS pse_status_idx ON project_stage_exceptions(status);

-- Cross-department waiting-on tracking
CREATE TABLE IF NOT EXISTS project_stage_dependencies (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  from_department TEXT NOT NULL,
  from_user_id INTEGER REFERENCES users(id),
  to_department TEXT NOT NULL,
  to_user_id INTEGER REFERENCES users(id),
  description TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'WAITING',
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psd_project_id_idx ON project_stage_dependencies(project_id);
CREATE INDEX IF NOT EXISTS psd_status_idx ON project_stage_dependencies(status);


-- ============================================================
-- 2. EXTEND EXISTING TABLES
-- ============================================================

-- project_execution_state: stage lifecycle columns
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS current_stage_code TEXT;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS gate_status TEXT;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS gate_readiness_pct INTEGER DEFAULT 0;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS stage_owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS stage_approver_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS waiting_on_department TEXT;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS waiting_on_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS next_required_action TEXT;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS kam_user_id INTEGER REFERENCES users(id);

-- handover_checklist_items: stage lifecycle extensions
ALTER TABLE handover_checklist_items ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE handover_checklist_items ADD COLUMN IF NOT EXISTS blocks_gate BOOLEAN DEFAULT FALSE;
ALTER TABLE handover_checklist_items ADD COLUMN IF NOT EXISTS stage_code TEXT;

-- work_items: stage lifecycle extensions
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS related_stage_code TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS source_screen TEXT;


-- ============================================================
-- 3. SEED DATA: stage_definitions (10 stages)
-- ============================================================

INSERT INTO stage_definitions (stage_code, stage_name, stage_sequence, description, default_owner_role, default_approver_role)
VALUES
  ('S01_FIRST_ASSESSMENT', 'First Assessment', 1,
   'Qualify the opportunity — site viability, client fit, rough feasibility',
   'PROJECT_DEVELOPER', 'PROGRAM_MANAGER'),
  ('S02_DESIGN_COST_PROPOSAL', 'Design & Cost Proposal Build', 2,
   'Ensure the proposal is accurate, buildable, commercially safe, and aligned to client need',
   'PROJECT_DEVELOPER', 'ENGINEERING_MANAGER'),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'Signature & Financial Close', 3,
   'Confirm the project is commercially live and executable',
   'PROJECT_DEVELOPER', 'CFO'),
  ('S04_PD_PM_HANDOVER', 'PD → PM Handover', 4,
   'Transfer complete project context into execution',
   'PROJECT_DEVELOPER', 'PROGRAM_MANAGER'),
  ('S05_FINANCIAL_REVIEW', 'Financial Review', 5,
   'Protect margin and forecast before execution pain arrives',
   'PROGRAM_FINANCE_MANAGER', 'CFO'),
  ('S06_CONSTRUCTION', 'Construction', 6,
   'Execute the build — manage inflows, installer relations, timelines, and plan adherence',
   'CONSTRUCTION_MANAGER', 'PROGRAM_MANAGER'),
  ('S07_COMMISSIONING', 'Commissioning', 7,
   'Control the move from installed to safe, tested, producing, proven',
   'PROJECT_MANAGER_SITE', 'QUALITY_MANAGER'),
  ('S08_OM_HANDOVER', 'O&M Handover', 8,
   'Transfer the site properly to Matriarch/O&M',
   'PROJECT_MANAGER_SITE', 'PROGRAM_MANAGER'),
  ('S09_CLIENT_HANDOVER', 'Client Handover', 9,
   'Close the project with the client properly',
   'PROJECT_MANAGER_SITE', 'PROGRAM_MANAGER'),
  ('S10_POST_HANDOVER_REVIEW', '3-Month Post-Handover Review', 10,
   'Close the loop between promise and reality',
   'KEY_ACCOUNTS_MANAGER', 'COO_ADMIN')
ON CONFLICT (stage_code) DO NOTHING;


-- ============================================================
-- 4. SEED DATA: stage_checklist_templates (core items per stage)
-- ============================================================

-- Stage 1: First Assessment
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S01_FIRST_ASSESSMENT', 'PD', 'Site viability assessment complete', 'S01_PD_SITE_VIABILITY', TRUE, 1),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Client fit evaluation done', 'S01_PD_CLIENT_FIT', TRUE, 2),
  ('S01_FIRST_ASSESSMENT', 'PD', 'Rough feasibility estimate prepared', 'S01_PD_FEASIBILITY', TRUE, 3),
  ('S01_FIRST_ASSESSMENT', 'ENGINEERING', 'Initial technical review', 'S01_ENG_TECH_REVIEW', FALSE, 4),
  ('S01_FIRST_ASSESSMENT', 'FINANCE', 'Preliminary commercial assessment', 'S01_FIN_COMMERCIAL', FALSE, 5)
ON CONFLICT DO NOTHING;

-- Stage 2: Design & Cost Proposal Build
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'System design complete', 'S02_ENG_DESIGN', TRUE, 1),
  ('S02_DESIGN_COST_PROPOSAL', 'ENGINEERING', 'Technical review signed off', 'S02_ENG_REVIEW', TRUE, 2),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Cost proposal document prepared', 'S02_PD_COST_PROPOSAL', TRUE, 3),
  ('S02_DESIGN_COST_PROPOSAL', 'PD', 'Client alignment confirmed', 'S02_PD_CLIENT_ALIGN', TRUE, 4),
  ('S02_DESIGN_COST_PROPOSAL', 'FINANCE', 'Commercial model validated', 'S02_FIN_COMMERCIAL', TRUE, 5),
  ('S02_DESIGN_COST_PROPOSAL', 'PROCUREMENT', 'Bill of materials priced', 'S02_PROC_BOM', FALSE, 6)
ON CONFLICT DO NOTHING;

-- Stage 3: Signature & Financial Close
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'Cost proposal signed by client', 'S03_PD_CP_SIGNED', TRUE, 1),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'EPC contract signed', 'S03_PD_EPC_SIGNED', TRUE, 2),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Funding contract confirmed', 'S03_FIN_FUNDING', TRUE, 3),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'PD', 'O&M contract signed (if applicable)', 'S03_PD_OM_SIGNED', FALSE, 4),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'FINANCE', 'Deposit received or waiver approved', 'S03_FIN_DEPOSIT', TRUE, 5),
  ('S03_SIGNATURE_FINANCIAL_CLOSE', 'COMPLIANCE', 'SSEG application submitted', 'S03_COMP_SSEG', FALSE, 6)
ON CONFLICT DO NOTHING;

-- Stage 4: PD → PM Handover
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S04_PD_PM_HANDOVER', 'PD', 'Handover pack complete', 'S04_PD_HANDOVER_PACK', TRUE, 1),
  ('S04_PD_PM_HANDOVER', 'PD', 'Project charter signed', 'S04_PD_CHARTER', TRUE, 2),
  ('S04_PD_PM_HANDOVER', 'PM', 'PM acceptance of handover', 'S04_PM_ACCEPTANCE', TRUE, 3),
  ('S04_PD_PM_HANDOVER', 'ENGINEERING', 'Design documents handed over', 'S04_ENG_DOCS', TRUE, 4),
  ('S04_PD_PM_HANDOVER', 'FINANCE', 'Financial baseline confirmed', 'S04_FIN_BASELINE', TRUE, 5),
  ('S04_PD_PM_HANDOVER', 'PM', 'Alignment meeting held', 'S04_PM_ALIGNMENT', FALSE, 6)
ON CONFLICT DO NOTHING;

-- Stage 5: Financial Review
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Margin review complete', 'S05_FIN_MARGIN', TRUE, 1),
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Cash flow forecast updated', 'S05_FIN_CASHFLOW', TRUE, 2),
  ('S05_FINANCIAL_REVIEW', 'FINANCE', 'Cost variance analysis done', 'S05_FIN_VARIANCE', TRUE, 3),
  ('S05_FINANCIAL_REVIEW', 'PM', 'PM cost input provided', 'S05_PM_COST_INPUT', TRUE, 4),
  ('S05_FINANCIAL_REVIEW', 'EXCO', 'Financial review sign-off', 'S05_EXCO_SIGNOFF', TRUE, 5)
ON CONFLICT DO NOTHING;

-- Stage 6: Construction
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S06_CONSTRUCTION', 'CONSTRUCTION', 'Site establishment complete', 'S06_CON_SITE_EST', TRUE, 1),
  ('S06_CONSTRUCTION', 'CONSTRUCTION', 'All inflows received', 'S06_CON_INFLOWS', TRUE, 2),
  ('S06_CONSTRUCTION', 'CONSTRUCTION', 'Installation complete', 'S06_CON_INSTALL', TRUE, 3),
  ('S06_CONSTRUCTION', 'HSE', 'HSE plan approved', 'S06_HSE_PLAN', TRUE, 4),
  ('S06_CONSTRUCTION', 'HSE', 'Safety inspections passed', 'S06_HSE_INSPECTIONS', TRUE, 5),
  ('S06_CONSTRUCTION', 'QUALITY', 'QC checklists complete', 'S06_QM_CHECKLISTS', TRUE, 6),
  ('S06_CONSTRUCTION', 'PM', 'Schedule adherence confirmed', 'S06_PM_SCHEDULE', FALSE, 7),
  ('S06_CONSTRUCTION', 'PROCUREMENT', 'All POs closed or accounted for', 'S06_PROC_POS', FALSE, 8)
ON CONFLICT DO NOTHING;

-- Stage 7: Commissioning
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S07_COMMISSIONING', 'PM', 'Commissioning schedule approved', 'S07_PM_SCHEDULE', TRUE, 1),
  ('S07_COMMISSIONING', 'QUALITY', 'Commissioning tests passed', 'S07_QM_TESTS', TRUE, 2),
  ('S07_COMMISSIONING', 'QUALITY', 'Snag list resolved', 'S07_QM_SNAGS', TRUE, 3),
  ('S07_COMMISSIONING', 'ENGINEERING', 'Performance ratio verified', 'S07_ENG_PERF', TRUE, 4),
  ('S07_COMMISSIONING', 'COMPLIANCE', 'SSEG approval received', 'S07_COMP_SSEG', TRUE, 5),
  ('S07_COMMISSIONING', 'COMPLIANCE', 'Metering confirmed active', 'S07_COMP_METERING', TRUE, 6),
  ('S07_COMMISSIONING', 'PM', 'Practical completion certificate issued', 'S07_PM_PC_CERT', TRUE, 7),
  ('S07_COMMISSIONING', 'QUALITY', 'NCRs closed or accepted', 'S07_QM_NCRS', FALSE, 8)
ON CONFLICT DO NOTHING;

-- Stage 8: O&M Handover
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S08_OM_HANDOVER', 'PM', 'O&M handover pack complete', 'S08_PM_PACK', TRUE, 1),
  ('S08_OM_HANDOVER', 'OM', 'O&M acceptance decision', 'S08_OM_ACCEPT', TRUE, 2),
  ('S08_OM_HANDOVER', 'OM', 'Monitoring system configured', 'S08_OM_MONITORING', TRUE, 3),
  ('S08_OM_HANDOVER', 'OM', 'SLA targets confirmed', 'S08_OM_SLA', TRUE, 4),
  ('S08_OM_HANDOVER', 'ENGINEERING', 'As-built documentation provided', 'S08_ENG_ASBUILT', TRUE, 5),
  ('S08_OM_HANDOVER', 'PM', 'Defects liability period confirmed', 'S08_PM_DLP', FALSE, 6)
ON CONFLICT DO NOTHING;

-- Stage 9: Client Handover
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S09_CLIENT_HANDOVER', 'PM', 'Client handover pack complete', 'S09_PM_PACK', TRUE, 1),
  ('S09_CLIENT_HANDOVER', 'PM', 'Client acceptance received', 'S09_PM_CLIENT_ACCEPT', TRUE, 2),
  ('S09_CLIENT_HANDOVER', 'FINANCE', 'Final billing complete', 'S09_FIN_BILLING', TRUE, 3),
  ('S09_CLIENT_HANDOVER', 'KAM', 'Client relationship transferred', 'S09_KAM_TRANSFER', TRUE, 4),
  ('S09_CLIENT_HANDOVER', 'PM', 'All warranties documented', 'S09_PM_WARRANTIES', FALSE, 5),
  ('S09_CLIENT_HANDOVER', 'PM', '3-month review auto-scheduled', 'S09_PM_3M_REVIEW', FALSE, 6)
ON CONFLICT DO NOTHING;

-- Stage 10: 3-Month Post-Handover Review
INSERT INTO stage_checklist_templates (stage_code, department, item_name, item_code, blocks_gate, sort_order) VALUES
  ('S10_POST_HANDOVER_REVIEW', 'KAM', 'Client satisfaction survey complete', 'S10_KAM_SURVEY', TRUE, 1),
  ('S10_POST_HANDOVER_REVIEW', 'ENGINEERING', 'Performance vs. design review', 'S10_ENG_PERF', TRUE, 2),
  ('S10_POST_HANDOVER_REVIEW', 'OM', 'O&M performance report', 'S10_OM_REPORT', TRUE, 3),
  ('S10_POST_HANDOVER_REVIEW', 'FINANCE', 'Final margin reconciliation', 'S10_FIN_MARGIN', TRUE, 4),
  ('S10_POST_HANDOVER_REVIEW', 'PM', 'Lessons learned documented', 'S10_PM_LESSONS', FALSE, 5),
  ('S10_POST_HANDOVER_REVIEW', 'QUALITY', 'Warranty claims reviewed', 'S10_QM_WARRANTY', FALSE, 6)
ON CONFLICT DO NOTHING;

COMMIT;
