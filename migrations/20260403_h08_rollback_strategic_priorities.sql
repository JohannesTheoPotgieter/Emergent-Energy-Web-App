-- Rollback: 20260403_h08_rollback_strategic_priorities.sql
-- Drops Phase H strategic priorities: links then priorities (FK order).
BEGIN;

DROP TABLE IF EXISTS core.strategic_priority_links;
DROP TABLE IF EXISTS core.strategic_priorities;

COMMIT;
