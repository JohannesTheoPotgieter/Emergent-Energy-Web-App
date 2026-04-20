-- Rollback for 20260413_soft_delete_partial_uniques.sql
-- Restores global unique constraints on project_name and external_ref,
-- dropping the partial unique indexes.
--
-- CAVEAT: If soft-deleted rows exist with duplicate keys, restoring
-- the global unique constraint will fail. In that case, you must
-- resolve duplicates manually before running this rollback.

BEGIN;

-- Drop partial unique indexes
DROP INDEX IF EXISTS uq_project_info_project_name_active;
DROP INDEX IF EXISTS uq_work_items_external_ref_active;

-- Restore global unique constraints
ALTER TABLE project_info
  ADD CONSTRAINT project_info_project_name_unique UNIQUE (project_name);

ALTER TABLE work_items
  ADD CONSTRAINT work_items_external_ref_unique UNIQUE (external_ref);

COMMIT;
