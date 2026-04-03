-- Rollback: 20260403_g06_rollback_activity_audit_logs.sql
-- Reverses Phase G activity + audit logs.
BEGIN;

DROP TABLE IF EXISTS core.audit_log;
DROP TABLE IF EXISTS core.activity_log;

COMMIT;
