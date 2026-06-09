-- Forward-only DROP of the retired vat_period_locks table. VAT is handled
-- entirely in QuickBooks, so the in-app VAT-period-lock feature (table +
-- vat-period-service + shape test) is removed. The table was never written by
-- any app code path (its only inserter, lockVatPeriod(), had zero callers), so
-- the drop is value-neutral. Idempotent (IF EXISTS) so it is safe on a
-- db:push-built DB that never had the table, and paired with a canary in
-- scripts/drizzle-bootstrap.ts so the drop actually runs on an existing
-- (presumed-applied) DB.
DROP TABLE IF EXISTS "vat_period_locks" CASCADE;
