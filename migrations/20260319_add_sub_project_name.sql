-- Add sub_project_name column to support multi-project (ad-hoc) trackers.
-- Tags each line with its sub-project name for filtering/grouping.

ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
