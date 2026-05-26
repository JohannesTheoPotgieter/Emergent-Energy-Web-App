-- =========================================================================
-- F-5 — Defence-in-depth CHECK constraint on future paidDate
--
-- Per AGENT_GUARDRAILS § 3.7: "App-side actuals fields receive ACTUAL dates
-- only. Planned dates do not flow into the app's actuals." A `paid_date`
-- in the future is by definition not an actual — it belongs in
-- `forecast_payment_date`.
--
-- The Smart Import normalizer already follows this rule. The route-boundary
-- Zod refinement on /api/finance/cost-lines and /api/finance/revenue-lines
-- (added in PR #943) also catches manual writes. This migration is the third
-- layer — a DB constraint that any future code path can rely on.
--
-- IMPORTANT: applied with NOT VALID so the migration does not block on
-- historical data that may already contain future-dated paid_date rows.
-- The constraint applies to all new INSERTs/UPDATEs immediately.
--
-- Operator hand-off (apply this AFTER reviewing existing data):
--
--   -- 1. Audit existing rows. If any return non-zero, fix them first.
--   SELECT id, project_id, paid_date
--     FROM normalized_cost_lines
--    WHERE paid_date > CURRENT_DATE
--      AND effective_to IS NULL AND deleted_at IS NULL;
--
--   SELECT id, project_id, paid_date
--     FROM normalized_revenue_lines
--    WHERE paid_date > CURRENT_DATE
--      AND effective_to IS NULL AND deleted_at IS NULL;
--
--   SELECT id, parent_id, finance_payment_date
--     FROM normalized_cost_line_actuals
--    WHERE finance_payment_date > CURRENT_DATE
--      AND effective_to IS NULL AND deleted_at IS NULL;
--
--   -- 2. After existing rows are clean, re-validate the constraint:
--   ALTER TABLE normalized_cost_lines
--       VALIDATE CONSTRAINT chk_normalized_cost_lines_paid_date_not_future;
--   ALTER TABLE normalized_revenue_lines
--       VALIDATE CONSTRAINT chk_normalized_revenue_lines_paid_date_not_future;
--   ALTER TABLE normalized_cost_line_actuals
--       VALIDATE CONSTRAINT chk_normalized_cost_line_actuals_finance_payment_date_not_future;
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_normalized_cost_lines_paid_date_not_future'
  ) THEN
    ALTER TABLE normalized_cost_lines
      ADD CONSTRAINT chk_normalized_cost_lines_paid_date_not_future
      CHECK (paid_date IS NULL OR paid_date <= CURRENT_DATE)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_normalized_revenue_lines_paid_date_not_future'
  ) THEN
    ALTER TABLE normalized_revenue_lines
      ADD CONSTRAINT chk_normalized_revenue_lines_paid_date_not_future
      CHECK (paid_date IS NULL OR paid_date <= CURRENT_DATE)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_normalized_cost_line_actuals_finance_payment_date_not_future'
  ) THEN
    ALTER TABLE normalized_cost_line_actuals
      ADD CONSTRAINT chk_normalized_cost_line_actuals_finance_payment_date_not_future
      CHECK (finance_payment_date IS NULL OR finance_payment_date <= CURRENT_DATE)
      NOT VALID;
  END IF;
END $$;
