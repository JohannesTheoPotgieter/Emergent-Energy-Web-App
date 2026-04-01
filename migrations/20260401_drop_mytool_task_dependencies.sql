-- Phase 5B: Archive and drop mytool_task_dependencies table
-- This table had 0 rows as verified by live DB parity check (Query 9).
-- Dependencies are now managed via canonical work_item_dependencies table.
-- Original mytool_tasks rows are preserved (still referenced by other tables via FK).

-- Archive step: create a backup copy of the table structure and any remaining data
CREATE TABLE IF NOT EXISTS _archive_mytool_task_dependencies AS
  SELECT * FROM mytool_task_dependencies;

-- Drop the legacy table
DROP TABLE IF EXISTS mytool_task_dependencies CASCADE;

-- Drop the associated enum type if no other table uses it
-- (mytool_dependency_type is only used by the dropped table)
DROP TYPE IF EXISTS mytool_dependency_type CASCADE;
