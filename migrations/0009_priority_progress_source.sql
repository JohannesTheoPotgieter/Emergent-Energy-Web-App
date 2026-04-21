-- =========================================================================
-- Priority progress source linking.
--
-- Lets a Priority's progress be driven from a chosen source (a project's
-- current phase, a project's overall % complete, a revenue/billing
-- milestone, or a roll-up of selected tasks) instead of a manually-typed
-- percentage. The source is stored on the Priority row; the value is
-- computed on every read by server/lib/priorities/progress-source.ts.
--
-- Pure additive + idempotent — safe to re-run.
-- =========================================================================

ALTER TABLE "mytool_company_priorities"
  ADD COLUMN IF NOT EXISTS "progress_source_type" text;
--> statement-breakpoint
ALTER TABLE "mytool_company_priorities"
  ADD COLUMN IF NOT EXISTS "progress_source_ref" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mytool_priorities_progress_source_type"
  ON "mytool_company_priorities" ("progress_source_type")
  WHERE "progress_source_type" IS NOT NULL;
