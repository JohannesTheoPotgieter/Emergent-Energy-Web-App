-- Rollback: 20260403_c05_create_work_item_dependencies_clean_rollback.sql
-- Reverses Phase C.3: drops work_item_dependencies_clean.
-- Must run BEFORE c03 rollback (work_items_clean) since this table has FK to work_items_clean.
BEGIN;

DROP TABLE IF EXISTS core.work_item_dependencies_clean;

COMMIT;
