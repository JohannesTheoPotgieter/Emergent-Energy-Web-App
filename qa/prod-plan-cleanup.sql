-- ============================================================================
-- PRODUCTION PLAN CLEANUP  —  work_items hierarchy rebuild + duplicate removal
-- Generated: 2026-06-03
-- TARGET: PRODUCTION (Neon) database ONLY.  Operates on table public.work_items.
--
-- Straightforward edition: NO temp tables, NO backup table. Every statement is
-- self-contained (plain CTEs) so it runs cleanly in any psql / SQL console.
--
-- What it does (portfolio-wide, all projects):
--   1. Soft-deletes TRUE duplicate tasks (same project + workstream + title +
--      start + end), repointing any children onto the surviving copy.
--   2. Re-parents dotted-WBS tasks (e.g. "3.1") under the row whose WBS is the
--      prefix ("3") -- but ONLY when that prefix matches exactly one row.
--   3. Syncs outline_number = wbs_code (only where wbs_code is present) so the
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
-- Re-import safety (why step 3 exists):
--   The Smart Import engine is idempotent and matches existing rows by row_hash
--   (which prefers wbs_code), so re-importing the same workbook will NOT create
--   duplicates and will NOT error on the rows this script soft-deletes (they
--   drop out of the partial unique indexes that filter on deleted_at IS NULL).
--   HOWEVER the importer rebuilds parent_id from the outline_number prefix on
--   every import. In current prod data outline_number is flat (plain integers)
--   while wbs_code is dotted -- so without step 3 a re-import would FLATTEN the
--   hierarchy this script just built. Step 3 sets outline_number = wbs_code,
--   which is exactly what the current importer writes on insert, so a re-import
--   re-derives the SAME tree instead of flattening it. (Rows with no wbs_code
--   are left untouched so their row_hash stays stable.)
--
-- ⚠️  NO BACKUP / UNDO IN THIS SCRIPT.
--   Because there is no backup table, the ONLY way to undo this is a database
--   point-in-time restore. BEFORE you run SECTION 2, create a Neon restore
--   point / branch (or note the current timestamp so you can PITR to it).
--   The change only touches parent_id, indent_level, outline_number, deleted_at,
--   and duplicates are SOFT-deleted (deleted_at set, rows not physically removed).
--
-- IMPORTANT — run in a low-traffic / maintenance window. The transaction takes
--   a write lock on work_items so the cleanup is point-in-time consistent.
--
-- HOW TO RUN: run interactively, section by section. Review SECTION 1's preview
--   first, then run SECTION 2 and check its final review row (dup_groups_remaining
--   and self_parent_rows MUST be 0) BEFORE you type COMMIT.
-- ============================================================================


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
  SELECT project_id, workstream, title, start_date, end_date,
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
-- SECTION 2 — CLEANUP  (one transaction; review the last row, THEN commit)
-- ----------------------------------------------------------------------------
BEGIN;

-- 2a. Block concurrent writers so the cleanup is point-in-time consistent.
LOCK TABLE work_items IN SHARE ROW EXCLUSIVE MODE;

-- 2b. Repoint children of each duplicate "loser" onto the surviving "keeper",
--     so nothing is orphaned. Keeper preference within a duplicate group:
--     has a parent > has a dotted WBS > lowest id. Run this BEFORE the
--     soft-delete below (after soft-delete the losers drop out of the CTE).
WITH ranked AS (
  SELECT id,
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
),
dups AS (SELECT id AS loser_id, keeper_id FROM ranked WHERE rn > 1)
UPDATE work_items c
SET parent_id = d.keeper_id, updated_at = now()
FROM dups d
WHERE c.parent_id = d.loser_id
  AND c.id <> d.keeper_id          -- never let the keeper parent itself
  AND c.deleted_at IS NULL;

-- 2c. Soft-delete the duplicate losers (same ranking as 2b).
WITH ranked AS (
  SELECT id,
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
UPDATE work_items
SET deleted_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  AND deleted_at IS NULL;

-- 2d. Re-parent dotted, parentless tasks under their WBS-prefix row,
--     ONLY when exactly one active row matches that prefix (no guessing).
WITH reparent AS (
  SELECT c.id AS child_id,
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
    AND position('.' in coalesce(c.wbs_code,'')) > 0
)
UPDATE work_items c
SET parent_id    = r.new_parent,
    indent_level = GREATEST(r.depth, 1),
    updated_at   = now()
FROM reparent r
WHERE c.id = r.child_id
  AND r.new_parent IS NOT NULL;

-- 2e. Make the hierarchy survive a future re-import. The importer rebuilds
--     parent_id from the outline_number prefix and, on insert, sets
--     outline_number = wbs_code. Current prod outline_number is flat, so we
--     align it to wbs_code -- only where wbs_code is present (rows with no
--     wbs_code derive their row_hash from outline_number, so leave those alone).
UPDATE work_items
SET outline_number = wbs_code, updated_at = now()
WHERE deleted_at IS NULL
  AND wbs_code IS NOT NULL
  AND wbs_code <> ''
  AND outline_number IS DISTINCT FROM wbs_code;

-- 2f. REVIEW THIS ROW before committing.
--     dup_groups_remaining and self_parent_rows MUST both be 0.
SELECT
  (SELECT count(*) FROM work_items WHERE deleted_at IS NULL)                       AS active_rows_now,
  (SELECT count(*) FROM work_items WHERE deleted_at IS NULL AND parent_id IS NULL) AS top_level_now,
  (SELECT count(*) FROM work_items WHERE deleted_at IS NULL AND parent_id IS NOT NULL) AS nested_now,
  -- MUST be 0: no duplicate (project+workstream+title+start+end) group remains
  (SELECT count(*) FROM (
     SELECT 1 FROM work_items
     WHERE deleted_at IS NULL
     GROUP BY project_id, workstream, title,
              coalesce(start_date::text,''), coalesce(end_date::text,'')
     HAVING count(*) > 1
   ) g)                                                                            AS dup_groups_remaining,
  -- MUST be 0: no row is its own parent
  (SELECT count(*) FROM work_items WHERE deleted_at IS NULL AND parent_id = id)    AS self_parent_rows,
  -- rows whose outline_number now mirrors wbs_code (re-import durability)
  (SELECT count(*) FROM work_items
     WHERE deleted_at IS NULL AND wbs_code IS NOT NULL AND wbs_code <> ''
       AND outline_number = wbs_code)                                             AS outline_synced_to_wbs;

-- ---- If dup_groups_remaining = 0 AND self_parent_rows = 0, run:  COMMIT;
-- ---- If anything looks wrong, run:                              ROLLBACK;


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

-- ---- Undo: there is no backup table -- restore via a Neon point-in-time
-- ---- restore to the timestamp you noted before SECTION 2.
