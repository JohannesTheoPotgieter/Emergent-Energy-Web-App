-- Rollback: 20260402_client_contact_fields_rollback.sql
-- WARNING: Destroys backfilled contact data on core.clients.
BEGIN;
ALTER TABLE core.clients DROP COLUMN IF EXISTS legal_entity_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS trading_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS client_type;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_name;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_email;
ALTER TABLE core.clients DROP COLUMN IF EXISTS primary_contact_phone;
COMMIT;
