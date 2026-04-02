-- Migration: 20260402_state_history_tables.sql
-- Phase 1B: Create history/audit tables for all current-state entities.
-- Stores full history of every row pulled from legacy. Each row is a snapshot.
-- The latest snapshot per entity is marked via is_current = true.
-- Reconciliation and summaries use only is_current = true rows.
-- Full history is available for audit, debugging, and change tracking.
--
-- Phase 1B backfill populates the initial snapshot from legacy.
-- Phase 2 bridge writes will INSERT new snapshots on every change,
-- updating is_current flags via triggers or application logic.
BEGIN;

-- ============================================================================
-- 1. Project execution state history
-- Captures every version of project lifecycle/gate/RAG state per project.
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.project_state_history (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES core.projects(id),
  legacy_execution_state_id INTEGER,

  -- Lifecycle fields (mirrors project_execution_state)
  phase TEXT,
  phase_updated_at TIMESTAMPTZ,
  phase_notes TEXT,
  current_stage_code TEXT,
  execution_phase TEXT,

  -- Gate fields
  execution_gate_status TEXT,
  execution_gate_reason TEXT,
  gate_status TEXT,
  gate_readiness_pct NUMERIC(5,2),
  execution_enabled BOOLEAN,

  -- RAG
  rag_status TEXT,
  rag_comment TEXT,
  rag_updated_at TIMESTAMPTZ,

  -- Signing
  signed_status TEXT,
  signed_date TEXT,
  cp_signed BOOLEAN,
  cp_signed_date TEXT,

  -- Key dates (planned)
  pd_handover_date TEXT,
  construction_start_date TEXT,
  commissioning_date TEXT,
  om_handover_date TEXT,
  client_handover_date TEXT,

  -- Key dates (actual)
  construction_start_actual TEXT,
  pd_handover_actual TEXT,
  commissioning_actual TEXT,
  client_handover_actual TEXT,

  -- Active/archived
  is_active BOOLEAN,
  archived_status TEXT,
  escalation_level TEXT,

  -- History metadata
  is_current BOOLEAN NOT NULL DEFAULT false,
  snapshot_reason TEXT NOT NULL DEFAULT 'backfill',
  source_table TEXT NOT NULL DEFAULT 'public.project_execution_state',
  source_updated_at TIMESTAMPTZ,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_state_history_project_current
  ON core.project_state_history (project_id, is_current)
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_project_state_history_project_timeline
  ON core.project_state_history (project_id, snapshot_at DESC);

COMMENT ON TABLE core.project_state_history IS 'Full history of project execution state snapshots. is_current = true marks the single latest row per project. Populated by Phase 1B backfill (initial snapshot) and Phase 2 bridge writes (ongoing changes).';
COMMENT ON COLUMN core.project_state_history.is_current IS 'Exactly one row per project_id must be true. Derived via ROW_NUMBER() during backfill, maintained by bridge writes in Phase 2.';
COMMENT ON COLUMN core.project_state_history.snapshot_reason IS 'Why this snapshot was created: backfill, bridge_write, manual_correction, etc.';

-- ============================================================================
-- 2. Approval state history
-- Captures every version of approval status changes.
-- Legacy approvals are updated in-place; this table preserves each state.
-- ============================================================================
CREATE TABLE IF NOT EXISTS documentation.approval_state_history (
  id BIGSERIAL PRIMARY KEY,
  approval_id INTEGER NOT NULL,
  legacy_approval_id INTEGER,

  -- Approval fields (mirrors public.approvals / document_approvals)
  status TEXT,
  decision_note TEXT,
  decided_by INTEGER,
  decided_at TIMESTAMPTZ,
  approval_type TEXT,
  approval_category TEXT,
  title TEXT,
  project_id INTEGER,
  urgency TEXT,

  -- History metadata
  is_current BOOLEAN NOT NULL DEFAULT false,
  snapshot_reason TEXT NOT NULL DEFAULT 'backfill',
  source_table TEXT NOT NULL DEFAULT 'public.approvals',
  source_updated_at TIMESTAMPTZ,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_state_history_approval_current
  ON documentation.approval_state_history (approval_id, is_current)
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_approval_state_history_legacy_id
  ON documentation.approval_state_history (legacy_approval_id);

COMMENT ON TABLE documentation.approval_state_history IS 'Full history of approval status changes. Each row is a point-in-time snapshot. is_current = true marks the latest state per approval.';

-- ============================================================================
-- 3. Finance line state history
-- Captures every version of cost/revenue line edits.
-- Tracks amount changes, status changes, date corrections, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS finance.cost_line_history (
  id BIGSERIAL PRIMARY KEY,
  cost_line_id BIGINT NOT NULL,
  legacy_program_expense_id INTEGER,

  -- Finance fields (mirrors finance.cost_lines)
  project_id INTEGER,
  counterparty_name TEXT,
  description TEXT,
  amount_ex_vat NUMERIC(15,2),
  invoice_number TEXT,
  invoice_date TEXT,
  approved_date TEXT,
  paid_date TEXT,
  status TEXT,
  is_opening_balance BOOLEAN DEFAULT false,
  legacy_row_type TEXT,

  -- History metadata
  is_current BOOLEAN NOT NULL DEFAULT false,
  snapshot_reason TEXT NOT NULL DEFAULT 'backfill',
  source_table TEXT NOT NULL DEFAULT 'finance.cost_lines',
  source_updated_at TIMESTAMPTZ,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_line_history_line_current
  ON finance.cost_line_history (cost_line_id, is_current)
  WHERE is_current = true;

CREATE TABLE IF NOT EXISTS finance.revenue_line_history (
  id BIGSERIAL PRIMARY KEY,
  revenue_line_id BIGINT NOT NULL,
  legacy_program_inflow_id INTEGER,

  -- Finance fields (mirrors finance.revenue_lines)
  project_id INTEGER,
  milestone_name TEXT,
  amount_ex_vat NUMERIC(15,2),
  invoice_number TEXT,
  invoice_date TEXT,
  expected_payment_date TEXT,
  paid_date TEXT,
  status TEXT,
  is_opening_balance BOOLEAN DEFAULT false,

  -- History metadata
  is_current BOOLEAN NOT NULL DEFAULT false,
  snapshot_reason TEXT NOT NULL DEFAULT 'backfill',
  source_table TEXT NOT NULL DEFAULT 'finance.revenue_lines',
  source_updated_at TIMESTAMPTZ,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_line_history_line_current
  ON finance.revenue_line_history (revenue_line_id, is_current)
  WHERE is_current = true;

COMMENT ON TABLE finance.cost_line_history IS 'Full history of cost line changes. Phase 1B backfill creates initial snapshot. Phase 2 bridge writes capture edits.';
COMMENT ON TABLE finance.revenue_line_history IS 'Full history of revenue line changes. Phase 1B backfill creates initial snapshot. Phase 2 bridge writes capture edits.';

COMMIT;
