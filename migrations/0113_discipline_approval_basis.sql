ALTER TABLE "document_approval_requirements" ALTER COLUMN "taxonomy_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_approval_requirements" ADD COLUMN "discipline" text;--> statement-breakpoint
ALTER TABLE "document_approval_requirements" ADD COLUMN "subfolder_pattern" text;--> statement-breakpoint
ALTER TABLE "managed_documents" ADD COLUMN "discipline_folder_id" integer;--> statement-breakpoint
ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_discipline_folder_id_project_discipline_folders_id_fk" FOREIGN KEY ("discipline_folder_id") REFERENCES "public"."project_discipline_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_approval_req_discipline_idx" ON "document_approval_requirements" USING btree ("discipline");--> statement-breakpoint
CREATE INDEX "managed_documents_discipline_folder_idx" ON "managed_documents" USING btree ("discipline_folder_id");