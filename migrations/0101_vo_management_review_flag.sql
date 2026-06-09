-- 0101_vo_management_review_flag.sql
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to replay in
-- the bootstrap's batch. Canary probe in scripts/drizzle-bootstrap.ts.
--
-- VO 5%-of-GP gate (BR-025/026): the change-control submit path freezes the
-- gate decision onto each VO (change_requests). `requires_management_review` is
-- set true when the VO's GP impact exceeds 5% of the project's canonical (§3.3)
-- GP; `gp_impact_pct_at_submit` records the ratio used for that decision.
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "requires_management_review" boolean;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "gp_impact_pct_at_submit" numeric(8, 4);
