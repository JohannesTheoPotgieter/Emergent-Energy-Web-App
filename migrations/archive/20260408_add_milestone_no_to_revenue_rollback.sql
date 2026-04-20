-- Rollback for 20260408_add_milestone_no_to_revenue.sql
-- Removes milestone_no and milestone_percent columns from
-- normalized_revenue_lines.
--
-- DATA-LOSS CAVEAT: Any milestone numbers and percentages stored in
-- these columns will be permanently lost. The forward migration can
-- re-add the columns but values must be re-imported from source
-- Excel trackers.

BEGIN;

ALTER TABLE normalized_revenue_lines
  DROP COLUMN IF EXISTS milestone_no,
  DROP COLUMN IF EXISTS milestone_percent;

COMMIT;
