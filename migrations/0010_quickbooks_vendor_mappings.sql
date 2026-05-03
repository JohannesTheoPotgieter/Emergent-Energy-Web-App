-- =========================================================================
-- QB Vendor Mappings — QB Vendor ↔ App Counterparty link table.
--
-- Mirror of `quickbooks_customer_mappings` (project ↔ QB customer) for
-- the supplier side. Once a mapping exists, the QB recon engine resolves
-- historical bills from that QB vendor to the linked counterparty on the
-- next read — no row-level backfill required (bills are not persisted).
--
-- Matches Drizzle schema in shared/schema/integrations.ts:
--   export const quickbooksVendorMappings = pgTable("quickbooks_vendor_mappings", {...})
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "quickbooks_vendor_mappings" (
        "id" serial PRIMARY KEY NOT NULL,
        "qb_vendor_id" text NOT NULL,
        "qb_vendor_name" text,
        "qb_realm_id" text NOT NULL,
        "counterparty_id" integer NOT NULL,
        "counterparty_name" text,
        "notes" text,
        "created_by" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        "deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quickbooks_vendor_mappings" ADD CONSTRAINT "quickbooks_vendor_mappings_user_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quickbooks_vendor_mappings_vendor_idx"
  ON "quickbooks_vendor_mappings" ("qb_vendor_id", "qb_realm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quickbooks_vendor_mappings_counterparty_idx"
  ON "quickbooks_vendor_mappings" ("counterparty_id");
