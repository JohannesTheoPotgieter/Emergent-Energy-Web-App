-- Migration 0071 — per-user saved priority views
--
-- Users build up named filter combinations on the Priorities page
-- ("My critical at-risk", "Engineering blocked", "Closed this quarter")
-- and pick one from a dropdown instead of re-applying filters each
-- time. Scoped per-user (no sharing yet — Sprint 4 if needed).

CREATE TABLE IF NOT EXISTS priority_saved_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active_tab TEXT NOT NULL DEFAULT 'my',
  scope TEXT,
  department_key TEXT,
  level_filter TEXT,
  health_filter TEXT,
  search_query TEXT,
  show_closed BOOLEAN NOT NULL DEFAULT false,
  show_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_priority_saved_views_user
  ON priority_saved_views (user_id, sort_order);
