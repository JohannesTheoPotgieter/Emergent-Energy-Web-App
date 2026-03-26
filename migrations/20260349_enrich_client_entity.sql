-- Step B1: Enrich Client entity with missing fields per target architecture
-- All columns nullable / defaulted — zero impact on existing records

ALTER TABLE clients ADD COLUMN IF NOT EXISTS legal_entity_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS trading_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type text;            -- 'commercial', 'industrial', 'residential', 'government'
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_entity text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_email text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_phone text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_contact_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_contact_email text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pipedrive_org_id text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';  -- 'active', 'inactive', 'prospect'
