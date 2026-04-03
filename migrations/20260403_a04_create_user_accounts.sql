-- Migration: 20260403_a04_create_user_accounts.sql
-- Phase A.3: Create core.user_accounts table linking public.users to core.parties.
-- Additive only. Auth remains in public.users. No app code changes.
BEGIN;

CREATE TABLE IF NOT EXISTS core.user_accounts (
  id             BIGSERIAL PRIMARY KEY,
  party_id       BIGINT NOT NULL REFERENCES core.parties(id),
  legacy_user_id INTEGER UNIQUE NOT NULL,
  email          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  last_login_at  TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_party_id
  ON core.user_accounts (party_id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email
  ON core.user_accounts (email);

CREATE INDEX IF NOT EXISTS idx_user_accounts_status
  ON core.user_accounts (status);

COMMENT ON TABLE core.user_accounts IS
  'Phase A.3: user account identity linked to unified party model. Auth stays in public.users.';

COMMIT;
