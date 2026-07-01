-- H3 — Finance live-row uniqueness (de-dup first, then enforce).
--
-- Two finance snapshot tables can hold MORE THAN ONE live row for the same
-- logical entity, which the §3.3 read then double-counts:
--   • category_revenue_allocations — Σ col-J revenue per category (Seshego class)
--   • tracker_revenue_summary       — the FYE "Planned Revenue Actual" ceiling
--
-- This script is IDEMPOTENT and SELECT-safe to re-run. It (a) soft-closes all
-- but the NEWEST live row per key, then (b) creates the partial unique index so
-- a second live row becomes physically impossible. The allocations index is
-- already present on most environments (hand-written migration 0084); the
-- IF NOT EXISTS makes that a no-op. The tracker_revenue_summary index is new.
--
-- Run ONCE against prod (owner action — agents do not run db:migrate):
--   psql "$DATABASE_URL" -f scripts/finance-live-uniqueness.sql
--
-- To make these guards survive a db:push / rebuilt Drizzle baseline, ALSO add
-- the matching uniqueIndex() declarations to shared/schema/finance.ts and run
-- `npm run db:generate` in an environment that has DATABASE_URL (see the PR
-- description for the exact snippet). This script covers the live DB today; the
-- schema declaration covers future rebuilds.

BEGIN;

-- 1a. category_revenue_allocations: keep the newest live row per
--     (project_id, category_key); soft-close the older duplicates.
UPDATE category_revenue_allocations a
SET effective_to = now()
WHERE a.effective_to IS NULL
  AND a.id < (
    SELECT max(b.id)
    FROM category_revenue_allocations b
    WHERE b.effective_to IS NULL
      AND b.project_id = a.project_id
      AND b.category_key = a.category_key
  );

-- 1b. Enforce exactly one live allocation per (project_id, category_key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_revenue_allocations_active
  ON category_revenue_allocations (project_id, category_key)
  WHERE effective_to IS NULL;

-- 2a. tracker_revenue_summary: keep the newest live row per project.
UPDATE tracker_revenue_summary a
SET effective_to = now()
WHERE a.effective_to IS NULL
  AND a.id < (
    SELECT max(b.id)
    FROM tracker_revenue_summary b
    WHERE b.effective_to IS NULL
      AND b.project_id = a.project_id
  );

-- 2b. Enforce exactly one live summary per project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_revenue_summary_active
  ON tracker_revenue_summary (project_id)
  WHERE effective_to IS NULL;

COMMIT;

-- Verify (both should return zero rows):
--   SELECT project_id, category_key, count(*) FROM category_revenue_allocations
--     WHERE effective_to IS NULL GROUP BY 1,2 HAVING count(*) > 1;
--   SELECT project_id, count(*) FROM tracker_revenue_summary
--     WHERE effective_to IS NULL GROUP BY 1 HAVING count(*) > 1;
