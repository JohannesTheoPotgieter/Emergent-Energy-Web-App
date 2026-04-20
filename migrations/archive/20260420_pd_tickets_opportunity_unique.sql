-- 2026-04-20 — Race-safe PD shadow.
-- Architect review of the Opportunity↔PD merge flagged that the lazy
-- shadow create in getOpportunityWithWorkflow() did `select; if-empty
-- insert` which can race under concurrent drawer opens.
--
-- Fix: enforce 1:1 between an opportunity and its PD shadow with a
-- partial unique index, then move the repository to onConflictDoNothing
-- + re-select. Partial (WHERE opportunity_id IS NOT NULL) so legacy
-- standalone PD tickets without an opportunity link are not affected.
--
-- Additive-only and idempotent: safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS pd_tickets_opportunity_id_unique
  ON public.pd_tickets (opportunity_id)
  WHERE opportunity_id IS NOT NULL;
