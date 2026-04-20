-- 2026-04-20 — Tighten the pd_tickets opportunity unique scope.
-- The earlier 20260420_pd_tickets_opportunity_unique.sql index was too broad:
-- the legacy POST /api/opportunities/:id/create-engineering-tickets flow inserts
-- multiple project-scoped pd_tickets rows that share the same opportunity_id
-- (e.g. phase_template mode fan-out). Those are NOT shadow rows — only the
-- lazy-created PD shadow (project_id IS NULL) needs the 1:1 invariant.
--
-- Fix: replace the broad index with one scoped to shadow rows only.
-- Pre-check shows zero current rows have a non-null opportunity_id, so the
-- swap is data-safe today.
DROP INDEX IF EXISTS public.pd_tickets_opportunity_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pd_tickets_opportunity_shadow_unique
  ON public.pd_tickets (opportunity_id)
  WHERE opportunity_id IS NOT NULL AND project_id IS NULL;
