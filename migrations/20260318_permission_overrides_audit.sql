-- Permission System Enhancement: User Overrides + Audit Log
-- Safe additive migration — no destructive changes

-- Add permission version tracking to role_permissions
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS permission_version INTEGER NOT NULL DEFAULT 1;

-- User-specific permission overrides (allows granting/revoking individual permissions per user)
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  scope TEXT,
  granted_by INTEGER REFERENCES users(id),
  reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT upo_unique_user_entity_action UNIQUE (user_id, entity, action)
);
CREATE INDEX IF NOT EXISTS idx_upo_user_id ON user_permission_overrides(user_id);

-- Permission change audit log (tracks all role/permission changes for governance)
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  target_role TEXT,
  target_user_id INTEGER,
  changed_by_user_id INTEGER REFERENCES users(id),
  changed_by_role TEXT,
  change_detail JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pal_event_type ON permission_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_pal_target_role ON permission_audit_log(target_role);
