-- Migration: 20260403_f02_create_budget_lines.sql
-- Phase F.2: Create finance.budget_lines.
-- Unified budget allocations per project — baselines, FYE budgets, contingency.
-- Additive only. No app code changes. Legacy tables remain untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS finance.budget_lines (
  id                    BIGSERIAL PRIMARY KEY,
  legacy_budget_id      INTEGER,
  legacy_budget_table   TEXT NOT NULL,
  project_instance_id   BIGINT REFERENCES core.project_instances(id),
  budget_type           TEXT NOT NULL,
  category              TEXT,
  period_key            TEXT,
  fiscal_period_id      BIGINT REFERENCES finance.fiscal_periods(id),
  amount                NUMERIC(15,2),
  version               INTEGER NOT NULL DEFAULT 1,
  is_baseline           BOOLEAN NOT NULL DEFAULT false,
  approved_by_party_id  BIGINT REFERENCES core.parties(id),
  budget_data           JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (legacy_budget_table, legacy_budget_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_project_instance_id
  ON finance.budget_lines (project_instance_id);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget_type
  ON finance.budget_lines (budget_type);

CREATE INDEX IF NOT EXISTS idx_budget_lines_fiscal_period_id
  ON finance.budget_lines (fiscal_period_id);

CREATE INDEX IF NOT EXISTS idx_budget_lines_baseline
  ON finance.budget_lines (is_baseline)
  WHERE is_baseline = true;

COMMENT ON TABLE finance.budget_lines IS
  'Phase F.2: Unified budget allocations. Backfilled from budget_baselines and fye_budgets. Supports versioning and baseline locking.';

COMMIT;
