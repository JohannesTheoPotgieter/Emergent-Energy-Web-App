-- Add idempotency_key column to normalized_cost_lines
-- Used by manual expense creation to prevent duplicate rows from
-- double-clicks, browser resends, and network retries.
-- NULL for imported rows (imports use soft-close + re-insert pattern).

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index: only enforce uniqueness where key is non-null.
-- This means imported rows (NULL key) are never constrained,
-- and manual rows with the same idempotency key cannot be duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ncl_idempotency_key
  ON normalized_cost_lines (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
