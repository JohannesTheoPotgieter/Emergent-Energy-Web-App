-- Migration: 20260403_create_role_assignments.sql
-- Phase A.4: Create core.role_assignments linking user_accounts to role_definitions + departments.
-- Supports multiple active roles per user (no unique constraint on user_account_id).
-- Additive only. No app code changes. Auth remains in public.users.
BEGIN;

CREATE TABLE IF NOT EXISTS core.role_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  user_account_id     BIGINT NOT NULL REFERENCES core.user_accounts(id),
  role_definition_id  INTEGER NOT NULL REFERENCES core.role_definitions(id),
  department_id       INTEGER NOT NULL REFERENCES core.departments(id),
  start_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date            DATE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_assignments_user_account_id
  ON core.role_assignments (user_account_id);

CREATE INDEX IF NOT EXISTS idx_role_assignments_role_definition_id
  ON core.role_assignments (role_definition_id);

CREATE INDEX IF NOT EXISTS idx_role_assignments_department_id
  ON core.role_assignments (department_id);

CREATE INDEX IF NOT EXISTS idx_role_assignments_active
  ON core.role_assignments (user_account_id) WHERE end_date IS NULL;

COMMENT ON TABLE core.role_assignments IS
  'Phase A.4: maps user accounts to role definitions and departments. Multiple active roles per user allowed. end_date IS NULL means currently active.';

COMMIT;
