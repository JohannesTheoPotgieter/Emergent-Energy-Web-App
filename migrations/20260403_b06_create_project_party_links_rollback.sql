-- Rollback: 20260403_b06_create_project_party_links_rollback.sql
-- Reverses Phase B.4: drops project_party_links.
-- Safe: no app code reads from this table; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.project_party_links;

COMMIT;
