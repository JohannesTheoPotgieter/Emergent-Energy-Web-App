-- Rollback for 20260407_add_idempotency_key_to_purchase_orders.sql
-- Removes the idempotency_key column and its partial unique index
-- from purchase_orders.
--
-- DATA-LOSS CAVEAT: Any idempotency keys stored in the column will be
-- permanently lost. Re-running the forward migration will re-add the
-- column but existing keys cannot be recovered.

BEGIN;

DROP INDEX IF EXISTS idx_po_idempotency_key;

ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS idempotency_key;

COMMIT;
