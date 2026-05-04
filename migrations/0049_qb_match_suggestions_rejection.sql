ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN "rejected_by" integer;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "quickbooks_match_suggestions" ADD COLUMN "manual_override" boolean DEFAULT false NOT NULL;