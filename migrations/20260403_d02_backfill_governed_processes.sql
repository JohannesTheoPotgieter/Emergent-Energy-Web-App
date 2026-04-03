-- Backfill: 20260403_d02_backfill_governed_processes.sql
-- Phase D.2: Populate core.governed_processes from 6 source tables.
-- Each source becomes a distinct process_type with type-specific process_data JSONB.
-- Idempotent: ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING.
-- Must run AFTER: 20260403_d01_create_governed_processes.sql
BEGIN;

-- -------------------------------------------------------
-- 1. pd_to_pm_handover (from project_pd_pm_handover)
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, status, title, started_at, completed_at,
  process_data, created_at, updated_at
)
SELECT
  h.id,
  'project_pd_pm_handover',
  pi.id,
  'pd_to_pm_handover',
  LOWER(h.status),
  'PD → PM Handover',
  h.created_at,
  h.accepted_at,
  jsonb_build_object(
    'pd_owner', h.pd_owner,
    'pm_owner', h.pm_owner,
    'readiness_score', h.readiness_score,
    'pd_sign_off_at', h.pd_sign_off_at,
    'pm_sign_off_at', h.pm_sign_off_at,
    'summary', h.summary,
    'risks', h.risks,
    'assumptions', h.assumptions,
    'version', h.version
  ),
  h.created_at,
  h.updated_at
FROM project_pd_pm_handover h
JOIN core.projects p ON p.legacy_project_info_id = h.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. financial_review (from project_financial_reviews)
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, status, title, started_at, completed_at,
  process_data, created_at, updated_at
)
SELECT
  fr.id,
  'project_financial_reviews',
  pi.id,
  'financial_review',
  LOWER(fr.status),
  'Financial Review',
  fr.created_at,
  fr.approved_at,
  jsonb_build_object(
    'snapshot_budget_total', fr.snapshot_budget_total,
    'snapshot_actual_total', fr.snapshot_actual_total,
    'snapshot_variance', fr.snapshot_variance,
    'snapshot_variance_pct', fr.snapshot_variance_pct,
    'snapshot_margin', fr.snapshot_margin,
    'review_date', fr.review_date,
    'outcome', fr.outcome,
    'outcome_conditions', fr.outcome_conditions,
    'version', fr.version
  ),
  fr.created_at,
  fr.updated_at
FROM project_financial_reviews fr
JOIN core.projects p ON p.legacy_project_info_id = fr.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE fr.deleted_at IS NULL
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. phase_gate_review (from project_gate_evaluations)
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, status, title, started_at, completed_at,
  process_data, created_at
)
SELECT
  ge.id,
  'project_gate_evaluations',
  pi.id,
  'phase_gate_review',
  LOWER(ge.status),
  'Gate: ' || COALESCE(ge.gate_name, 'Unknown'),
  ge.evaluated_at,
  ge.evaluated_at,
  jsonb_build_object(
    'gate_name', ge.gate_name,
    'from_stage', ge.from_stage,
    'target_stage', ge.target_stage,
    'missing_items', ge.missing_items,
    'has_override', ge.has_override,
    'override_id', ge.override_id,
    'evaluated_by_role', ge.evaluated_by_role
  ),
  ge.evaluated_at
FROM project_gate_evaluations ge
JOIN core.projects p ON p.legacy_project_info_id = ge.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 4. gate_exception (from project_stage_exceptions)
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, status, title, started_at, completed_at,
  process_data, created_at, updated_at
)
SELECT
  se.id,
  'project_stage_exceptions',
  pi.id,
  'gate_exception',
  LOWER(se.status),
  'Exception: ' || se.stage_code || COALESCE(' - ' || se.requirement_code, ''),
  se.created_at,
  se.closed_at,
  jsonb_build_object(
    'stage_code', se.stage_code,
    'requirement_code', se.requirement_code,
    'reason_text', se.reason_text,
    'risk_level', se.risk_level,
    'mitigation_text', se.mitigation_text,
    'conditions_text', se.conditions_text,
    'closeout_due_date', se.closeout_due_date,
    'downstream_blocking_stage', se.downstream_blocking_stage
  ),
  se.created_at,
  se.updated_at
FROM project_stage_exceptions se
JOIN core.projects p ON p.legacy_project_info_id = se.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 5. change_request (from change_requests)
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table, project_instance_id,
  process_type, status, title, started_at, completed_at,
  process_data, created_at, updated_at
)
SELECT
  cr.id,
  'change_requests',
  pi.id,
  'change_request',
  LOWER(cr.status),
  cr.title,
  cr.created_at,
  CASE WHEN cr.status IN ('closed', 'implemented') THEN cr.updated_at END,
  jsonb_build_object(
    'change_type', cr.change_type,
    'description', cr.description,
    'impact_summary', cr.impact_summary,
    'cost_impact', cr.cost_impact,
    'schedule_impact', cr.schedule_impact,
    'revenue_impact', cr.revenue_impact,
    'cos_impact', cr.cos_impact,
    'margin_impact', cr.margin_impact,
    'client_linked', cr.client_linked,
    'final_decision', cr.final_decision
  ),
  cr.created_at,
  cr.updated_at
