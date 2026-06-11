-- 0104_qb_recon_line_ignores.sql
--
-- Additive + idempotent (0097 convention): CREATE TABLE IF NOT EXISTS, index
-- IF NOT EXISTS. Safe no-op on a healthy DB; creates everything fresh on prod.
--
-- Recon-ignore annotations for the COMPANY-wide tracker-vs-QuickBooks worklist
-- (G4 — accepted-difference suppression). Keyed on the recon line identity
-- (stream + normalised invoice number) because a company recon line has no
-- single QB entity id to hang off. Soft-deleted via deleted_at. The engine and
-- amounts are never mutated; an active row just drops the difference out of the
-- actionable worklist while keeping it visible + audited. READ/COMPARE only.

CREATE TABLE IF NOT EXISTS "qb_recon_line_ignores" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"invoice_no_norm" text NOT NULL,
	"invoice_no_raw" text,
	"tracker_amount_ex_vat" numeric(15, 2),
	"qb_amount_ex_vat" numeric(15, 2),
	"reason" text NOT NULL,
	"ignored_by_user_id" integer,
	"ignored_by_name" text,
	"ignored_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_recon_line_ignores_active_idx" ON "qb_recon_line_ignores" USING btree ("stream","invoice_no_norm") WHERE "qb_recon_line_ignores"."deleted_at" IS NULL;
