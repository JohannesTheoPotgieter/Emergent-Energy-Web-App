-- Rollback: view-swap for normalized_revenue_lines
BEGIN;

DROP TRIGGER IF EXISTS nrl_view_insert ON public.normalized_revenue_lines;
DROP TRIGGER IF EXISTS nrl_view_update ON public.normalized_revenue_lines;
DROP TRIGGER IF EXISTS nrl_view_delete ON public.normalized_revenue_lines;
DROP FUNCTION IF EXISTS public._nrl_view_insert();
DROP FUNCTION IF EXISTS public._nrl_view_update();
DROP FUNCTION IF EXISTS public._nrl_view_delete();
DROP VIEW IF EXISTS public.normalized_revenue_lines;
ALTER TABLE public._normalized_revenue_lines_legacy RENAME TO normalized_revenue_lines;

-- NOTE: _safe_parse_date function is shared with cost lines.
-- Only drop it if cost_lines rollback has also been applied:
-- DROP FUNCTION IF EXISTS public._safe_parse_date(TEXT);

COMMIT;
