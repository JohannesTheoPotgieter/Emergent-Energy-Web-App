-- ============================================================================
-- PRODUCTION PLAN CLEANUP  —  work_items hierarchy rebuild + duplicate removal
-- Generated: 2026-06-03
-- TARGET: PRODUCTION (Neon) database ONLY.  Operates on table public.work_items.
--
-- What it does (portfolio-wide, all projects):
--   1. Backs up the whole work_items table.
--   2. Soft-deletes TRUE duplicate tasks (same project + workstream + title +
--      start + end), repointing any children onto the surviving copy.
--   3. Re-parents dotted-WBS tasks (e.g. "3.1") under the row whose WBS is the
--      prefix ("3") -- but ONLY when that prefix matches exactly one row.
--   4. Syncs outline_number = wbs_code (only where wbs_code is present) so the
--      hierarchy SURVIVES A FUTURE RE-IMPORT. See "Re-import safety" below.
--
-- What it deliberately does NOT do:
--   - It does NOT guess parents for integer-WBS ("1","2","3") or blank-WBS
--     top-level tasks. There is no parent/phase/WBS signal for them, so they
--     stay top-level. (This includes most of Red Rocket -- those need a
--     per-project template, handled separately.)
--   - It does NOT re-parent a dotted task when the prefix is ambiguous
--     (matches >1 row). Those are left orphan for manual review.
--
-- Re-import safety (why step 4 exists):
--   The Smart Import engine is idempotent and matches existing rows by row_hash
--   (which prefers wbs_code), so re-importing the same workbook will NOT create
--   duplicates and will NOT error on the rows this script soft-deletes (they
--   drop out of the partial unique indexes that filter on deleted_at IS NULL).
--   HOWEVER the importer rebuilds parent_id from the outline_number prefix on
--   every import. In current prod data outline_number is flat (plain integers)
--   while wbs_code is dotted -- so without step 4 a re-import would FLATTEN the
--   hierarchy this script just built. Step 4 sets outline_number = wbs_code,
--   which is exactly what the current importer writes on insert, so a re-import
--   re-derives the SAME tree instead of flattening it. (Rows with no wbs_code
--   are left untouched so their row_hash stays stable.)
--
-- Safety: reversible. Only parent_id, indent_level, outline_number, deleted_at
--   are changed, plus a full backup table. Restore script is in SECTION 4.
--
-- IMPORTANT — run in a low-traffic / maintenance window. The transaction takes
--   a write lock on work_items so the cleanup is point-in-time consistent.
--   (Restore in SECTION 4 reverts parent_id/indent_level/outline_number/deleted_at to the
--   backup snapshot, so any concurrent edits to those 4 columns made between
--   backup and restore would also be reverted -- another reason to run quiet.)
--
-- HOW TO RUN: run interactively in psql, section by section. Review the counts
--   printed in 2f BEFORE you type COMMIT. Do NOT run blindly with `-f`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SECTION 0 — BACKUP (run first; keep until you've verified the result)
-- ----------------------------------------------------------------------------
-- Safe to re-run: if the backup already exists we DO NOT overwrite it (that
-- would clobber the pristine pre-cleanup snapshot with already-cleaned data).
-- To take a fresh backup, drop it manually first.
DO $$
BEGIN
  IF to_regclass('public.work_items_backup_20260603') IS NULL THEN
    EXECUTE 'CREATE TABLE work_items_backup_20260603 AS SELECT * FROM work_items';
    RAISE NOTICE 'Backup created: work_items_backup_20260603';
  ELSE
    RAISE NOTICE 'Backup work_items_backup_20260603 already exists -- left untouched.';
  END IF;
END $$;

-- sanity check: these two numbers must match
SELECT (SELECT count(*) FROM work_items)                  AS live_rows,
       (SELECT count(*) FROM work_items_backup_20260603)  AS backup_rows;


-- ----------------------------------------------------------------------------
-- SECTION 1 — BEFORE snapshot + duplicate preview (read-only, no changes)
-- ----------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE deleted_at IS NULL)                                          AS active_rows,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NULL)                    AS top_level,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NOT NULL)                AS nested,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NULL
                    AND position('.' in coalesce(wbs_code,'')) > 0)                   AS dotted_but_orphan
FROM work_items;

-- Exactly which rows will be removed as duplicates (REVIEW THIS LIST!)
WITH ranked AS (
  SELECT id, project_id, workstream, title, start_date, end_date, parent_id, wbs_code,
         row_number() OVER (
           PARTITION BY project_id, workstream, title,
                        coalesce(start_date::text, ''),
                        coalesce(end_date::text,   '')
           ORDER BY (parent_id IS NOT NULL) DESC,
                    (position('.' in coalesce(wbs_code,'')) > 0) DESC,
                    id ASC
         ) AS rn
  FROM work_items
  WHERE deleted_at IS NULL
)
SELECT project_id, workstream, title, start_date, end_date, count(*) AS copies_removed
FROM ranked
WHERE rn > 1
GROUP BY project_id, workstream, title, start_date, end_date
ORDER BY project_id, title;


-- ----------------------------------------------------------------------------
-- SECTION 2 — CLEANUP  (one transaction; review 2f, THEN commit)
-- ----------------------------------------------------------------------------
BEGIN;

-- 2a. Block concurrent writers so backup + cleanup are consistent.
LOCK TABLE work_items IN SHARE ROW EXCLUSIVE MODE;

