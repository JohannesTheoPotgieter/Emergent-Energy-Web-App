-- Mondi (project_id = 281) recovery for the 2026-05-15 bulk soft-delete.
-- Run AFTER migration 0066 has been applied on the target DB, otherwise
-- the next Smart Import will still hit SQLSTATE 23505 on every PLAN row.
--
-- Steps:
--   1. Preview which rows will be restored (read-only).
--   2. Restore them in a single transaction (un-soft-delete).
--   3. Verify the restore took.
--
-- This script restores ONLY rows that were soft-deleted in the 2026-05-15
-- bulk event on Mondi. It does not touch any other project, any other
-- delete event, or any rows currently live.
--
-- Caveat: the filter uses `deleted_at::date = '2026-05-15'`, which is
-- coarse. If any unrelated Mondi rows were soft-deleted on that calendar
-- date, they will also be restored. Before COMMIT, inspect the preview
-- result (Step 1) and confirm the timestamps cluster in a single bulk
-- event (e.g. all within a few minutes). If they do not, replace the
-- predicate with a tighter window such as
--   `deleted_at BETWEEN '2026-05-15 09:51:00+00' AND '2026-05-15 09:52:00+00'`
-- before running Step 2.

-- ── Step 1. Preview (read-only) ───────────────────────────────────────
SELECT id, type, outline_number, indent_level, title, deleted_at
FROM work_items
WHERE project_id = 281
  AND deleted_at::date = DATE '2026-05-15'
ORDER BY indent_level, outline_number NULLS LAST, id;

-- Expected count: ~640 rows across all indent levels (WBS 1..7 are the
-- top-level rows the COO reported missing).

-- ── Step 2. Restore in a single transaction ──────────────────────────
BEGIN;

UPDATE work_items
SET deleted_at = NULL,
    updated_at = NOW()
WHERE project_id = 281
  AND deleted_at::date = DATE '2026-05-15';

-- ── Step 3. Verify before committing ─────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE deleted_at IS NULL)        AS live_after,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)    AS still_deleted,
  COUNT(*) FILTER (WHERE indent_level = 0
                   AND deleted_at IS NULL)          AS top_level_live
FROM work_items
WHERE project_id = 281;

-- If live_after looks right (≈ total Mondi rows) and top_level_live ≥ 13,
-- COMMIT. Otherwise ROLLBACK and investigate.

-- COMMIT;
-- ROLLBACK;
