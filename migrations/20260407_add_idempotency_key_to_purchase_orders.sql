-- Add idempotency_key column to purchase_orders
-- Prevents duplicate PO creation from double-clicks, browser resends,
-- and network retries. The check occurs BEFORE nextval('po_number_seq')
-- to avoid wasting sequence numbers.
-- NULL for POs created before this migration.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index: only enforce uniqueness where key is non-null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_idempotency_key
  ON purchase_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
