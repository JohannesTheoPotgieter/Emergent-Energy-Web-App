-- =========================================================================
-- DF-17 / DF-18 / DF-19 — Additive finance columns from audit V2.
--
-- Each column is nullable and additive. The migration is safe to apply on
-- existing data: no rows are rewritten, no constraints are introduced
-- that would reject historical rows. The application keeps reading the
-- existing columns; reading the new columns happens in follow-up PRs
-- once the writer paths are extended.
--
-- DF-17 — Partial-payment tracking. Today the app derives a "partial"
-- status from the QB recon balance dynamically. Persisting the QB-paid
-- amount on the app row lets the cashflow page show R600k received /
-- R400k outstanding without needing the QB recon layer to be queried
-- every time.
--
-- DF-18 — Multi-currency. Today the schema has `usd_exchange_rate` only;
-- non-ZAR / non-USD currencies are silently treated as ZAR. Adding
-- `currency_code` lets the app distinguish ZAR vs USD vs other currencies
-- and apply the rate where appropriate. Default 'ZAR' keeps existing
-- behaviour for unmigrated rows.
--
-- DF-19 — VAT rate metadata. Today the schema captures `vat` (amount)
-- but not the rate or rate-change date. Adding `vat_rate_pct` +
-- `vat_changed_at` lets historical lines retain their VAT context
-- through rate changes (e.g. SA 15% -> 16%).
--
-- This migration is NOT applied automatically — per § 6 of
-- docs/AGENT_GUARDRAILS.md, db:migrate requires explicit per-session
-- approval. Apply with:
--   npm run db:migrate
--
-- After applying, follow-up PRs can:
--   - Extend the Smart Import normalizer to populate `currency_code`
--     and `vat_rate_pct` from the workbook
--   - Update the QB reconciliation service to write `qb_partial_paid_ex_vat`
--     when a partial payment is detected
--   - Add UI display in the milestone tracker / cashflow page
-- =========================================================================

-- DF-17: partial-payment amount on cost lines
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS qb_partial_paid_ex_vat NUMERIC(15, 2);

-- DF-17: partial-payment amount on revenue lines
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS qb_partial_paid_ex_vat NUMERIC(15, 2);

-- DF-17: same on the actuals child (where line-level payment info lives)
ALTER TABLE normalized_cost_line_actuals
  ADD COLUMN IF NOT EXISTS qb_partial_paid_ex_vat NUMERIC(15, 2);

-- DF-18: currency code on cost lines (ZAR default keeps backward compat)
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';

-- DF-18: currency code on revenue lines
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';

-- DF-18: currency code on the actuals child
ALTER TABLE normalized_cost_line_actuals
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';

-- DF-19: VAT rate (percent) on cost lines. Nullable — historical rows
-- without explicit rate metadata stay null; readers infer 15% only when
-- they need to.
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS vat_rate_pct NUMERIC(5, 2);

-- DF-19: VAT rate on revenue lines
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS vat_rate_pct NUMERIC(5, 2);

-- DF-19: when the VAT rate was last set / changed (audit). Nullable.
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS vat_changed_at TIMESTAMP;

ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS vat_changed_at TIMESTAMP;

-- Indexes for currency filtering (optional but cheap). Cost/revenue
-- aggregates currently scan all-ZAR rows; once non-ZAR lines exist, an
-- index on currency_code speeds up the "ZAR-only" or "USD-only" reads.
CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_currency
  ON normalized_cost_lines (currency_code);
CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_currency
  ON normalized_revenue_lines (currency_code);
