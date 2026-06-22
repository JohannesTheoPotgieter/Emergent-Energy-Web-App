CREATE TABLE "revenue_milestone_task_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"revenue_row_hash" text NOT NULL,
	"work_item_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_cost_line_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"work_item_id" integer NOT NULL,
	"cost_row_hash" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_milestone_task_links" ADD CONSTRAINT "revenue_milestone_task_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_cost_line_links" ADD CONSTRAINT "task_cost_line_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_milestone_task_links_uniq" ON "revenue_milestone_task_links" USING btree ("project_id","revenue_row_hash","work_item_id");--> statement-breakpoint
CREATE INDEX "revenue_milestone_task_links_project_idx" ON "revenue_milestone_task_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "revenue_milestone_task_links_task_idx" ON "revenue_milestone_task_links" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_cost_line_links_uniq" ON "task_cost_line_links" USING btree ("project_id","work_item_id","cost_row_hash");--> statement-breakpoint
CREATE INDEX "task_cost_line_links_project_idx" ON "task_cost_line_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_cost_line_links_task_idx" ON "task_cost_line_links" USING btree ("work_item_id");