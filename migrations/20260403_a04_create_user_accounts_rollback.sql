-- Rollback: 20260403_a04_create_user_accounts_rollback.sql
-- Reverses Phase A.3: drops core.user_accounts table.
-- Safe: no app code reads from core.user_accounts; no downstream FK dependencies.
BEGIN;

DROP TABLE IF EXISTS core.user_accounts;

COMMIT;
