-- Rollback for 20260413_alert_state_columns.sql

BEGIN;

DROP INDEX IF EXISTS idx_task_reminder_state_sent_at;
DROP INDEX IF EXISTS uq_task_reminder_state_work_kind;
DROP TABLE IF EXISTS task_reminder_state;

ALTER TABLE dashboard_snapshots DROP COLUMN IF EXISTS last_alert_state;
ALTER TABLE integrations DROP COLUMN IF EXISTS last_alert_state;

COMMIT;
