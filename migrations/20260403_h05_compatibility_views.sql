-- Migration: 20260403_h05_compatibility_views.sql
-- Phase H.5: Create read-only compatibility views over new clean tables.
-- These views allow legacy app code to continue reading from familiar
-- table-like names while all data lives in the new Phase A-G schema.
-- No INSTEAD OF triggers — writes still go through legacy tables + bridge.
-- Additive only. Views are created with CREATE OR REPLACE.
BEGIN;

-- -------------------------------------------------------
-- 1. v_projects — project spine view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW core.v_projects AS
SELECT
  pi.id,
  pi.legacy_project_id,
  p.legacy_project_info_id,
  pt.name AS project_type_name,
  pt.code AS project_type_code,
  p.project_name,
  pi.status,
  pd.code AS current_phase_code,
  pd.name AS current_phase_name,
  pd.phase_group,
  pd.is_gate AS current_phase_is_gate,
  pi.created_at,
  pi.updated_at
FROM core.project_instances pi
JOIN core.projects p ON p.id = pi.legacy_project_id
LEFT JOIN core.project_types pt ON pt.id = pi.project_type_id
LEFT JOIN core.phase_definitions pd ON pd.id = pi.current_phase_definition_id;

COMMENT ON VIEW core.v_projects IS
  'Phase H.5: Read-only project spine view. Joins project_instances with types and phase definitions.';

-- -------------------------------------------------------
-- 2. v_work_items — clean work items view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW core.v_work_items AS
SELECT
  wic.id,
  wic.legacy_work_item_id,
  wic.work_package_id,
  wp.workstream,
  wic.project_instance_id,
  wic.title,
  wic.description,
  wic.status,
  wic.priority,
  wic.start_date,
  wic.end_date,
  wic.percent_complete,
  wic.is_milestone,
  wic.parent_id,
  wic.sort_order,
  owner_p.name_canonical AS owner_name,
  wic.created_at,
  wic.updated_at
FROM core.work_items_clean wic
LEFT JOIN core.work_packages wp ON wp.id = wic.work_package_id
LEFT JOIN core.parties owner_p ON owner_p.id = wic.assigned_to_party_id;

COMMENT ON VIEW core.v_work_items IS
  'Phase H.5: Read-only clean work items view with workstream and owner name.';

-- -------------------------------------------------------
-- 3. v_finance_records — unified finance view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW finance.v_finance_records AS
SELECT
  fr.id,
  fr.legacy_entity_id,
  fr.legacy_entity_table,
  fr.project_instance_id,
  p_proj.project_name,
  fr.financial_type,
  fr.direction,
  fr.title,
  fr.amount_ex_vat,
  fr.vat_amount,
  fr.currency,
  fr.status,
  party.name_canonical AS counterparty_name,
  fp.period_name AS fiscal_period_name,
  fr.import_source,
  fr.has_frontend_override,
  fr.record_data,
  fr.created_at,
  fr.updated_at
FROM finance.finance_records fr
LEFT JOIN core.project_instances pi ON pi.id = fr.project_instance_id
LEFT JOIN core.projects p_proj ON p_proj.id = pi.legacy_project_id
LEFT JOIN core.parties party ON party.id = fr.party_id
LEFT JOIN finance.fiscal_periods fp ON fp.id = fr.fiscal_period_id;

COMMENT ON VIEW finance.v_finance_records IS
  'Phase H.5: Read-only unified finance view with project name, counterparty, and fiscal period.';

-- -------------------------------------------------------
-- 4. v_deliverables — unified deliverables view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW core.v_deliverables AS
SELECT
  di.id,
  di.legacy_deliverable_id,
  di.legacy_deliverable_table,
  di.project_instance_id,
  dd.name AS definition_name,
  dd.applies_to_scope,
  di.title,
  di.status,
  di.current_version,
  di.completed_at,
  owner_p.name_canonical AS owner_name,
  reviewer_p.name_canonical AS reviewer_name,
  di.deliverable_data,
  di.created_at,
  di.updated_at
FROM core.deliverable_instances di
LEFT JOIN core.deliverable_definitions dd ON dd.id = di.deliverable_definition_id
LEFT JOIN core.parties owner_p ON owner_p.id = di.owner_party_id
LEFT JOIN core.parties reviewer_p ON reviewer_p.id = di.reviewer_party_id;

COMMENT ON VIEW core.v_deliverables IS
  'Phase H.5: Read-only deliverables view with definition name, owner, and reviewer.';

-- -------------------------------------------------------
-- 5. v_approvals — unified approvals view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW core.v_approvals AS
SELECT
  ai.id,
  ai.legacy_approval_id,
  ai.legacy_approval_table,
  ai.project_instance_id,
  ai.entity_type,
  ai.entity_id,
  ai.status,
  ai.title,
  ai.urgency,
  req_p.name_canonical AS requested_by_name,
  dec_p.name_canonical AS decided_by_name,
  ai.decision_note,
  ai.requested_at,
  ai.decided_at,
  ai.due_date,
  ai.approval_data,
  ai.created_at,
  ai.updated_at
FROM core.approval_instances ai
LEFT JOIN core.parties req_p ON req_p.id = ai.requested_by_party_id
LEFT JOIN core.parties dec_p ON dec_p.id = ai.decided_by_party_id;

COMMENT ON VIEW core.v_approvals IS
  'Phase H.5: Read-only approvals view with requester and decider names.';

-- -------------------------------------------------------
-- 6. v_governed_processes — governance view
-- -------------------------------------------------------
CREATE OR REPLACE VIEW core.v_governed_processes AS
SELECT
  gp.id,
  gp.legacy_entity_id,
  gp.legacy_entity_table,
  gp.project_instance_id,
  gp.process_type,
  gp.status,
  gp.title,
  pd.code AS phase_code,
  pd.name AS phase_name,
  owner_p.name_canonical AS owner_name,
  reviewer_p.name_canonical AS reviewer_name,
  gp.started_at,
  gp.completed_at,
  gp.process_data,
  gp.created_at,
  gp.updated_at
FROM core.governed_processes gp
LEFT JOIN core.phase_definitions pd ON pd.id = gp.phase_definition_id
LEFT JOIN core.parties owner_p ON owner_p.id = gp.owner_party_id
LEFT JOIN core.parties reviewer_p ON reviewer_p.id = gp.reviewer_party_id;

COMMENT ON VIEW core.v_governed_processes IS
  'Phase H.5: Read-only governed processes view with phase, owner, and reviewer names.';

COMMIT;
