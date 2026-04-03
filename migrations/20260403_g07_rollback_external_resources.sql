-- Rollback: 20260403_g07_rollback_external_resources.sql
-- Reverses Phase G external resources: drops links then resources (FK order).
BEGIN;

DROP TABLE IF EXISTS core.resource_links;
DROP TABLE IF EXISTS core.external_resources;

COMMIT;
