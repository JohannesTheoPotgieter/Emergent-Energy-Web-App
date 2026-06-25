ALTER TABLE "procurement_items" ADD COLUMN "linked_work_item_id" integer;--> statement-breakpoint
ALTER TABLE "procurement_items" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "procurement_items" ADD COLUMN "order_date" date;