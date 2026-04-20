-- Backfill 02: Client Contact Fields
-- Updates core.clients contact fields from public.clients via legacy_id join
-- Idempotent: overwrites with latest legacy values (safe to re-run)
-- Must run AFTER: 20260402_client_contact_fields.sql
BEGIN;

UPDATE core.clients cc
SET
  legal_entity_name = lc.legal_entity_name,
  trading_name = lc.trading_name,
  client_type = lc.client_type,
  primary_contact_name = lc.primary_contact_name,
  primary_contact_email = lc.primary_contact_email,
  primary_contact_phone = lc.primary_contact_phone
FROM public.clients lc
WHERE cc.legacy_id = lc.id;

COMMIT;
