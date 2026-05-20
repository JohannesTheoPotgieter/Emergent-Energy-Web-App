ALTER TABLE "sp_settings" ADD COLUMN "last_success_at" timestamp;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "last_error_at" timestamp;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "last_error_message" text;