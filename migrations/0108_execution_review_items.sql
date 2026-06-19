CREATE TYPE "public"."execution_review_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."execution_review_status" AS ENUM('open', 'flagged', 'actioned', 'closed');--> statement-breakpoint
CREATE TABLE "execution_review_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"status" "execution_review_status" DEFAULT 'open' NOT NULL,
	"severity" "execution_review_severity" DEFAULT 'medium' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"owner_user_id" integer,
	"due_date" date,
	"meeting_date" date,
	"plan_task_no" text,
	"plan_work_item_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_review_items" ADD CONSTRAINT "execution_review_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;