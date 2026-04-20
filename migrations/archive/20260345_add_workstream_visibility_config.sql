-- Workstream Visibility Config: extends PD visibility into general workstream-level access control.
-- Resolution: user-level override > role-level config > WORKSTREAM_VISIBILITY_DEFAULTS constant.

CREATE TABLE IF NOT EXISTS workstream_visibility_config (
  id SERIAL PRIMARY KEY,
  role TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  workstreams TEXT[] NOT NULL DEFAULT '{ENG,PD,PM,QUALITY,FINANCE,GOVERNANCE,PERSONAL}',
  ticket_types TEXT[] NOT NULL DEFAULT '{pd,engineering}',
  scope TEXT NOT NULL DEFAULT 'all',
  sections TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id)
);

-- Migrate existing pdVisibilityConfig data into the new table
INSERT INTO workstream_visibility_config (role, user_id, ticket_types, scope, updated_at, updated_by)
SELECT role, user_id, ticket_types, scope, updated_at, updated_by
FROM pd_visibility_config
ON CONFLICT DO NOTHING;
