-- Idempotent guard: these columns were already added by 0045_qb_match_suggestions_rejection
-- (handwritten migration with IF NOT EXISTS). Drizzle regenerated them here without guards
-- because its snapshot (0044) pre-dated 0045. All statements use IF NOT EXISTS so this
-- migration is a safe no-op whether or not the columns already exist.
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejected_by" integer;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN IF NOT EXISTS "manual_override" boolean DEFAULT false NOT NULL;