ALTER TABLE "work_items" ADD COLUMN "plan_link_item_id" integer;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "plan_link_relation" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "plan_link_lead_days" integer DEFAULT 5;