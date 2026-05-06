-- C3 — Notification + alert engine
--
-- Adds last_alert_state to the C1/C2 surfaces so the alert monitors
-- can detect state transitions (healthy -> failing, fresh -> stale)
-- without re-querying history. Also adds a small task_reminder_state
-- helper to track which work-item due-date reminders we've already
-- sent, so we don't spam the same assignee every reminder cycle.
--
-- Rollback: 20260413_alert_state_columns_rollback.sql

BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS last_alert_state text;

COMMENT ON COLUMN integrations.last_alert_state IS
  'C3: last health state we dispatched an alert for. Used to fire only on transitions.';

ALTER TABLE dashboard_snapshots
  ADD COLUMN IF NOT EXISTS last_alert_state text;

COMMENT ON COLUMN dashboard_snapshots.last_alert_state IS
  'C3: last freshness state we dispatched an alert for. Used to fire only on transitions.';

-- Throttle/dedup state for work-item due-date reminders. The existing
-- notification_throttle table is per-(recipient, event, entity); this
-- table lets us record cleanly which milestone the reminder fired for
-- (e.g. "T-24h", "T-1h", "overdue") without abusing eventType strings.
CREATE TABLE IF NOT EXISTS task_reminder_state (
  id              serial PRIMARY KEY,
  work_item_id    integer NOT NULL,
  reminder_kind   text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  recipient_user_id integer,
  CONSTRAINT chk_task_reminder_kind
    CHECK (reminder_kind IN ('due_in_24h', 'due_today', 'overdue'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_reminder_state_work_kind
  ON task_reminder_state(work_item_id, reminder_kind);

CREATE INDEX IF NOT EXISTS idx_task_reminder_state_sent_at
  ON task_reminder_state(sent_at DESC);

COMMENT ON TABLE task_reminder_state IS
  'C3: dedup state for work-item due-date reminders. One row per (work_item, reminder_kind).';

COMMIT;
