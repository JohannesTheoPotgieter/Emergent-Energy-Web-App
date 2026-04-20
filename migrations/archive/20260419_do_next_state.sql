-- Home "Do Next" — per-user snooze and dismiss state.
--
-- Backs the redesigned home page's action strip. The server endpoint
-- /api/home/do-next ranks actionable items per user/role and filters out
-- items that the user has snoozed or dismissed.
--
-- Item identity is a stable string key produced by the server (e.g.
-- "approval:gate:1234", "rag:red:Aurora", "task:overdue:5678"). This avoids
-- coupling the snooze table to any specific source domain.
--
-- Additive migration. Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.do_next_state (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  item_key        TEXT    NOT NULL,
  snoozed_until   TIMESTAMPTZ,           -- NULL = not snoozed
  dismissed_at    TIMESTAMPTZ,           -- NULL = not dismissed
  snooze_count    INTEGER NOT NULL DEFAULT 0,
  last_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS do_next_state_user_item_idx
  ON public.do_next_state (user_id, item_key);

CREATE INDEX IF NOT EXISTS do_next_state_user_active_idx
  ON public.do_next_state (user_id)
  WHERE dismissed_at IS NULL;
