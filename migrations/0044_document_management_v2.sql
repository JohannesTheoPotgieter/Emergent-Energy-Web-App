CREATE TYPE "public"."folder_lifecycle_mode_enum" AS ENUM('pre_construction', 'full_lifecycle', 'both');--> statement-breakpoint
CREATE TABLE "document_approval_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"taxonomy_key" text NOT NULL,
	"file_name_pattern" text,
	"display_name" text NOT NULL,
	"description" text,
	"approver_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_all_approvers" boolean DEFAULT false NOT NULL,
	"extract_spec" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_taxonomy" (
	"id" serial PRIMARY KEY NOT NULL,
	"internal_key" text NOT NULL,
	"display_name" text NOT NULL,
	"parent_key" text,
	"lifecycle_mode" "folder_lifecycle_mode_enum" NOT NULL,
	"stage_code" text,
	"disciplines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "folder_taxonomy_internal_key_unique" UNIQUE("internal_key")
);
--> statement-breakpoint
CREATE TABLE "project_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"taxonomy_key" text NOT NULL,
	"drive_id" text,
	"item_id" text,
	"sharepoint_path" text,
	"web_url" text,
	"provisioned_at" timestamp,
	"provisioned_by_user_id" integer,
	"last_verified_at" timestamp,
	"verify_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_documents" ADD COLUMN "parent_folder_id" integer;--> statement-breakpoint
ALTER TABLE "document_approval_requirements" ADD CONSTRAINT "document_approval_requirements_taxonomy_key_folder_taxonomy_internal_key_fk" FOREIGN KEY ("taxonomy_key") REFERENCES "public"."folder_taxonomy"("internal_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_taxonomy" ADD CONSTRAINT "folder_taxonomy_parent_key_folder_taxonomy_internal_key_fk" FOREIGN KEY ("parent_key") REFERENCES "public"."folder_taxonomy"("internal_key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_taxonomy" ADD CONSTRAINT "folder_taxonomy_stage_code_stage_definitions_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."stage_definitions"("stage_code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_taxonomy_key_folder_taxonomy_internal_key_fk" FOREIGN KEY ("taxonomy_key") REFERENCES "public"."folder_taxonomy"("internal_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_provisioned_by_user_id_users_id_fk" FOREIGN KEY ("provisioned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_approval_req_taxonomy_idx" ON "document_approval_requirements" USING btree ("taxonomy_key");--> statement-breakpoint
CREATE INDEX "doc_approval_req_active_idx" ON "document_approval_requirements" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_taxonomy_internal_key_idx" ON "folder_taxonomy" USING btree ("internal_key");--> statement-breakpoint
CREATE INDEX "folder_taxonomy_parent_idx" ON "folder_taxonomy" USING btree ("parent_key");--> statement-breakpoint
CREATE INDEX "folder_taxonomy_lifecycle_idx" ON "folder_taxonomy" USING btree ("lifecycle_mode");--> statement-breakpoint
CREATE INDEX "folder_taxonomy_stage_idx" ON "folder_taxonomy" USING btree ("stage_code");--> statement-breakpoint
CREATE UNIQUE INDEX "project_folders_project_taxonomy_uq" ON "project_folders" USING btree ("project_id","taxonomy_key");--> statement-breakpoint
CREATE INDEX "project_folders_project_idx" ON "project_folders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_folders_taxonomy_idx" ON "project_folders" USING btree ("taxonomy_key");--> statement-breakpoint
ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_parent_folder_id_project_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."project_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_documents_parent_folder_idx" ON "managed_documents" USING btree ("parent_folder_id");