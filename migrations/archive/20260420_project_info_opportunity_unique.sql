-- 2026-04-20 — Race-safe Convert-to-Project.
-- Architect review of the Opportunity↔PD merge flagged that the
-- POST /api/opportunities/:id/convert-to-project handler does a "select
-- existing → if none, insert" precheck without a DB-level uniqueness
-- guarantee. Two concurrent convert clicks could each pass the precheck
-- and create duplicate project shells for the same opportunity.
--
-- Fix: enforce 1:1 between an opportunity and its converted project_info
-- shell with a partial unique index. Pre-check (in this commit) confirms
-- zero current duplicates so the index can be added safely.
--
-- Additive-only and idempotent: safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS project_info_opportunity_id_unique
  ON public.project_info (opportunity_id)
  WHERE opportunity_id IS NOT NULL;
