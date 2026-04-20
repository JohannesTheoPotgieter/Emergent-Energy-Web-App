-- ============================================================================
-- Rollback for 20260414_backfill_ncl_budget_from_pe.sql
-- ============================================================================
--
-- Re-NULLs the four budget columns on NCL rows that were populated by the
-- forward migration. Only affects rows where source_sheet='program_expense'
-- and effective_to IS NULL — the exact scope the forward migration touched.
--
-- ⚠️ CAUTION ⚠️
-- -------------
-- This rollback does not distinguish between values that the forward
-- migration wrote and values that later write paths (smart-import v2
-- re-imports of a rebuilt project, inline edits, etc.) may have written
-- since. Running this rollback will clear ALL four budget columns on any
-- in-scope row regardless of provenance.
--
-- Only run this inside a short rollback window immediately after the
-- forward migration, before any other write path has touched those rows.
-- Outside that window the data loss is no longer bounded to the backfill's
-- effect.
--
-- There is no emitter of source_sheet='program_expense' except the
-- procurement-analysis rebuild in server/subcontractor-routes.ts, so in
-- practice "later writes to these rows" means (a) someone re-ran the
-- rebuild endpoint, which soft-closes and replaces these rows with fresh
-- ones (the old rows are no longer effective_to IS NULL, so this rollback
-- skips them — safe), or (b) someone re-imported one of the 14 legacy
-- projects via v2 smart-import, which also soft-closes the rebuilt row
-- and replaces it with a v2 row whose source_sheet is no longer
-- 'program_expense' (safe — this rollback also skips those). So in
-- normal operation this rollback is actually fairly well-behaved, but
-- keep the caveat in mind for non-standard edit paths.
-- ============================================================================

BEGIN;

UPDATE normalized_cost_lines
SET
  budget_qty   = NULL,
  budget_rate  = NULL,
  budget_total = NULL,
  budget_cos   = NULL
WHERE source_sheet = 'program_expense'
  AND effective_to IS NULL;

COMMIT;
