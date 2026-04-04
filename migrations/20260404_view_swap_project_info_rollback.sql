-- Rollback: Revert project_info view-swap back to legacy table
BEGIN;

DROP TRIGGER IF EXISTS project_info_view_insert ON public.project_info;
DROP TRIGGER IF EXISTS project_info_view_update ON public.project_info;
DROP TRIGGER IF EXISTS project_info_view_delete ON public.project_info;
DROP FUNCTION IF EXISTS public._project_info_view_insert();
DROP FUNCTION IF EXISTS public._project_info_view_update();
DROP FUNCTION IF EXISTS public._project_info_view_delete();
DROP VIEW IF EXISTS public.project_info;
ALTER TABLE public._project_info_legacy RENAME TO project_info;

COMMIT;
