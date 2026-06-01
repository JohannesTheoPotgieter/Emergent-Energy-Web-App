-- Engineer-function audit (2026-06-01) — prevent duplicate deliverable
-- version rows.
--
-- POST /api/deliverables/:id/revise previously read currentVersion and
-- wrote currentVersion + 1 in separate, non-transactional statements with
-- no uniqueness backstop. Two concurrent revises could both produce the
-- same version number, corrupting the deliverable version history and the
-- gate-approval lineage. The route is now transactional (MAX+1); this
-- migration adds the unique constraint that makes the race impossible.
--
-- Per § 6: additive only, idempotent. The pre-dedupe step + guarded
-- constraint add keep the migration safe to run against existing data that
-- may already contain duplicates.

-- 1. Collapse any pre-existing duplicates, keeping the earliest row
--    (lowest id) for each (deliverable_id, version_number) pair. Child
--    rows reference deliverables, not deliverable_versions, so removing a
--    duplicate version row is safe.
DELETE FROM "deliverable_versions" dv
USING "deliverable_versions" keep
WHERE dv."deliverable_id" = keep."deliverable_id"
  AND dv."version_number" = keep."version_number"
  AND dv."id" > keep."id";

-- 2. Add the composite unique constraint, guarded so re-runs are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deliverable_versions_deliverable_version_unique'
  ) THEN
    ALTER TABLE "deliverable_versions"
      ADD CONSTRAINT "deliverable_versions_deliverable_version_unique"
      UNIQUE ("deliverable_id", "version_number");
  END IF;
END $$;
