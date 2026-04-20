-- Backfill 08: State History Tables
-- Populates history tables with initial snapshots from all legacy rows.
-- Uses ROW_NUMBER() to mark the single latest row per entity as is_current = true.
-- All other rows are preserved as historical snapshots with is_current = false.
-- Idempotent via ON CONFLICT DO NOTHING (on composite keys) and WHERE NOT EXISTS guards.
-- Must run AFTER: all forward migrations, backfill_04 (core.projects populated),
--   backfill_05 (document_approvals populated), backfill_07 (finance lines enriched)
BEGIN;

-- ============================================================================
-- 1. Project execution state history — ALL rows, latest marked is_current
-- ============================================================================

-- Insert all project_execution_state rows as history snapshots
INSERT INTO core.project_state_history (
  project_id, legacy_execution_state_id,
  phase, phase_updated_at, phase_notes, current_stage_code, execution_phase,
  execution_gate_status, execution_gate_reason, gate_status, gate_readiness_pct, execution_enabled,
  rag_status, rag_comment, rag_updated_at,
  signed_status, signed_date, cp_signed, cp_signed_date,
  pd_handover_date, construction_start_date, commissioning_date, om_handover_date, client_handover_date,
  construction_start_actual, pd_handover_actual, commissioning_actual, client_handover_actual,
  is_active, archived_status, escalation_level,
  is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
)
SELECT
  cp.id,
  pes.id,
  pes.phase, pes.phase_updated_at, pes.phase_notes,
  pes.current_stage_code, pes.execution_phase,
  pes.execution_gate_status, pes.execution_gate_reason,
  NULL, -- gate_status not on legacy table directly
  NULL, -- gate_readiness_pct — populated via stage lifecycle
  pes.execution_enabled,
  pes.rag_status, pes.rag_comment, pes.rag_updated_at,
  pes.signed_status, pes.signed_date, pes.cp_signed, pes.cp_signed_date,
  pes.pd_handover_date, pes.construction_start_date, pes.commissioning_date,
  pes.om_handover_date, pes.client_handover_date,
  pes.construction_start_actual, pes.pd_handover_actual,
  pes.commissioning_actual, pes.client_handover_actual,
  pes.is_active, pes.archived_status, pes.escalation_level,
  -- Mark as current using deterministic latest-row rule
  (ROW_NUMBER() OVER (
    PARTITION BY pes.project_id
    ORDER BY pes.updated_at DESC NULLS LAST,
             pes.created_at DESC NULLS LAST,
             pes.id DESC
  ) = 1),
  'backfill',
  'public.project_execution_state',
  pes.updated_at,
  NOW()
FROM public.project_execution_state pes
JOIN core.projects cp ON cp.legacy_project_info_id = pes.project_id
WHERE NOT EXISTS (
  SELECT 1 FROM core.project_state_history psh
  WHERE psh.legacy_execution_state_id = pes.id
);

-- ============================================================================
-- 2. Approval state history — ALL approval rows, latest per approval marked
-- ============================================================================

-- Insert all non-deleted approvals as history snapshots
-- Each approval is a single row in legacy (in-place updates), so each gets
-- one snapshot with is_current = true. When bridge writes are enabled in
-- Phase 2, status changes will INSERT new snapshots.
INSERT INTO documentation.approval_state_history (
  approval_id, legacy_approval_id,
  status, decision_note, decided_by, decided_at,
  approval_type, approval_category, title, project_id, urgency,
  is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
)
SELECT
  da.id,
  da.legacy_approval_id,
  da.status,
  da.decision_note,
  da.approver_user_id,
  da.decided_at,
  da.approval_type,
  da.approval_category,
  da.title,
  da.project_id,
  da.urgency,
  true,  -- Each legacy approval has exactly one row, so it is current
  'backfill',
  COALESCE(da.source_table, 'documentation.document_approvals'),
  da.created_at,
  NOW()
FROM documentation.document_approvals da
WHERE da.legacy_approval_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM documentation.approval_state_history ash
    WHERE ash.legacy_approval_id = da.legacy_approval_id
  );

-- ============================================================================
-- 3. Cost line history — ALL cost lines, one snapshot each (current)
-- ============================================================================

INSERT INTO finance.cost_line_history (
  cost_line_id, legacy_program_expense_id,
  project_id, counterparty_name, description,
  amount_ex_vat, invoice_number, invoice_date, approved_date, paid_date,
  status, is_opening_balance, legacy_row_type,
  is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
)
SELECT
  cl.id,
  cl.legacy_program_expense_id,
  cl.project_id, cl.counterparty_name, cl.description,
  cl.amount_ex_vat, cl.invoice_number, cl.invoice_date, cl.approved_date, cl.paid_date,
  cl.status, cl.is_opening_balance, cl.legacy_row_type,
  true,  -- Each cost line has one snapshot at backfill time
  'backfill',
  cl.source_table,
  cl.updated_at,
  NOW()
FROM finance.cost_lines cl
WHERE NOT EXISTS (
  SELECT 1 FROM finance.cost_line_history clh
  WHERE clh.cost_line_id = cl.id AND clh.snapshot_reason = 'backfill'
);

-- ============================================================================
-- 4. Revenue line history — ALL revenue lines, one snapshot each (current)
-- ============================================================================

INSERT INTO finance.revenue_line_history (
  revenue_line_id, legacy_program_inflow_id,
  project_id, milestone_name,
  amount_ex_vat, invoice_number, invoice_date, expected_payment_date, paid_date,
  status, is_opening_balance,
  is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
)
SELECT
  rl.id,
  rl.legacy_program_inflow_id,
  rl.project_id, rl.milestone_name,
  rl.amount_ex_vat, rl.invoice_number, rl.invoice_date, rl.expected_payment_date, rl.paid_date,
  rl.status, rl.is_opening_balance,
  true,  -- Each revenue line has one snapshot at backfill time
  'backfill',
  rl.source_table,
  rl.updated_at,
  NOW()
FROM finance.revenue_lines rl
WHERE NOT EXISTS (
  SELECT 1 FROM finance.revenue_line_history rlh
  WHERE rlh.revenue_line_id = rl.id AND rlh.snapshot_reason = 'backfill'
);

-- ============================================================================
-- INTEGRITY CHECK: Verify exactly one is_current = true per entity
-- ============================================================================
-- This is a read-only check. If it reports violations, the backfill has a bug.

SELECT 'HISTORY_INTEGRITY_CHECK_PROJECTS' AS check_type,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT project_id, COUNT(*) AS current_count
  FROM core.project_state_history
  WHERE is_current = true
  GROUP BY project_id
  HAVING COUNT(*) <> 1
) violations;

SELECT 'HISTORY_INTEGRITY_CHECK_APPROVALS' AS check_type,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT approval_id, COUNT(*) AS current_count
  FROM documentation.approval_state_history
  WHERE is_current = true
  GROUP BY approval_id
  HAVING COUNT(*) <> 1
) violations;

SELECT 'HISTORY_INTEGRITY_CHECK_COST_LINES' AS check_type,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT cost_line_id, COUNT(*) AS current_count
  FROM finance.cost_line_history
  WHERE is_current = true
  GROUP BY cost_line_id
  HAVING COUNT(*) <> 1
) violations;

SELECT 'HISTORY_INTEGRITY_CHECK_REVENUE_LINES' AS check_type,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS violation_count
FROM (
  SELECT revenue_line_id, COUNT(*) AS current_count
  FROM finance.revenue_line_history
  WHERE is_current = true
  GROUP BY revenue_line_id
  HAVING COUNT(*) <> 1
) violations;

COMMIT;
