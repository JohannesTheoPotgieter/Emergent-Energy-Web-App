-- 0103_qb_project_match.sql
--
-- Additive + idempotent (0097 convention): CREATE TABLE IF NOT EXISTS, FK in a
-- duplicate-safe DO block, indexes IF NOT EXISTS. Safe no-op on a healthy DB;
-- creates everything fresh on prod.
--
-- Per-project QuickBooks attribution bridge (G2 auto-matcher). Each QB document
-- is matched to a tracker line on (normalised invoice number AND ex-VAT amount
-- within tolerance) and inherits that line's project_id. Read/compare only.

CREATE TABLE IF NOT EXISTS "qb_project_match" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"qb_doc_id" text NOT NULL,
	"qb_doc_number" text,
	"invoice_no_norm" text,
	"qb_ex_vat_amount" numeric(15, 2),
	"tracker_ex_vat_amount" numeric(15, 2),
	"qb_date" date,
	"tracker_line_id" integer,
	"project_id" integer,
	"match_type" text NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(5, 4),
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "qb_project_match" ADD CONSTRAINT "qb_project_match_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_project_match_project_stream_idx" ON "qb_project_match" USING btree ("project_id","stream");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_project_match_type_idx" ON "qb_project_match" USING btree ("match_type","stream");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_project_match_qb_doc_idx" ON "qb_project_match" USING btree ("qb_doc_id","stream");
