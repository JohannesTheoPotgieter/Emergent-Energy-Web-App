-- Migration 0070 — priority templates
--
-- Reusable priority shapes. An admin (or department head, scoped to
-- their dept) defines a template once — title, severity, horizon,
-- department, definition-of-done, next-action — and any user with
-- permission can instantiate it as a real priority in one click.
--
-- scope_default carries the scope the template prefers to create at
-- (role / department / company). The instantiate endpoint validates
-- the caller can create at that scope; if not, it errors out.

CREATE TABLE IF NOT EXISTS priority_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  title_template TEXT NOT NULL,
  body_template TEXT,
  scope_default TEXT NOT NULL DEFAULT 'role',
  severity_default TEXT NOT NULL DEFAULT 'normal',
  horizon_default TEXT NOT NULL DEFAULT 'week',
  department_key TEXT,
  target_outcome TEXT,
  definition_of_done TEXT,
  next_action TEXT,
  owner_role TEXT,
  created_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_priority_templates_dept
  ON priority_templates (department_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_priority_templates_live
  ON priority_templates (deleted_at);
