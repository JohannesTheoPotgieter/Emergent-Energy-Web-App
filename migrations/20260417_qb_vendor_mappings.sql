-- QuickBooks Vendor ↔ App Counterparty mapping.
--
-- A QB vendor maps to exactly one app counterparty. Unlike the customer
-- mapping table (project scoped), this is counterparty scoped — one QB
-- vendor = one supplier record in the app, across every project the
-- supplier appears on.
--
-- Enables automatic project attribution on QB bills once the vendor has
-- been mapped to the canonical supplier.

BEGIN;

CREATE TABLE IF NOT EXISTS quickbooks_vendor_mappings (
  id                serial PRIMARY KEY,
  qb_vendor_id      text NOT NULL,
  qb_vendor_name    text,
  qb_realm_id       text NOT NULL,
  counterparty_id   integer NOT NULL,
  counterparty_name text,
  notes             text,
  created_by        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- One active mapping per (QB vendor, realm).
CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_vendor_mappings_vendor_idx
  ON quickbooks_vendor_mappings(qb_vendor_id, qb_realm_id)
  WHERE deleted_at IS NULL;

-- Fast lookup by counterparty (many vendors could in theory share a supplier).
CREATE INDEX IF NOT EXISTS quickbooks_vendor_mappings_counterparty_idx
  ON quickbooks_vendor_mappings(counterparty_id);

COMMENT ON TABLE quickbooks_vendor_mappings IS
  'Maps QuickBooks vendors to app counterparty records for automatic supplier classification on QB bills.';

COMMIT;
