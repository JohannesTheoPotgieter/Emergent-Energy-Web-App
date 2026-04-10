-- S03: Add canonical_expense_id and canonical_task_id to expense_task_links
-- Purpose: New FK columns pointing to canonical tables (normalized_cost_lines, work_items)
--          instead of legacy tables (program_expense, project_plan). During migration,
--          both old and new FK columns coexist. After cutover, legacy columns are retired.
-- Safety: Additive — nullable columns only, no data changes, no existing columns modified.
-- Rollback: 20260411_add_canonical_ids_to_expense_task_links_rollback.sql

ALTER TABLE expense_task_links
  ADD COLUMN IF NOT EXISTS canonical_expense_id INTEGER REFERENCES normalized_cost_lines(id),
  ADD COLUMN IF NOT EXISTS canonical_task_id INTEGER REFERENCES work_items(id);

-- Index for join queries from canonical tables.
CREATE INDEX IF NOT EXISTS idx_expense_task_links_canonical_expense
  ON expense_task_links (canonical_expense_id)
  WHERE canonical_expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_task_links_canonical_task
  ON expense_task_links (canonical_task_id)
  WHERE canonical_task_id IS NOT NULL;
