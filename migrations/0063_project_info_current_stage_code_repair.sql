-- 0063_project_info_current_stage_code_repair
--
-- Idempotently restores the `current_stage_code` column on `project_info`.
--
-- Background: the baseline migration (0000_baseline_20260419.sql) declares
-- `project_info.current_stage_code TEXT` and the Drizzle schema mirror
-- (shared/schema/projects.ts) declares it as `currentStageCode`. Over thirty
-- code paths read or write it (server/bridge/bridge-writer.ts,
-- server/lib/priorities/progress-source.ts, server/lifecycle-routes.ts, …).
--
-- However, the dev database has been observed missing this column — most
-- likely because the table pre-dated the migration baseline and the baseline
-- was retroactively marked as applied without actually executing the CREATE
-- TABLE. Runtime queries against project_info.current_stage_code then fail
-- with `column "current_stage_code" does not exist`, which is what was
-- caught by the priority-progress-source compute path and surfaced as
-- `[priority-progress-source] compute failed` in the server logs.
--
-- This migration is safe to apply against any environment: it is a no-op
-- where the column already exists (e.g. production), and restores the
-- column where it is missing.

ALTER TABLE "project_info"
  ADD COLUMN IF NOT EXISTS "current_stage_code" text;
