CREATE TABLE "work_item_document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"managed_document_id" integer,
	"project_document_link_id" integer,
	"link_role" text DEFAULT 'output' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_work_item_document_link" UNIQUE("work_item_id","managed_document_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_document_links" ADD CONSTRAINT "work_item_document_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_document_links" ADD CONSTRAINT "work_item_document_links_managed_document_id_managed_documents_id_fk" FOREIGN KEY ("managed_document_id") REFERENCES "public"."managed_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_document_links" ADD CONSTRAINT "work_item_document_links_project_document_link_id_project_document_links_id_fk" FOREIGN KEY ("project_document_link_id") REFERENCES "public"."project_document_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_document_links" ADD CONSTRAINT "work_item_document_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_document_links_work_item_idx" ON "work_item_document_links" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_document_links_managed_document_idx" ON "work_item_document_links" USING btree ("managed_document_id");