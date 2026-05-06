-- Rollback for S03: Remove canonical FK columns from expense_task_links
-- Safety: Only drops objects created by the forward migration.

DROP INDEX IF EXISTS idx_expense_task_links_canonical_task;
DROP INDEX IF EXISTS idx_expense_task_links_canonical_expense;
ALTER TABLE expense_task_links
  DROP COLUMN IF EXISTS canonical_task_id,
  DROP COLUMN IF EXISTS canonical_expense_id;
