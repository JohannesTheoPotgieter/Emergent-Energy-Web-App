-- Project Delivery audit (2026-05-26) — additive supplier-identity FK on POs.
--
-- The purchase_orders table previously stored supplier as free text
-- (supplier_name + supplier_vat + supplier_address + supplier_contact).
-- That left two parallel sources of truth for supplier identity (text
-- columns on PO rows; canonical counterparties record) and meant the
-- PO flow could not check supplier-side guardrails (payment terms must
-- exist, supplier must be active) before issuing.
--
-- This migration adds an OPTIONAL counterparty_id FK so new POs can
-- bind to the canonical record. The column is NULL for every existing
-- row, and the application code keeps writing the text fields, so the
-- change is fully backward compatible. A follow-up migration (after
-- backfill) can mark the column NOT NULL.
--
-- Per AGENT_GUARDRAILS.md § 6: additive only, guarded with IF NOT EXISTS.

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "counterparty_id" INTEGER;

DO $$ BEGIN
  ALTER TABLE "purchase_orders"
    ADD CONSTRAINT "purchase_orders_counterparty_fk"
    FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_po_counterparty"
  ON "purchase_orders" ("counterparty_id");
