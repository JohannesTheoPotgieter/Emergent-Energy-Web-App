-- Two-sheet canonical source — idempotency hard guarantee.
--
-- Makes duplicate reproduced lines PHYSICALLY IMPOSSIBLE: at most one live,
-- non-deleted row per stable identity key. Identity is the frozen § 3.5
-- business-key `row_hash` (NOT changed here) — this only enforces uniqueness
-- on it. A re-import that re-derives the same hash can therefore only
-- UPDATE / soft-close+re-insert, never silently append a second copy.
--
-- SELF-HEALING: any duplicate ACTIVE rows that already exist (today's drift —
-- the R52m / R89m double-count) are soft-closed here, keeping the newest
-- version per key, so the unique index can be created on dirty data without
-- failing the deploy. Soft-close (effective_to set) is reversible and
-- audit-preserving — no rows are hard-deleted.
--
-- Additive + dual-mode (Postgres prod + SQLite dev): IF NOT EXISTS guards,
-- bare (unqualified) column names in the partial-index predicate, and
-- CURRENT_TIMESTAMP (no Postgres-only now()).

-- ── normalized_cost_lines: heal active duplicates, keep newest id per key ──
UPDATE normalized_cost_lines
SET effective_to = CURRENT_TIMESTAMP
WHERE effective_to IS NULL
  AND deleted_at IS NULL
  AND row_hash IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id) FROM normalized_cost_lines
    WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL
    GROUP BY project_id, row_hash
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "normalized_cost_lines_row_hash_unique_idx"
  ON "normalized_cost_lines" ("project_id","row_hash")
  WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL;
--> statement-breakpoint

-- ── normalized_revenue_lines: heal active duplicates, keep newest id per key ──
UPDATE normalized_revenue_lines
SET effective_to = CURRENT_TIMESTAMP
WHERE effective_to IS NULL
  AND deleted_at IS NULL
  AND row_hash IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id) FROM normalized_revenue_lines
    WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL
    GROUP BY project_id, row_hash
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "normalized_revenue_lines_row_hash_unique_idx"
  ON "normalized_revenue_lines" ("project_id","row_hash")
  WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL;
--> statement-breakpoint

-- ── normalized_cost_line_actuals: keyed on (cost_line_id, row_hash) ──
UPDATE normalized_cost_line_actuals
SET effective_to = CURRENT_TIMESTAMP
WHERE effective_to IS NULL
  AND deleted_at IS NULL
  AND row_hash IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id) FROM normalized_cost_line_actuals
    WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL
    GROUP BY cost_line_id, row_hash
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "normalized_cost_line_actuals_row_hash_unique_idx"
  ON "normalized_cost_line_actuals" ("cost_line_id","row_hash")
  WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL;
