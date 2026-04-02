-- Migration: 20260402_party_abstraction.sql
-- Phase 1B Blocker 3b: Create core.parties unified party abstraction table
BEGIN;

CREATE TABLE IF NOT EXISTS core.parties (
  id BIGSERIAL PRIMARY KEY,
  legacy_counterparty_id INTEGER UNIQUE,
  legacy_client_id INTEGER UNIQUE,
  party_type TEXT NOT NULL,
  name_canonical TEXT NOT NULL,
  name_aliases JSONB DEFAULT '[]'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  vat_number TEXT,
  registration_number TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  payment_terms TEXT,
  role_tags TEXT[] DEFAULT '{}',
  source_table TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parties_name_canonical ON core.parties (LOWER(name_canonical));
CREATE INDEX IF NOT EXISTS idx_parties_party_type ON core.parties (party_type);

COMMENT ON TABLE core.parties IS 'Unified party abstraction. Phase 1B foundation only — no write paths depend on this table yet.';

COMMIT;
