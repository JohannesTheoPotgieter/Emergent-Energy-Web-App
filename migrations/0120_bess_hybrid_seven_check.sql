ALTER TABLE "project_info" ADD COLUMN "is_bess_hybrid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commissioning_items" ADD COLUMN "countersigned_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "commissioning_items" ADD COLUMN "countersigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "commissioning_items" ADD CONSTRAINT "commissioning_items_countersigned_by_user_id_users_id_fk" FOREIGN KEY ("countersigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;