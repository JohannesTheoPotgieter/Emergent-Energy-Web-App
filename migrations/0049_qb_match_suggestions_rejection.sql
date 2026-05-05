-- Auto-generated duplicate of 0045_qb_match_suggestions_rejection.sql.
-- 0045 is the canonical, hand-written, idempotent version that already
-- added these four columns. This file is retained because it is recorded
-- in migrations/meta/_journal.json (idx 49) and removing it would create
-- a journal/file mismatch on environments that have already applied it.
--
-- Defensive change: every ADD COLUMN now uses IF NOT EXISTS so that any
-- environment that re-runs this migration (or runs it for the first time
-- on a database where 0045 already added the columns) treats it as a
-- no-op instead of failing. This eliminates the failure mode where a
-- deploy-time schema-sync tool reacts to a "column already exists" error
-- by emitting a destructive DROP COLUMN to "fix" the drift.
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejected_by" integer;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quickbooks_match_suggestions'
      AND column_name = 'manual_override'
  ) THEN
    ALTER TABLE "quickbooks_match_suggestions"
      ADD COLUMN "manual_override" boolean DEFAULT false NOT NULL;
  END IF;
END$$;
