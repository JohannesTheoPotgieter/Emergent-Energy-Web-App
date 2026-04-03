-- Rollback: 20260403_e08_rollback_deliverables.sql
-- Reverses Phase E deliverables: drops instances then definitions (FK order).
BEGIN;

DROP TABLE IF EXISTS core.deliverable_instances;
DROP TABLE IF EXISTS core.deliverable_definitions;

COMMIT;
