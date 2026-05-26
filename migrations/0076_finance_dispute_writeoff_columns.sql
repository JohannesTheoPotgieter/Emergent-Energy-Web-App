-- =========================================================================
-- TF-7 (Disputed invoice workflow) + TF-8 (Bad-debt write-off workflow)
-- from audit/FINANCE_AUDIT_V3_2026-05-26.md.
--
-- Owner-approved 2026-05-26.
--
-- Additive only:
--   1. Extend revenue_line_status enum with 'disputed' and 'written_off'.
--   2. Extend cost_line_status enum with 'disputed'.
--   3. Add dispute_opened_at / dispute_resolved_at / dispute_reason /
--      dispute_opened_by_user_id to both normalized_cost_lines and
--      normalized_revenue_lines.
--   4. Add write_off_authorised_by_user_id / write_off_authorised_at /
--      write_off_reason to normalized_revenue_lines (write-off is a
--      revenue-side concept — bad debt = customer who doesn't pay).
--
-- The SQL below is the drizzle-kit-generated form (so the
-- schema-drift CI guard is happy); the trailing partial indexes are
-- additive and human-authored — they don't appear in the drizzle
-- snapshot because drizzle has no first-class API for partial indexes
-- with WHERE clauses on snapshot columns.
--
-- NOT applied automatically — needs `npm run db:migrate` approval per
-- § 6 of docs/AGENT_GUARDRAILS.md.
-- =========================================================================

ALTER TYPE "public"."cost_line_status" ADD VALUE 'disputed';--> statement-breakpoint
ALTER TYPE "public"."revenue_line_status" ADD VALUE 'disputed';--> statement-breakpoint
ALTER TYPE "public"."revenue_line_status" ADD VALUE 'written_off';--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "dispute_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "dispute_resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD COLUMN "dispute_opened_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "dispute_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "dispute_resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "dispute_opened_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "write_off_authorised_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "write_off_authorised_at" timestamp;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "write_off_reason" text;--> statement-breakpoint
ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_dispute_opened_by_user_id_users_id_fk" FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_dispute_opened_by_user_id_users_id_fk" FOREIGN KEY ("dispute_opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_write_off_authorised_by_user_id_users_id_fk" FOREIGN KEY ("write_off_authorised_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Partial indexes — speed up "give me overdue AR excluding disputes"
-- and "give me write-offs in FY26" queries. Authored manually because
-- drizzle-kit doesn't surface partial indexes with WHERE clauses.
CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_dispute_open
  ON normalized_revenue_lines (project_id, dispute_resolved_at)
  WHERE dispute_opened_at IS NOT NULL AND dispute_resolved_at IS NULL AND effective_to IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_dispute_open
  ON normalized_cost_lines (project_id, dispute_resolved_at)
  WHERE dispute_opened_at IS NOT NULL AND dispute_resolved_at IS NULL AND effective_to IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_write_off
  ON normalized_revenue_lines (project_id, write_off_authorised_at)
  WHERE write_off_authorised_at IS NOT NULL AND effective_to IS NULL;
