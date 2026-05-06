-- ============================================================================
-- Drop program_expense and program_inflows
-- ============================================================================
--
-- ⚠️ HOLD FOR DELIBERATE PRODUCTION RUN ⚠️
-- ----------------------------------------
-- This migration is committed as a FILE on 2026-04-14 but is NOT intended to
-- be applied automatically. Run it manually in production only after:
--   1. All the code changes in the Wave 2 cutover (commits 956ebe0..0493c6a
--      and the schema-removal commit that follows this file) have been
--      deployed and baked for a rollback window you're comfortable with.
--   2. A final grep across the codebase confirms zero remaining references
--      to programExpense / programInflows / program_expense / program_inflows
--      (outside of doc/archive files, commit messages, and the
--      20260414_backfill_ncl_budget_from_pe.sql migration which documents
--      the history).
--   3. You have a fresh production database backup immediately prior to
--      running.
--
-- What this does
-- --------------
-- Drops two legacy derivative tables that have been fully retired:
--   * program_expense — previously a back-compat mirror of
--     normalized_cost_lines, populated by the Wave 1 derivative-materializer.
--     Every budget / admin-override value was moved onto NCL by the
--     20260414_backfill_ncl_budget_from_pe.sql backfill.
--   * program_inflows — previously a back-compat mirror of
--     normalized_revenue_lines. No user-facing code reads it after Wave 1
--     commit 3d3fb59 repointed the FYE Revenue Tracker to NRL.
--
-- FK considerations
-- -----------------
-- expense_task_links used to have a program_expense_id FK pointing at
-- program_expense. Wave 2 commit 079b451 deleted the code that maintained
-- that FK. If rows in expense_task_links still reference old PE ids, the
-- DROP TABLE ... CASCADE below will remove those link rows. An explicit
-- SELECT COUNT(*) FROM expense_task_links WHERE ... before this migration
-- will tell you how many links you are about to lose. Consider running
-- that count as a pre-flight check.
--
-- Rollback window
-- ---------------
-- Once this migration runs, the data in program_expense and program_inflows
-- is GONE. The paired 20260414_drop_program_expense_and_program_inflows_rollback.sql
-- only recreates the table STRUCTURE — it does not restore data. Restoring
-- data requires a database backup.
--
-- Scheduled for:  (to be set by operator when running)
-- Ran at:         (to be filled in after successful run)
-- Ran by:         (operator name / ticket)
-- ============================================================================

BEGIN;

-- Safety check: confirm the tables are no longer being written to.
-- This check passes if both tables have zero rows with an effective_to = NULL
-- that were created in the last 24 hours. If this check fails, STOP — it
-- means something is still writing to PE/PI after the cutover and you need
-- to find and fix that code path BEFORE dropping the tables.
DO $$
DECLARE
  recent_pe INT;
  recent_pi INT;
BEGIN
  SELECT COUNT(*) INTO recent_pe
    FROM program_expense
    WHERE effective_to IS NULL
      AND created_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO recent_pi
    FROM program_inflows
    WHERE effective_to IS NULL
      AND created_at > NOW() - INTERVAL '24 hours';

  IF recent_pe > 0 OR recent_pi > 0 THEN
    RAISE EXCEPTION '[drop-pe-pi] Safety check FAILED: found % recent program_expense rows and % recent program_inflows rows written in the last 24 hours. Something is still writing to the legacy tables. Do not drop.', recent_pe, recent_pi;
  END IF;

  RAISE NOTICE '[drop-pe-pi] Safety check passed: no recent writes to program_expense or program_inflows in the last 24 hours.';
END $$;

-- Log what we are about to drop.
DO $$
DECLARE
  pe_count INT;
  pi_count INT;
BEGIN
  SELECT COUNT(*) INTO pe_count FROM program_expense;
  SELECT COUNT(*) INTO pi_count FROM program_inflows;
  RAISE NOTICE '[drop-pe-pi] About to drop program_expense (% rows) and program_inflows (% rows). CASCADE is enabled.', pe_count, pi_count;
END $$;

-- Drop. CASCADE will remove any dependent FKs (e.g., expense_task_links
-- rows that still pointed at program_expense ids).
DROP TABLE IF EXISTS program_expense CASCADE;
DROP TABLE IF EXISTS program_inflows CASCADE;

COMMIT;
