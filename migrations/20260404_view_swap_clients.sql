-- View-swap: public.clients → core.clients
--
-- Converts the legacy clients table into a view backed by core.clients.
-- All existing INSERT/UPDATE/DELETE statements continue to work transparently
-- via INSTEAD OF triggers — zero application code changes required.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS clients_view_insert ON public.clients;
--   DROP TRIGGER IF EXISTS clients_view_update ON public.clients;
--   DROP TRIGGER IF EXISTS clients_view_delete ON public.clients;
--   DROP FUNCTION IF EXISTS public._clients_view_insert();
--   DROP FUNCTION IF EXISTS public._clients_view_update();
--   DROP FUNCTION IF EXISTS public._clients_view_delete();
--   DROP VIEW IF EXISTS public.clients;
--   ALTER TABLE public._clients_legacy RENAME TO clients;

BEGIN;

-- ============================================================================
-- 1. Add legacy-only columns to core.clients so the view is complete
-- ============================================================================

ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS billing_entity TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS secondary_contact_name TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS secondary_contact_email TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS pipedrive_org_id TEXT;
ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- ============================================================================
-- 2. Backfill new columns from legacy data
-- ============================================================================

UPDATE core.clients c SET
  billing_entity = leg.billing_entity,
  secondary_contact_name = leg.secondary_contact_name,
  secondary_contact_email = leg.secondary_contact_email,
  industry = leg.industry,
  pipedrive_org_id = leg.pipedrive_org_id,
  status = COALESCE(leg.status, 'active')
FROM public.clients leg
WHERE c.legacy_id = leg.id
  AND (c.billing_entity IS DISTINCT FROM leg.billing_entity
    OR c.secondary_contact_name IS DISTINCT FROM leg.secondary_contact_name
    OR c.industry IS DISTINCT FROM leg.industry
    OR c.pipedrive_org_id IS DISTINCT FROM leg.pipedrive_org_id
    OR c.status IS DISTINCT FROM leg.status);

-- ============================================================================
-- 3. Rename legacy table
-- ============================================================================

ALTER TABLE public.clients RENAME TO _clients_legacy;

-- ============================================================================
-- 4. Create view with legacy column names
-- ============================================================================

CREATE OR REPLACE VIEW public.clients AS
SELECT
  c.id,
  c.client_code AS client_id,
  c.name,
  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at,
  c.legal_entity_name,
  c.trading_name,
  c.client_type,
  c.billing_entity,
  c.primary_contact_name,
  c.primary_contact_email,
  c.primary_contact_phone,
  c.secondary_contact_name,
  c.secondary_contact_email,
  c.industry,
  c.pipedrive_org_id,
  c.status
FROM core.clients c;

-- ============================================================================
-- 5. INSTEAD OF triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public._clients_view_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO core.clients (
    id, legacy_id, client_code, name, created_by, updated_by,
    legal_entity_name, trading_name, client_type, billing_entity,
    primary_contact_name, primary_contact_email, primary_contact_phone,
    secondary_contact_name, secondary_contact_email,
    industry, pipedrive_org_id, status,
    last_synced_at, source_table, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.id, NEW.client_id, NEW.name, NEW.created_by, NEW.updated_by,
    NEW.legal_entity_name, NEW.trading_name, NEW.client_type, NEW.billing_entity,
    NEW.primary_contact_name, NEW.primary_contact_email, NEW.primary_contact_phone,
    NEW.secondary_contact_name, NEW.secondary_contact_email,
    NEW.industry, NEW.pipedrive_org_id, COALESCE(NEW.status, 'active'),
    NOW(), 'public.clients', COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    client_code = EXCLUDED.client_code,
    updated_by = EXCLUDED.updated_by,
    legal_entity_name = EXCLUDED.legal_entity_name,
    trading_name = EXCLUDED.trading_name,
    client_type = EXCLUDED.client_type,
    billing_entity = EXCLUDED.billing_entity,
    primary_contact_name = EXCLUDED.primary_contact_name,
    primary_contact_email = EXCLUDED.primary_contact_email,
    primary_contact_phone = EXCLUDED.primary_contact_phone,
    secondary_contact_name = EXCLUDED.secondary_contact_name,
    secondary_contact_email = EXCLUDED.secondary_contact_email,
    industry = EXCLUDED.industry,
    pipedrive_org_id = EXCLUDED.pipedrive_org_id,
    status = EXCLUDED.status,
    last_synced_at = NOW(),
    updated_at = NOW();
  -- Also maintain legacy table for rollback safety
  INSERT INTO public._clients_legacy VALUES (NEW.*)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, client_id = EXCLUDED.client_id,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._clients_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE core.clients SET
    name = NEW.name,
    client_code = NEW.client_id,
    updated_by = NEW.updated_by,
    legal_entity_name = NEW.legal_entity_name,
    trading_name = NEW.trading_name,
    client_type = NEW.client_type,
    billing_entity = NEW.billing_entity,
    primary_contact_name = NEW.primary_contact_name,
    primary_contact_email = NEW.primary_contact_email,
    primary_contact_phone = NEW.primary_contact_phone,
    secondary_contact_name = NEW.secondary_contact_name,
    secondary_contact_email = NEW.secondary_contact_email,
    industry = NEW.industry,
    pipedrive_org_id = NEW.pipedrive_org_id,
    status = NEW.status,
    last_synced_at = NOW(),
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;
  -- Also update legacy table
  UPDATE public._clients_legacy SET
    name = NEW.name, client_id = NEW.client_id,
    updated_by = NEW.updated_by, updated_at = COALESCE(NEW.updated_at, NOW()),
    legal_entity_name = NEW.legal_entity_name,
    trading_name = NEW.trading_name, client_type = NEW.client_type,
    billing_entity = NEW.billing_entity,
    primary_contact_name = NEW.primary_contact_name,
    primary_contact_email = NEW.primary_contact_email,
    primary_contact_phone = NEW.primary_contact_phone,
    secondary_contact_name = NEW.secondary_contact_name,
    secondary_contact_email = NEW.secondary_contact_email,
    industry = NEW.industry, pipedrive_org_id = NEW.pipedrive_org_id,
    status = NEW.status
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._clients_view_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM core.clients WHERE id = OLD.id;
  DELETE FROM public._clients_legacy WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_view_insert INSTEAD OF INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_view_insert();
CREATE TRIGGER clients_view_update INSTEAD OF UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_view_update();
CREATE TRIGGER clients_view_delete INSTEAD OF DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_view_delete();

COMMIT;
