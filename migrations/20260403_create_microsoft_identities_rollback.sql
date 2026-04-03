-- Rollback: 20260403_create_microsoft_identities_rollback.sql
-- Reverses Phase A.3b: drops core.microsoft_identities table.
-- Safe: no app code reads from core.microsoft_identities; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.microsoft_identities;

COMMIT;
