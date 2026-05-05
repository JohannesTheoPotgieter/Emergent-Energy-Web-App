-- Many-to-many QuickBooks invoice links with explicit Rand allocations.
--
-- Drops the two active partial unique indexes that enforced the strict 1:1
-- invariant on `quickbooks_invoice_links` (one active link per app row, one
-- active link per QB doc) and replaces the contract with explicit per-link
-- allocations:
--
--   * Multiple ACTIVE rows may now exist for the same QB doc (one per
--     allocated app line).
--   * Multiple ACTIVE rows may exist for the same app line (one per QB
--     doc paying it off).
--   * The base 5-tuple uniqueness (app+qb+realm) still prevents duplicate
--     links between the *same* pair — that constraint stays.
--
-- New columns on `quickbooks_invoice_links`:
--   * allocated_amount_ex_vat numeric(15,2) NOT NULL
--       — the Rand value this link consumes from the QB doc total.
--       Backfilled from `qb_amount` so legacy single-link rows are read
--       as 100% allocations of their QB doc.
--   * allocation_tolerance_applied boolean NOT NULL DEFAULT false
--       — set true when the writer accepted a sibling group whose sum
--       differed from the QB doc total by less than the configured
--       tolerance (so finance can audit minor rounding adjustments).
--
-- Reversible via the rollback companion: re-adds the two unique indexes
-- (will fail if many-to-many data is already present, by design — the
-- operator must collapse allocations first).

ALTER TABLE quickbooks_invoice_links
  ADD COLUMN IF NOT EXISTS allocated_amount_ex_vat numeric(15, 2);

-- Backfill legacy single-link rows as 100% allocations of their QB doc.
-- Use 0.01 as a floor so the strict `> 0` invariant added below is never
-- violated by rows whose `qb_amount` was missing (these are anomalies the
-- writer would never produce; the floor keeps the migration non-destructive
-- so the operator can clean them up post-migrate).
UPDATE quickbooks_invoice_links
SET allocated_amount_ex_vat = GREATEST(COALESCE(qb_amount, 0.01), 0.01)
WHERE allocated_amount_ex_vat IS NULL;

ALTER TABLE quickbooks_invoice_links
  ALTER COLUMN allocated_amount_ex_vat SET NOT NULL;

ALTER TABLE quickbooks_invoice_links
  ADD COLUMN IF NOT EXISTS allocation_tolerance_applied boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS uq_qb_links_app_entity_active;
DROP INDEX IF EXISTS uq_qb_links_qb_entity_active;

-- Per-QB-doc fan-out lookup index (sibling group resolver hits this).
CREATE INDEX IF NOT EXISTS quickbooks_invoice_links_qb_entity_idx
  ON quickbooks_invoice_links (qb_entity_type, qb_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;

-- Strict invariant: every allocation must consume a positive Rand value.
-- The writer also rejects zero allocations, but the DB CHECK is the
-- authoritative guard. Drop any prior `>= 0` variant first so re-runs of
-- this migration converge on the strict version.
-- PostgreSQL does not support `ADD CONSTRAINT IF NOT EXISTS`, so wrap the
-- ALTER in a DO block that checks pg_constraint first (idempotent re-run).
ALTER TABLE quickbooks_invoice_links
  DROP CONSTRAINT IF EXISTS quickbooks_invoice_links_allocated_non_neg;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quickbooks_invoice_links_allocated_positive'
  ) THEN
    ALTER TABLE quickbooks_invoice_links
      ADD CONSTRAINT quickbooks_invoice_links_allocated_positive
      CHECK (allocated_amount_ex_vat > 0);
  END IF;
END$$;
