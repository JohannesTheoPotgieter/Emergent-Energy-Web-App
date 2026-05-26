-- Project Delivery audit (2026-05-26) — additive supplier-identity FK on POs.
-- Generated via `npm run db:generate --name=purchase_orders_counterparty_fk`,
-- then hardened with IF NOT EXISTS / EXCEPTION guards per § 6 of
-- docs/AGENT_GUARDRAILS.md ("additive only, every statement guarded").
--
-- The purchase_orders table previously stored supplier as free text only.
-- This adds an OPTIONAL counterparty_id FK so new POs can bind to the
-- canonical counterparties record. Existing rows keep NULL; legacy
-- routes that write supplier_name keep working.

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "counterparty_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
