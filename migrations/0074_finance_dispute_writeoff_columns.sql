-- =========================================================================
-- TF-7 (Disputed invoice workflow) + TF-8 (Bad-debt write-off workflow)
-- from audit/FINANCE_AUDIT_V3_2026-05-26.md.
--
-- Owner-approved 2026-05-26.
--
-- Additive only:
--   1. Extend revenue_line_status enum with 'disputed' and 'written_off'.
--   2. Extend cost_line_status enum with 'disputed'.
--   3. Add dispute_opened_at / dispute_resolved_at / dispute_reason /
--      dispute_opened_by_user_id to both normalized_cost_lines and
--      normalized_revenue_lines.
--   4. Add write_off_authorised_by_user_id / write_off_authorised_at /
--      write_off_reason to normalized_revenue_lines (write-off is a
--      revenue-side concept — bad debt = customer who doesn't pay).
--
-- The new statuses are opt-in: existing lines remain unchanged. The
-- new columns are nullable. The migration is safe to apply on existing
-- data without backfill.
--
-- NOT applied automatically — needs `npm run db:migrate` approval per
-- § 6 of docs/AGENT_GUARDRAILS.md.
-- =========================================================================

-- 1. Add new revenue-line statuses
ALTER TYPE revenue_line_status ADD VALUE IF NOT EXISTS 'disputed';
ALTER TYPE revenue_line_status ADD VALUE IF NOT EXISTS 'written_off';

-- 2. Add new cost-line status
ALTER TYPE cost_line_status ADD VALUE IF NOT EXISTS 'disputed';

-- 3. Dispute metadata on revenue lines
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS dispute_opened_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Dispute metadata on cost lines (vendor-invoice disputes)
ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS dispute_opened_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 4. Write-off metadata on revenue lines (bad-debt path)
ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS write_off_authorised_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS write_off_authorised_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS write_off_reason TEXT;

-- Filter indexes — speeds up "give me overdue AR excluding disputes"
-- and "give me write-offs in FY26" queries.
CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_dispute_open
  ON normalized_revenue_lines (project_id, dispute_resolved_at)
  WHERE dispute_opened_at IS NOT NULL AND dispute_resolved_at IS NULL AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_dispute_open
  ON normalized_cost_lines (project_id, dispute_resolved_at)
  WHERE dispute_opened_at IS NOT NULL AND dispute_resolved_at IS NULL AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_write_off
  ON normalized_revenue_lines (project_id, write_off_authorised_at)
  WHERE write_off_authorised_at IS NOT NULL AND effective_to IS NULL;
