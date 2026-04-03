-- Migration: 20260403_expand_parties_add_party_kind.sql
-- Phase A.2: Expand core.parties with party_kind discriminator and user tracking
-- Additive only. All new columns nullable. No existing columns modified.
BEGIN;

ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS party_kind TEXT;
ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE core.parties ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER UNIQUE;

CREATE INDEX IF NOT EXISTS idx_parties_party_kind ON core.parties (party_kind);

COMMIT;
