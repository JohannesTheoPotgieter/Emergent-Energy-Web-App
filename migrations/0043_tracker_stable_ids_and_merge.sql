-- =========================================================================
-- Tracker stable IDs + 3-way merge support.
--
-- Background:
--   The Smart Import pipeline currently does a full bulldoze on every
--   re-import: every active row gets soft-closed (effective_to = NOW()),
--   then every row from the new file gets re-inserted with a fresh
--   serial id and effective_from. This means:
--     1. The same logical row gets a brand-new id on every import,
--        breaking foreign-key references and complicating audits.
--     2. Manual edits made in the app are silently overwritten unless
--        they touched one of six specific manual-flag fields.
--     3. Re-importing the same file twice produces duplicate temporal
--        versions even though nothing actually changed.
--
-- This migration adds the storage primitives for the long-term solution
-- (Option D — 3-way merge with stable hash-based row identity):
--
--   * row_hash (text)         — deterministic hash computed from each
--                              row's identity columns. The same logical
--                              row keeps the same hash across re-imports.
--   * import_snapshot (jsonb) — the row exactly as it was written by
--                              the most recent import. Acts as the
--                              "common ancestor" in 3-way merges.
--   * manual_overrides (jsonb) — per-field metadata about manual edits
--                              (value, who, when), so the merge engine
--                              can decide whether to surface a conflict.
--
--   * Partial indexes on (project_id, row_hash) WHERE active filter,
--     for the merge engine to look up an incoming row in O(log n).
--
-- The actual hashing logic, merge engine and conflict-resolution UI
-- land in subsequent commits on this branch. This migration is purely
-- additive storage prep — old code paths continue to work because every
-- new column is nullable.
--
-- Idempotent: every statement uses IF NOT EXISTS, safe to re-run.
-- =========================================================================

-- normalized_revenue_lines
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "row_hash" text;
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "import_snapshot" jsonb;
ALTER TABLE "normalized_revenue_lines" ADD COLUMN IF NOT EXISTS "manual_overrides" jsonb;
CREATE INDEX IF NOT EXISTS "normalized_revenue_lines_row_hash_active_idx"
    ON "normalized_revenue_lines" USING btree ("project_id","row_hash")
    WHERE "effective_to" IS NULL;

-- normalized_cost_lines
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "row_hash" text;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "import_snapshot" jsonb;
ALTER TABLE "normalized_cost_lines" ADD COLUMN IF NOT EXISTS "manual_overrides" jsonb;
CREATE INDEX IF NOT EXISTS "normalized_cost_lines_row_hash_active_idx"
    ON "normalized_cost_lines" USING btree ("project_id","row_hash")
    WHERE "effective_to" IS NULL;

-- normalized_cost_line_actuals (the 1:N child added in PR1)
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "row_hash" text;
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "import_snapshot" jsonb;
ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "manual_overrides" jsonb;
CREATE INDEX IF NOT EXISTS "normalized_cost_line_actuals_row_hash_active_idx"
    ON "normalized_cost_line_actuals" USING btree ("cost_line_id","row_hash")
    WHERE "effective_to" IS NULL;

-- work_items (canonical PLAN store; uses deleted_at soft-delete rather
-- than the effective_from/to temporal model)
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "row_hash" text;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "import_snapshot" jsonb;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "manual_overrides" jsonb;
CREATE INDEX IF NOT EXISTS "work_items_row_hash_active_idx"
    ON "work_items" USING btree ("project_id","row_hash")
    WHERE "deleted_at" IS NULL;
