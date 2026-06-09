-- Forward-only DROP of the dead fye_kpi_counters rollup (manifest REMOVE-NOW:
-- its only reader was server/repositories/fye-tracking-repository.ts, which had
-- zero importers). Idempotent so it is safe on a db:push-built DB that never had
-- the table. Paired with a canary in scripts/drizzle-bootstrap.ts so the drop
-- actually runs on an existing (presumed-applied) DB.
DROP TABLE IF EXISTS "fye_kpi_counters" CASCADE;