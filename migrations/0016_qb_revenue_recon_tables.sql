-- =========================================================================
-- QB Reconciliation — Revenue Tracker Gap support tables (Task #18).
--
-- Mirrors migrations/0008_qb_recon_tables.sql but for the revenue side
-- (Invoices + Customers) instead of the cost side (Bills + Classes).
--
-- Pure annotation tables — `normalized_revenue_lines` remains the source
-- of truth; these only store finance's disposition of QB invoices the
-- revenue gap report surfaces.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "qb_revenue_recon_ignores" (
        "id" serial PRIMARY KEY NOT NULL,
        "qb_invoice_id" text NOT NULL,
        "qb_line_id" text,
        "qb_doc_number" text,
        "customer_name" text,
        "line_amount_ex_vat" numeric(14,2),
        "resolved_project_name" text,
        "reason" text NOT NULL,
        "ignored_by_user_id" integer,
        "ignored_by_name" text,
        "ignored_at" timestamp DEFAULT now() NOT NULL,
        "deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_revenue_recon_ignores" ADD CONSTRAINT "qb_revenue_recon_ignores_user_fk" FOREIGN KEY ("ignored_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qb_revenue_recon_ignores_invoice" ON "qb_revenue_recon_ignores" ("qb_invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qb_revenue_recon_ignores_active" ON "qb_revenue_recon_ignores" ("deleted_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_customer_project_overrides" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_ref_name" text NOT NULL,
        "project_name" text NOT NULL,
        "note" text,
        "created_by_user_id" integer,
        "created_by_name" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_customer_project_overrides" ADD CONSTRAINT "qb_customer_project_overrides_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_qb_customer_project_overrides_customer_active"
  ON "qb_customer_project_overrides" (LOWER("customer_ref_name")) WHERE "deleted_at" IS NULL;
