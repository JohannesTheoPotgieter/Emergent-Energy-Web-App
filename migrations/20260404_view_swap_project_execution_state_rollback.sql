-- Rollback: view-swap for project_execution_state
BEGIN;

DROP TRIGGER IF EXISTS pes_view_insert ON public.project_execution_state;
DROP TRIGGER IF EXISTS pes_view_update ON public.project_execution_state;
DROP TRIGGER IF EXISTS pes_view_delete ON public.project_execution_state;
DROP FUNCTION IF EXISTS public._pes_view_insert();
DROP FUNCTION IF EXISTS public._pes_view_update();
DROP FUNCTION IF EXISTS public._pes_view_delete();
DROP VIEW IF EXISTS public.project_execution_state;
ALTER TABLE public._project_execution_state_legacy RENAME TO project_execution_state;

COMMIT;