-- 2b. Map each duplicate "loser" row to the surviving "keeper".
--     Keeper preference: has a parent > has a dotted WBS > lowest id.
CREATE TEMP TABLE _dups ON COMMIT DROP AS
WITH ranked AS (
  SELECT id, project_id,
         first_value(id) OVER w AS keeper_id,
         row_number()    OVER w AS rn
  FROM work_items
  WHERE deleted_at IS NULL
  WINDOW w AS (
    PARTITION BY project_id, workstream, title,
                 coalesce(start_date::text, ''),
                 coalesce(end_date::text,   '')
    ORDER BY (parent_id IS NOT NULL) DESC,
             (position('.' in coalesce(wbs_code,'')) > 0) DESC,
             id ASC
  )
)
SELECT id AS loser_id, keeper_id
FROM ranked
WHERE rn > 1;

-- 2c. Repoint children of a loser onto its keeper (so nothing is orphaned).
--     Guard `c.id <> d.keeper_id` prevents the keeper pointing at itself
--     (would happen if a keeper's existing parent was one of its own losers).
UPDATE work_items c
SET parent_id = d.keeper_id, updated_at = now()
FROM _dups d
WHERE c.parent_id = d.loser_id
  AND c.id <> d.keeper_id
  AND c.deleted_at IS NULL;

-- 2d. Soft-delete the duplicate losers.
UPDATE work_items
SET deleted_at = now(), updated_at = now()
WHERE id IN (SELECT loser_id FROM _dups)
  AND deleted_at IS NULL;

-- 2e. Re-parent dotted, parentless tasks under their WBS-prefix row,
--     ONLY when exactly one active row matches that prefix (no guessing).
CREATE TEMP TABLE _reparent ON COMMIT DROP AS
SELECT c.id AS child_id,
       m.n   AS match_count,
       (char_length(c.wbs_code) - char_length(replace(c.wbs_code,'.',''))) AS depth,
       CASE WHEN m.n = 1 THEN m.pid END AS new_parent
FROM work_items c
CROSS JOIN LATERAL (
  SELECT count(*) AS n, min(p.id) AS pid
  FROM work_items p
  WHERE p.project_id = c.project_id
    AND p.deleted_at IS NULL
    AND p.id <> c.id
    AND p.wbs_code = regexp_replace(c.wbs_code, '\.[^.]*$', '')
) m
WHERE c.deleted_at IS NULL
  AND c.parent_id IS NULL
  AND position('.' in coalesce(c.wbs_code,'')) > 0;

UPDATE work_items c
SET parent_id    = r.new_parent,
    indent_level = GREATEST(r.depth, 1),
    updated_at   = now()
FROM _reparent r
WHERE c.id = r.child_id
  AND r.new_parent IS NOT NULL;

-- 2f. Make the hierarchy survive a future re-import.
--     The importer rebuilds parent_id from the outline_number prefix and, on
--     insert, sets outline_number = wbs_code. Current prod outline_number is
--     flat, so we align it to wbs_code here -- only where wbs_code is present
--     (rows with no wbs_code derive their row_hash from outline_number, so we
--     must not touch theirs). Skips rows already in sync to avoid churn.
UPDATE work_items
SET outline_number = wbs_code, updated_at = now()
WHERE deleted_at IS NULL
  AND wbs_code IS NOT NULL
  AND wbs_code <> ''
  AND outline_number IS DISTINCT FROM wbs_code;

-- 2g. REVIEW THESE NUMBERS before committing.
SELECT
  (SELECT count(*) FROM _dups)                                       AS duplicates_removed,
  (SELECT count(*) FROM _reparent WHERE new_parent IS NOT NULL)      AS tasks_reparented,
  (SELECT count(*) FROM _reparent WHERE match_count > 1)             AS skipped_ambiguous_prefix,
  (SELECT count(*) FROM _reparent WHERE match_count = 0)             AS dotted_no_prefix_row,
  -- rows whose outline_number now mirrors wbs_code (re-import durability)
  (SELECT count(*) FROM work_items
     WHERE deleted_at IS NULL AND wbs_code IS NOT NULL AND wbs_code <> ''
       AND outline_number = wbs_code)                                AS outline_synced_to_wbs,
  -- integrity guard: MUST be 0 (no row may be its own parent)
  (SELECT count(*) FROM work_items
     WHERE deleted_at IS NULL AND parent_id = id)                    AS self_parent_rows;

-- ---- If self_parent_rows = 0 and the numbers look right, run:  COMMIT;
-- ---- If anything looks wrong, run:                            ROLLBACK;


-- ----------------------------------------------------------------------------
-- SECTION 3 — AFTER verification (run once committed)
-- ----------------------------------------------------------------------------
-- Portfolio totals
SELECT
  count(*) FILTER (WHERE deleted_at IS NULL)                           AS active_rows,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NULL)     AS top_level_now,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NOT NULL) AS nested_now
FROM work_items;

-- Spot-check one project's tree (replace 287 = Red Rocket with any project_id)
SELECT lpad(coalesce(sort_order::text,'-'),5) AS sort,
       coalesce(wbs_code,'-')                 AS wbs,
       indent_level                           AS lvl,
       coalesce(parent_id::text,'·')          AS parent,
       left(title,48)                         AS title
FROM work_items
WHERE project_id = 287 AND deleted_at IS NULL
ORDER BY sort_order NULLS LAST, id;


-- ----------------------------------------------------------------------------
-- SECTION 4 — ROLLBACK (full undo from the backup, if ever needed)
-- ----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE work_items w
-- SET parent_id      = b.parent_id,
--     indent_level   = b.indent_level,
--     outline_number = b.outline_number,
--     deleted_at     = b.deleted_at,
--     updated_at     = b.updated_at
-- FROM work_items_backup_20260603 b
-- WHERE w.id = b.id;
-- COMMIT;
-- ---- After you're confident, drop the backup:  DROP TABLE work_items_backup_20260603;
