-- Financial Review Gate: structured review table, execution state extensions, and gate seed data
-- This gate replaces the lightweight "Site Start" gate on PROCUREMENT → CONSTRUCTION

-- ===================== NEW TABLE: project_financial_reviews =====================

CREATE TABLE IF NOT EXISTS project_financial_reviews (
  id                              SERIAL PRIMARY KEY,
  project_id                      INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,

  -- Review lifecycle
  status                          TEXT NOT NULL DEFAULT 'DRAFT',
  version                         INTEGER NOT NULL DEFAULT 1,

  -- Financial snapshot (captured at creation, refreshable)
  budget_baseline_id              INTEGER REFERENCES budget_baselines(id),
  snapshot_budget_total            DECIMAL(15,2),
  snapshot_actual_total            DECIMAL(15,2),
  snapshot_variance                DECIMAL(15,2),
  snapshot_variance_pct            DECIMAL(8,4),
  snapshot_margin                  DECIMAL(8,4),
  snapshot_contingency_remaining   DECIMAL(15,2),
  snapshot_procurement_readiness   REAL,
  snapshot_data                    JSONB NOT NULL DEFAULT '{}',
  snapshot_captured_at             TIMESTAMP,

  -- Review meeting
  review_date                     DATE,
  review_meeting_ref              TEXT,

  -- Participants: [{userId, name, role, attended, signedOff}]
  participants                    JSONB NOT NULL DEFAULT '[]',

  -- Five structured review sections
  budget_review                   JSONB NOT NULL DEFAULT '{}',
  procurement_review              JSONB NOT NULL DEFAULT '{}',
  scope_review                    JSONB NOT NULL DEFAULT '{}',
  logistics_review                JSONB NOT NULL DEFAULT '{}',
  hse_review                      JSONB NOT NULL DEFAULT '{}',

  -- Overall outcome
  outcome                         TEXT,
  outcome_conditions              TEXT,
  outcome_notes                   TEXT,

  -- Approval chain
  requested_by_user_id            INTEGER REFERENCES users(id),
  reviewed_by_user_id             INTEGER REFERENCES users(id),
  approved_by_user_id             INTEGER REFERENCES users(id),
  approved_at                     TIMESTAMP,

  -- Links to canonical systems
  approval_id                     INTEGER REFERENCES approvals(id),
  gate_evaluation_id              INTEGER REFERENCES project_gate_evaluations(id),

  created_at                      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at                      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_reviews_project_status
  ON project_financial_reviews(project_id, status);

-- ===================== EXTEND project_execution_state =====================

ALTER TABLE project_execution_state
  ADD COLUMN IF NOT EXISTS site_establishment_date TEXT,
  ADD COLUMN IF NOT EXISTS site_establishment_actual TEXT,
  ADD COLUMN IF NOT EXISTS financial_review_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS financial_review_id INTEGER REFERENCES project_financial_reviews(id);

-- ===================== DEACTIVATE OLD "Site Start" GATE =====================

UPDATE stage_gate_definitions
SET is_active = false
WHERE gate_name = 'Site Start'
  AND from_stage = 'PROCUREMENT'
  AND target_stage = 'CONSTRUCTION';

-- ===================== SEED NEW "Financial Review Gate" =====================

INSERT INTO stage_gate_definitions
  (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, sort_order)
VALUES
  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_field', 'construction_manager',
   '{"field":"constructionManagerUserId","label":"Construction manager assigned"}', true, 1),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_field', 'site_linked',
   '{"field":"siteId","label":"Site linked"}', true, 2),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_linked_record', 'budget_baseline_locked',
   '{"table":"budget_baselines","field":"change_locked","expected":true,"label":"Budget baseline locked"}', true, 3),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_approval', 'financial_review_approved',
   '{"approvalCategory":"financial_review","label":"Financial Review Gate approved"}', true, 4),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_role_signoff', 'finance_signoff',
   '{"role":"CFO","approvalCategory":"financial_review_finance","label":"Finance sign-off"}', true, 5),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_role_signoff', 'pm_signoff',
   '{"role":"PROGRAM_MANAGER","approvalCategory":"financial_review_pm","label":"Programme Manager sign-off"}', true, 6),

  ('Financial Review Gate', 'PROCUREMENT', 'CONSTRUCTION', 'required_field', 'site_establishment_date',
   '{"field":"siteEstablishmentDate","label":"Site establishment date planned"}', true, 7)
ON CONFLICT DO NOTHING;
