-- View-swap: public.project_info → core.projects
--
-- Converts the legacy project_info table into a view backed by core.projects.
-- All existing INSERT/UPDATE/DELETE statements continue to work transparently
-- via INSTEAD OF triggers — zero application code changes required.
--
-- NOTE: core.projects also absorbs project_execution_state columns. This view
-- only exposes the project_info columns. The project_execution_state view-swap
-- is handled separately.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS project_info_view_insert ON public.project_info;
--   DROP TRIGGER IF EXISTS project_info_view_update ON public.project_info;
--   DROP TRIGGER IF EXISTS project_info_view_delete ON public.project_info;
--   DROP FUNCTION IF EXISTS public._project_info_view_insert();
--   DROP FUNCTION IF EXISTS public._project_info_view_update();
--   DROP FUNCTION IF EXISTS public._project_info_view_delete();
--   DROP VIEW IF EXISTS public.project_info;
--   ALTER TABLE public._project_info_legacy RENAME TO project_info;

BEGIN;

-- ============================================================================
-- 1. Rename legacy table
-- ============================================================================

ALTER TABLE public.project_info RENAME TO _project_info_legacy;

-- ============================================================================
-- 2. Create view with legacy column names
-- ============================================================================

CREATE OR REPLACE VIEW public.project_info AS
SELECT
  p.id,
  p.project_name,
  p.size_kwp,
  p.pd,
  p.pm,
  p.contract_value,
  p.canonical_project_id,
  p.client_id,
  p.pm_user_id,
  p.pd_user_id,
  p.updated_at,
  p.deleted_at,
  p.site_id,
  p.opportunity_id,
  p.delivery_model,
  p.project_code
FROM core.projects p;

-- ============================================================================
-- 3. INSTEAD OF triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public._project_info_view_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO core.projects (
    id, legacy_project_info_id, project_name, size_kwp, pd, pm,
    contract_value, canonical_project_id, client_id,
    pm_user_id, pd_user_id, deleted_at,
    site_id, opportunity_id, delivery_model, project_code,
    last_synced_at, source_table, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.id, NEW.project_name, NEW.size_kwp, NEW.pd, NEW.pm,
    NEW.contract_value, NEW.canonical_project_id, NEW.client_id,
    NEW.pm_user_id, NEW.pd_user_id, NEW.deleted_at,
    NEW.site_id, NEW.opportunity_id, NEW.delivery_model, NEW.project_code,
    NOW(), 'public.project_info', NOW(), COALESCE(NEW.updated_at, NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    project_name = EXCLUDED.project_name,
    size_kwp = EXCLUDED.size_kwp,
    pd = EXCLUDED.pd,
    pm = EXCLUDED.pm,
    contract_value = EXCLUDED.contract_value,
    canonical_project_id = EXCLUDED.canonical_project_id,
    client_id = EXCLUDED.client_id,
    pm_user_id = EXCLUDED.pm_user_id,
    pd_user_id = EXCLUDED.pd_user_id,
    deleted_at = EXCLUDED.deleted_at,
    site_id = EXCLUDED.site_id,
    opportunity_id = EXCLUDED.opportunity_id,
    delivery_model = EXCLUDED.delivery_model,
    project_code = EXCLUDED.project_code,
    last_synced_at = NOW(),
    updated_at = NOW();
  -- Also maintain legacy table for rollback safety
  INSERT INTO public._project_info_legacy VALUES (NEW.*)
  ON CONFLICT (id) DO UPDATE SET
    project_name = EXCLUDED.project_name,
    size_kwp = EXCLUDED.size_kwp,
    client_id = EXCLUDED.client_id,
    pm_user_id = EXCLUDED.pm_user_id,
    pd_user_id = EXCLUDED.pd_user_id,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._project_info_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE core.projects SET
    project_name = NEW.project_name,
    size_kwp = NEW.size_kwp,
    pd = NEW.pd,
    pm = NEW.pm,
    contract_value = NEW.contract_value,
    canonical_project_id = NEW.canonical_project_id,
    client_id = NEW.client_id,
    pm_user_id = NEW.pm_user_id,
    pd_user_id = NEW.pd_user_id,
    deleted_at = NEW.deleted_at,
    site_id = NEW.site_id,
    opportunity_id = NEW.opportunity_id,
    delivery_model = NEW.delivery_model,
    project_code = NEW.project_code,
    last_synced_at = NOW(),
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;
  -- Also update legacy table
  UPDATE public._project_info_legacy SET
    project_name = NEW.project_name,
    size_kwp = NEW.size_kwp,
    pd = NEW.pd,
    pm = NEW.pm,
    contract_value = NEW.contract_value,
    canonical_project_id = NEW.canonical_project_id,
    client_id = NEW.client_id,
    pm_user_id = NEW.pm_user_id,
    pd_user_id = NEW.pd_user_id,
    deleted_at = NEW.deleted_at,
    site_id = NEW.site_id,
    opportunity_id = NEW.opportunity_id,
    delivery_model = NEW.delivery_model,
    project_code = NEW.project_code,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._project_info_view_delete() RETURNS trigger AS $$
BEGIN
  -- Soft-delete in promoted schema (preserve data)
  UPDATE core.projects SET deleted_at = NOW() WHERE id = OLD.id;
  -- Hard-delete from legacy table
  DELETE FROM public._project_info_legacy WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_info_view_insert INSTEAD OF INSERT ON public.project_info
  FOR EACH ROW EXECUTE FUNCTION public._project_info_view_insert();
CREATE TRIGGER project_info_view_update INSTEAD OF UPDATE ON public.project_info
  FOR EACH ROW EXECUTE FUNCTION public._project_info_view_update();
CREATE TRIGGER project_info_view_delete INSTEAD OF DELETE ON public.project_info
  FOR EACH ROW EXECUTE FUNCTION public._project_info_view_delete();

COMMIT;
