-- Backfill 03: Parties (Counterparties + Clients)
-- Inserts counterparties and clients into core.parties
-- Idempotent via ON CONFLICT DO NOTHING on unique legacy IDs
-- Must run AFTER: 20260402_party_abstraction.sql
BEGIN;

-- Insert counterparties as parties
INSERT INTO core.parties (
  legacy_counterparty_id, party_type, name_canonical, name_aliases,
  is_active, vat_number, registration_number,
  contact_person, contact_email, contact_phone,
  address, payment_terms, role_tags, source_table
)
SELECT
  cp.id, 'counterparty', cp.name_canonical, COALESCE(cp.name_aliases, '[]'::JSONB),
  cp.is_active, cp.vat_number, cp.registration_number,
  cp.contact_person, cp.contact_email, cp.contact_phone,
  cp.address, cp.payment_terms, COALESCE(cp.role_tags, '{}'), 'public.counterparties'
FROM public.counterparties cp
WHERE cp.deleted_at IS NULL
ON CONFLICT (legacy_counterparty_id) DO NOTHING;

-- Insert clients as parties for unified lookup
INSERT INTO core.parties (
  legacy_client_id, party_type, name_canonical,
  is_active, contact_person, contact_email, contact_phone,
  source_table
)
SELECT
  lc.id, 'client', lc.name,
  true, lc.primary_contact_name, lc.primary_contact_email, lc.primary_contact_phone,
  'public.clients'
FROM public.clients lc
ON CONFLICT (legacy_client_id) DO NOTHING;

COMMIT;
