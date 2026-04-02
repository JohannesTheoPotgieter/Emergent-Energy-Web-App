-- Migration: 20260402_client_contact_fields.sql
-- Phase 1B Blocker 3a: Add contact and classification fields to core.clients
-- Additive only. All nullable.
BEGIN;

ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS legal_entity_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS trading_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS client_type TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS primary_contact_phone TEXT;

COMMENT ON COLUMN core.clients.legal_entity_name IS 'Mirrors public.clients.legal_entity_name';
COMMENT ON COLUMN core.clients.client_type IS 'commercial/industrial/residential/government';
COMMENT ON COLUMN core.clients.primary_contact_name IS 'Mirrors public.clients.primary_contact_name for contact parity check';

COMMIT;