FROM change_requests cr
JOIN core.projects p ON p.legacy_project_info_id = cr.project_id
JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE cr.deleted_at IS NULL
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 6. payment_batch (from payment_batches)
-- Note: payment_batches may not have project_id — project_instance_id left NULL
-- -------------------------------------------------------
INSERT INTO core.governed_processes (
  legacy_entity_id, legacy_entity_table,
  process_type, status, title, started_at, completed_at,
  process_data, created_at, updated_at
)
SELECT
  pb.id,
  'payment_batches',
  'payment_batch',
  LOWER(pb.status),
  'Payment Batch: ' || pb.batch_number,
  pb.created_at,
  COALESCE(pb.confirmed_at, pb.released_at, pb.approved_at),
  jsonb_build_object(
    'batch_number', pb.batch_number,
    'cutoff_date', pb.cutoff_date,
    'total_amount', pb.total_amount,
    'item_count', pb.item_count
  ),
  pb.created_at,
  pb.updated_at
FROM payment_batches pb
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 7. Resolve owner_party_id and reviewer_party_id where possible
-- -------------------------------------------------------

-- Handover: owner = PD user (requested_by/submitted_by not available, use project PD)
-- Financial review: reviewer = approved_by_user_id
UPDATE core.governed_processes gp
SET reviewer_party_id = ua.party_id
FROM project_financial_reviews fr
JOIN core.user_accounts ua ON ua.legacy_user_id = fr.approved_by_user_id
WHERE gp.legacy_entity_table = 'project_financial_reviews'
  AND gp.legacy_entity_id = fr.id
  AND fr.approved_by_user_id IS NOT NULL
  AND gp.reviewer_party_id IS NULL;

-- Gate evaluations: owner = evaluated_by_user_id
UPDATE core.governed_processes gp
SET owner_party_id = ua.party_id
FROM project_gate_evaluations ge
JOIN core.user_accounts ua ON ua.legacy_user_id = ge.evaluated_by_user_id
WHERE gp.legacy_entity_table = 'project_gate_evaluations'
  AND gp.legacy_entity_id = ge.id
  AND ge.evaluated_by_user_id IS NOT NULL
  AND gp.owner_party_id IS NULL;

-- Gate exceptions: owner = owner_user_id, reviewer = approver_user_id
UPDATE core.governed_processes gp
SET owner_party_id = ua_owner.party_id
FROM project_stage_exceptions se
JOIN core.user_accounts ua_owner ON ua_owner.legacy_user_id = se.owner_user_id
WHERE gp.legacy_entity_table = 'project_stage_exceptions'
  AND gp.legacy_entity_id = se.id
  AND se.owner_user_id IS NOT NULL
  AND gp.owner_party_id IS NULL;

UPDATE core.governed_processes gp
SET reviewer_party_id = ua_rev.party_id
FROM project_stage_exceptions se
JOIN core.user_accounts ua_rev ON ua_rev.legacy_user_id = se.approver_user_id
WHERE gp.legacy_entity_table = 'project_stage_exceptions'
  AND gp.legacy_entity_id = se.id
  AND se.approver_user_id IS NOT NULL
  AND gp.reviewer_party_id IS NULL;

-- Change requests: owner = owner_user_id, reviewer = requested_by (requester)
UPDATE core.governed_processes gp
SET owner_party_id = ua.party_id
FROM change_requests cr
JOIN core.user_accounts ua ON ua.legacy_user_id = cr.owner_user_id
WHERE gp.legacy_entity_table = 'change_requests'
  AND gp.legacy_entity_id = cr.id
  AND cr.owner_user_id IS NOT NULL
  AND gp.owner_party_id IS NULL;

-- Payment batches: owner = prepared_by_user_id, reviewer = approved_by_user_id
UPDATE core.governed_processes gp
SET owner_party_id = ua.party_id
FROM payment_batches pb
JOIN core.user_accounts ua ON ua.legacy_user_id = pb.prepared_by_user_id
WHERE gp.legacy_entity_table = 'payment_batches'
  AND gp.legacy_entity_id = pb.id
  AND pb.prepared_by_user_id IS NOT NULL
  AND gp.owner_party_id IS NULL;

UPDATE core.governed_processes gp
SET reviewer_party_id = ua.party_id
FROM payment_batches pb
JOIN core.user_accounts ua ON ua.legacy_user_id = pb.approved_by_user_id
WHERE gp.legacy_entity_table = 'payment_batches'
  AND gp.legacy_entity_id = pb.id
  AND pb.approved_by_user_id IS NOT NULL
  AND gp.reviewer_party_id IS NULL;

COMMIT;
