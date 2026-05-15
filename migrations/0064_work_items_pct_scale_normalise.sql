-- Smart Import v2 — KPI consistency
--
-- Normalise `work_items.percent_complete` and `expected_pct_complete` to
-- the canonical 0..1 scale. Historically Smart Import wrote whatever Excel
-- handed back (cells formatted as percentages give 0..1, cells formatted
-- as plain numbers give 0..100), which produced mixed values across rows.
-- Different KPI readers assumed different scales and surfaced different
-- numbers for the same row — see docs/smart-import-v2-task-dedup-audit.md
-- (Fix 4a) for the full trace.
--
-- After this migration the contract documented on
-- `shared/schema/tasks.ts:percentComplete / expectedPctComplete` holds for
-- every existing row. New writes go through `clampPercent` in
-- server/lib/import/value-normalization.ts so the invariant is preserved.
--
-- Idempotent: re-running this migration on already-normalised data is a
-- no-op (every value is already in 0..1, the `> 1` predicate matches
-- nothing, and the clamp at 1 has no effect).

BEGIN;

-- Scale any 1 < value <= 100 down to 0..1.
UPDATE work_items
SET percent_complete = percent_complete / 100
WHERE percent_complete IS NOT NULL
  AND percent_complete > 1
  AND percent_complete <= 100;

UPDATE work_items
SET expected_pct_complete = expected_pct_complete / 100
WHERE expected_pct_complete IS NOT NULL
  AND expected_pct_complete > 1
  AND expected_pct_complete <= 100;

-- Clamp anything still > 1 (runaway / corrupt values) down to 1.
UPDATE work_items
SET percent_complete = 1
WHERE percent_complete IS NOT NULL
  AND percent_complete > 1;

UPDATE work_items
SET expected_pct_complete = 1
WHERE expected_pct_complete IS NOT NULL
  AND expected_pct_complete > 1;

-- Clamp anything below 0 (shouldn't exist, but defensive) up to 0.
UPDATE work_items
SET percent_complete = 0
WHERE percent_complete IS NOT NULL
  AND percent_complete < 0;

UPDATE work_items
SET expected_pct_complete = 0
WHERE expected_pct_complete IS NOT NULL
  AND expected_pct_complete < 0;

COMMIT;
