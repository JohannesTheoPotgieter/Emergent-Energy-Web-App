-- Phase 5 decommission: hard-drop the legacy Active Clients folder-taxonomy +
-- manual SharePoint folder-provisioning surface. Browse-and-bind discipline
-- folders (project_discipline_folders) are now the sole project document
-- surface. Ordered FK -> index -> column -> tables -> enum, all IF EXISTS so
-- the migration is safe to (re)run regardless of CASCADE drop ordering.
ALTER TABLE "document_approval_requirements" DROP CONSTRAINT IF EXISTS "document_approval_requirements_taxonomy_key_folder_taxonomy_internal_key_fk";--> statement-breakpoint
ALTER TABLE "managed_documents" DROP CONSTRAINT IF EXISTS "managed_documents_parent_folder_id_project_folders_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "managed_documents_parent_folder_idx";--> statement-breakpoint
ALTER TABLE "managed_documents" DROP COLUMN IF EXISTS "parent_folder_id";--> statement-breakpoint
DROP TABLE IF EXISTS "project_folders" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "folder_taxonomy" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."folder_lifecycle_mode_enum";
