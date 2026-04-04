-- Rollback: Revert clients view-swap back to legacy table
BEGIN;

DROP TRIGGER IF EXISTS clients_view_insert ON public.clients;
DROP TRIGGER IF EXISTS clients_view_update ON public.clients;
DROP TRIGGER IF EXISTS clients_view_delete ON public.clients;
DROP FUNCTION IF EXISTS public._clients_view_insert();
DROP FUNCTION IF EXISTS public._clients_view_update();
DROP FUNCTION IF EXISTS public._clients_view_delete();
DROP VIEW IF EXISTS public.clients;
ALTER TABLE public._clients_legacy RENAME TO clients;

COMMIT;
