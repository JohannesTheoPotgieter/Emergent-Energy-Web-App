-- =========================================================================
-- 0038: Document Management v2 — Active Clients folder taxonomy.
--
-- Establishes the new document-management spine that mirrors Emergent
-- Energy's SharePoint "Active Clients" structure (01 - Clients > 01 -
-- active projects > {Project} > 01_Financial Close … 14_Contractor
-- Shared Folder, plus the pre-construction PRE_* / PM tree).
--
-- New tables (all additive, idempotent):
--   folder_taxonomy                 — admin-editable canonical tree
--   project_folders                 — per-project instance rows
--   document_approval_requirements  — replaces controlled_document_types
--
-- Existing managed_documents gets a nullable parent_folder_id column so
-- a tracked file can point to its taxonomy folder.
--
-- Replaced (left in place this migration; will be dropped in a follow-up
-- destructive migration once D6 ships and the legacy code paths are
-- removed): controlled_document_types, controlled_documents,
-- project_sharepoint_roots. They carry no production data.
--
-- Hand-authored, additive, idempotent. Companion to the Drizzle schema
-- change in shared/schema/documents.ts.
-- =========================================================================

-- Enum: folder_lifecycle_mode_enum ----------------------------------------
DO $$ BEGIN
  CREATE TYPE "folder_lifecycle_mode_enum" AS ENUM (
    'pre_construction', 'full_lifecycle', 'both'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Table: folder_taxonomy --------------------------------------------------
CREATE TABLE IF NOT EXISTS "folder_taxonomy" (
  "id" serial PRIMARY KEY NOT NULL,
  "internal_key" text NOT NULL,
  "display_name" text NOT NULL,
  "parent_key" text,
  "lifecycle_mode" "folder_lifecycle_mode_enum" NOT NULL,
  "stage_code" text,
  "disciplines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- PostgreSQL requires the referenced column of a foreign key to be backed
-- by a UNIQUE CONSTRAINT (or PRIMARY KEY) — a plain unique index is not
-- enough. Add it explicitly so project_folders.taxonomy_key and
-- document_approval_requirements.taxonomy_key can FK to it.
DO $$ BEGIN
  ALTER TABLE "folder_taxonomy"
    ADD CONSTRAINT "folder_taxonomy_internal_key_uq" UNIQUE ("internal_key");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "folder_taxonomy_internal_key_idx"
  ON "folder_taxonomy" ("internal_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "folder_taxonomy_parent_idx"
  ON "folder_taxonomy" ("parent_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "folder_taxonomy_lifecycle_idx"
  ON "folder_taxonomy" ("lifecycle_mode");
--> statement-breakpoint

-- Table: project_folders --------------------------------------------------
CREATE TABLE IF NOT EXISTS "project_folders" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "taxonomy_key" text NOT NULL,
  "drive_id" text,
  "item_id" text,
  "sharepoint_path" text,
  "provisioned_at" timestamp,
  "provisioned_by_user_id" integer,
  "last_verified_at" timestamp,
  "verify_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_folders"
    ADD CONSTRAINT "project_folders_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "project_info"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_folders"
    ADD CONSTRAINT "project_folders_taxonomy_fk"
    FOREIGN KEY ("taxonomy_key") REFERENCES "folder_taxonomy"("internal_key");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_folders"
    ADD CONSTRAINT "project_folders_provisioned_by_fk"
    FOREIGN KEY ("provisioned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_folders_project_taxonomy_uq"
  ON "project_folders" ("project_id", "taxonomy_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_folders_project_idx"
  ON "project_folders" ("project_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_folders_taxonomy_idx"
  ON "project_folders" ("taxonomy_key");
--> statement-breakpoint

-- Table: document_approval_requirements -----------------------------------
CREATE TABLE IF NOT EXISTS "document_approval_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "taxonomy_key" text NOT NULL,
  "file_name_pattern" text,
  "display_name" text NOT NULL,
  "description" text,
  "approver_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "requires_all_approvers" boolean NOT NULL DEFAULT false,
  "extract_spec" jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_approval_requirements"
    ADD CONSTRAINT "doc_approval_req_taxonomy_fk"
    FOREIGN KEY ("taxonomy_key") REFERENCES "folder_taxonomy"("internal_key");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "doc_approval_req_taxonomy_idx"
  ON "document_approval_requirements" ("taxonomy_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "doc_approval_req_active_idx"
  ON "document_approval_requirements" ("active");
--> statement-breakpoint

-- managed_documents.parent_folder_id --------------------------------------
ALTER TABLE "managed_documents"
  ADD COLUMN IF NOT EXISTS "parent_folder_id" integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "managed_documents_parent_folder_idx"
  ON "managed_documents" ("parent_folder_id");
