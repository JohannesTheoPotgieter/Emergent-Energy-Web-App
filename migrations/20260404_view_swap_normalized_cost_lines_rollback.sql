-- Rollback: view-swap for normalized_cost_lines
BEGIN;

DROP TRIGGER IF EXISTS ncl_view_insert ON public.normalized_cost_lines;
DROP TRIGGER IF EXISTS ncl_view_update ON public.normalized_cost_lines;
DROP TRIGGER IF EXISTS ncl_view_delete ON public.normalized_cost_lines;
DROP FUNCTION IF EXISTS public._ncl_view_insert();
DROP FUNCTION IF EXISTS public._ncl_view_update();
DROP FUNCTION IF EXISTS public._ncl_view_delete();
DROP VIEW IF EXISTS public.normalized_cost_lines;
ALTER TABLE public._normalized_cost_lines_legacy RENAME TO normalized_cost_lines;

-- NOTE: _safe_parse_date function is shared with revenue lines.
-- Only drop it if revenue_lines rollback has also been applied:
-- DROP FUNCTION IF EXISTS public._safe_parse_date(TEXT);

COMMIT;
