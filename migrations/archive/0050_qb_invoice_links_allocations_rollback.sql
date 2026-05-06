-- Rollback for 0050_qb_invoice_links_allocations.sql.
--
-- Re-creates the two partial unique indexes that enforce the 1:1 invariant
-- on `quickbooks_invoice_links` and drops the allocation columns. Will fail
-- if many-to-many rows are present — operator must collapse the duplicate
-- active links first (e.g. by soft-deleting the smaller siblings).

DROP INDEX IF EXISTS quickbooks_invoice_links_qb_entity_idx;

ALTER TABLE quickbooks_invoice_links
  DROP CONSTRAINT IF EXISTS quickbooks_invoice_links_allocated_non_neg;

ALTER TABLE quickbooks_invoice_links
  DROP COLUMN IF EXISTS allocation_tolerance_applied;

ALTER TABLE quickbooks_invoice_links
  DROP COLUMN IF EXISTS allocated_amount_ex_vat;

CREATE UNIQUE INDEX uq_qb_links_app_entity_active
  ON quickbooks_invoice_links (app_entity_type, app_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_qb_links_qb_entity_active
  ON quickbooks_invoice_links (qb_entity_type, qb_entity_id, qb_realm_id)
  WHERE deleted_at IS NULL;
