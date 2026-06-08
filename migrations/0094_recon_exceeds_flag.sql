-- 0094_recon_exceeds_flag.sql
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to replay in
-- the bootstrap's batch. Canary probe in scripts/drizzle-bootstrap.ts.

ALTER TABLE "normalized_cost_line_actuals" ADD COLUMN IF NOT EXISTS "recon_exceeds" boolean;
