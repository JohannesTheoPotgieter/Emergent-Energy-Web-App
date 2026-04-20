-- =========================================================================
-- Absorbed from the hand-written migrations/archive/20260420_opportunity_province.sql
-- into the Drizzle journal (Phase 7 incidental). The ALTER below matches the
-- Drizzle schema change; the archived file also carried a one-shot backfill
-- (UPDATE opportunities SET province = pd.province FROM pd_tickets ...) that
-- was already applied to prod and is NOT re-run here. Dev DBs that want
-- province populated should run the backfill manually from the archived file.
-- =========================================================================

ALTER TABLE "opportunities" ADD COLUMN "province" text;