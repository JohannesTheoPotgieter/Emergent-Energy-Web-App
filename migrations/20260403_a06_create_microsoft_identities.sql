-- Migration: 20260403_a06_create_microsoft_identities.sql
-- Phase A.3b: Create core.microsoft_identities table extracting users.microsoft_id.
-- Additive only. Auth and OAuth flows remain unchanged. No app code changes.
-- Must run AFTER: 20260403_a04_create_user_accounts.sql
BEGIN;

CREATE TABLE IF NOT EXISTS core.microsoft_identities (
  id                BIGSERIAL PRIMARY KEY,
  user_account_id   BIGINT NOT NULL UNIQUE REFERENCES core.user_accounts(id),
  microsoft_user_id TEXT NOT NULL UNIQUE,
  tenant_id         TEXT NOT NULL,
  email             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_microsoft_identities_tenant_id
  ON core.microsoft_identities (tenant_id);

COMMENT ON TABLE core.microsoft_identities IS
  'Phase A.3b: Microsoft identity extracted from users.microsoft_id. OAuth flows still write to public.users.';

COMMIT;
