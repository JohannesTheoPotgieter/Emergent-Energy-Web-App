-- Forward-only drop of the RETIRED per-project tracker-vs-QuickBooks columns
-- (manifest group 4). Project-keyed QB recon was retired (reconciliation-qb-gap
-- returned an empty map), so these columns were always NULL — value-neutral.
-- Idempotent + paired with a drizzle-bootstrap canary (applied iff cols gone).
ALTER TABLE "financial_reconciliation" DROP COLUMN IF EXISTS "tracker_vs_qb_status";--> statement-breakpoint
ALTER TABLE "financial_reconciliation" DROP COLUMN IF EXISTS "tracker_vs_qb_delta";