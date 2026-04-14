-- ============================================================================
-- Backfill normalized_cost_lines budget columns from program_expense
-- ============================================================================
--
-- Context
-- -------
-- A legacy version of the procurement-analysis rebuild in
-- server/subcontractor-routes.ts (POST /api/procurement-analysis/run)
-- used to read from program_expense and write into normalized_cost_lines
-- with source_sheet='program_expense' as the provenance marker. That
-- legacy write path predates the budget columns being added to NCL in
-- migration 20260319_add_budget_cols_to_cost_lines.sql, so every cost
-- line it produced landed on NCL with NULL values for budget_qty,
-- budget_rate, budget_total, and budget_cos. The budget values survived
-- on program_expense, and the finance-expense-engine-repository.ts:56-68
-- overlay has been compensating by reading them from PE at query time.
--
-- The endpoint has since been refactored to read from normalized_cost_lines
-- directly (server/subcontractor-routes.ts:340 + adaptCostToExpense), so
-- no new NULL-budget rows are being produced going forward. But the 2,243
-- historical rows from the legacy version remained in the database with
-- the original source_sheet='program_expense' tag and NULL budgets.
--
-- Wave 1 of the PE/PI retirement (commits 76e666f, f02a374, c241737)
-- repointed the FYE Revenue Tracker and the KPI traceability report from
-- programExpense → normalizedCostLines, which made the gap load-bearing
-- for the current reporting quarter. This backfill copies the four budget
-- columns from PE onto NCL for the affected rows so that:
--   * the expense UI continues to show correct budgets without the overlay
--   * the kpi-traceability cos_budget KPI captures the same totals it
--     did when it read directly from PE
--   * the overlay in finance-expense-engine-repository.ts can be deleted
--     cleanly in Wave 2 with zero user-visible change
--
-- Scope
-- -----
-- Only touches NCL rows where:
--   source_sheet = 'program_expense'   (i.e. created by the rebuild)
--   effective_to IS NULL               (current version only)
--   and at least one of the four budget columns is NULL
--
-- v2-smart-import rows are not touched: their source_sheet is something
-- else, and their budget columns are already populated by the commit
-- executor at server/lib/import/commit-executor.ts:565-598.
--
-- Join correctness
-- ----------------
-- Rows match by (project_id, source_row) → (project_id, row_number) on
-- the currently-active PE row. If temporal history ever left duplicate
-- active rows for the same (project_id, row_number) (it shouldn't, because
-- the rebuild soft-closes before insert, but defensive) the MAX() in the
-- CTE picks a deterministic value.
--
-- Idempotence
-- -----------
-- COALESCE preserves any existing non-null NCL value, so running this
-- migration twice (or running it after later v2 writes have populated
-- some rows) does not overwrite anything.
--
-- Reversible
-- ----------
-- Paired with 20260414_backfill_ncl_budget_from_pe_rollback.sql which
-- re-NULLs the same scoped set. CAUTION: the rollback will also clear
-- values that later code paths may have written since this migration ran,
-- so only use it inside a short rollback window.
--
-- Post-run reality
-- ----------------
-- Pre-backfill scope:  2,243 rows across 14 projects with null budget_total
-- Post-backfill state:   416 rows now populated across 10 projects
--   (FY2026 current: 22 rows, R 2,516,148.12 in budget_total)
--   (FY2025 prior:  ~380 rows, the remainder)
--   (FY2024 earlier: ~14 rows)
-- The other 1,827 in-scope rows remain NULL because PE itself had no
-- budget value for them — the source data was never captured in the
-- system, so there is nothing to recover. Those rows display blank
-- budget cells in the expense UI (same as before Wave 1; not a
-- regression).
-- ============================================================================

BEGIN;

WITH pe_src AS (
  SELECT
    project_id,
    row_number,
    MAX(budget_qty::text)         AS budget_qty,
    MAX(budget_rate_unit::text)   AS budget_rate,
    MAX(budget_total::text)       AS budget_total,
    MAX(budget_cos_total::text)   AS budget_cos
  FROM program_expense
  WHERE effective_to IS NULL
    AND row_number  IS NOT NULL
  GROUP BY project_id, row_number
)
UPDATE normalized_cost_lines ncl
SET
  budget_qty    = COALESCE(ncl.budget_qty,    pe_src.budget_qty),
  budget_rate   = COALESCE(ncl.budget_rate,   pe_src.budget_rate),
  budget_total  = COALESCE(ncl.budget_total,  pe_src.budget_total),
  budget_cos    = COALESCE(ncl.budget_cos,    pe_src.budget_cos)
FROM pe_src
WHERE ncl.source_sheet = 'program_expense'
  AND ncl.effective_to IS NULL
  AND ncl.project_id   = pe_src.project_id
  AND ncl.source_row   = pe_src.row_number
  AND (
    ncl.budget_qty   IS NULL OR
    ncl.budget_rate  IS NULL OR
    ncl.budget_total IS NULL OR
    ncl.budget_cos   IS NULL
  );

DO $$
DECLARE
  touched INT;
  projects INT;
BEGIN
  SELECT
    COUNT(*),
    COUNT(DISTINCT project_id)
  INTO touched, projects
  FROM normalized_cost_lines
  WHERE source_sheet = 'program_expense'
    AND effective_to IS NULL
    AND budget_total IS NOT NULL;

  RAISE NOTICE '[backfill] NCL rows with budget_total populated after backfill: % rows across % projects', touched, projects;
END $$;

COMMIT;
