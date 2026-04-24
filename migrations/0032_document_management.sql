-- =========================================================================
-- Document Management (DM) — generic SharePoint browsing + versioning +
-- comments + activity log. Independent from Controlled Documents.
--
-- See shared/schema/documents.ts (bottom half) for the models. Approvals
-- are NOT introduced here; when wired up later we reuse the existing
-- `approvals` engine via relatedEntityType='managed_document'.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

-- Enum: document_root_scope_enum -----------------------------------------
DO $$ BEGIN
  CREATE TYPE "document_root_scope_enum" AS ENUM (
    'project', 'company'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Enum: document_activity_action_enum ------------------------------------
DO $$ BEGIN
  CREATE TYPE "document_activity_action_enum" AS ENUM (
    'upload', 'download', 'rename', 'create_folder', 'view',
    'checkout', 'checkin', 'discard_checkout', 'restore_revision', 'comment'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Enum: managed_document_state_enum --------------------------------------
DO $$ BEGIN
  CREATE TYPE "managed_document_state_enum" AS ENUM (
    'draft', 'in_review', 'approved', 'superseded', 'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Table: company_sharepoint_roots ----------------------------------------
CREATE TABLE IF NOT EXISTS "company_sharepoint_roots" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "display_name" text NOT NULL,
  "drive_id" text,
  "root_item_id" text,
  "root_path" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "company_sharepoint_roots"
    ADD CONSTRAINT "company_sharepoint_roots_kind_unique" UNIQUE ("kind");
EXCEPTION WHEN duplicate_object THEN null; WHEN duplicate_table THEN null; END $$;
--> statement-breakpoint

-- Table: managed_documents -----------------------------------------------
CREATE TABLE IF NOT EXISTS "managed_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "root_scope" "document_root_scope_enum" NOT NULL,
  "project_id" integer,
  "company_root_id" integer,
  "drive_id" text NOT NULL,
  "drive_item_id" text NOT NULL,
  "name" text NOT NULL,
  "path" text NOT NULL,
  "current_revision_id" integer,
  "owner_user_id" integer,
  "state" "managed_document_state_enum" NOT NULL DEFAULT 'draft',
  "created_by_user_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_company_root_fk"
    FOREIGN KEY ("company_root_id") REFERENCES "public"."company_sharepoint_roots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_owner_user_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_created_by_user_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "managed_documents_drive_item_idx"
  ON "managed_documents" ("drive_id", "drive_item_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "managed_documents_project_idx"
  ON "managed_documents" ("project_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "managed_documents_company_root_idx"
  ON "managed_documents" ("company_root_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "managed_documents_owner_idx"
  ON "managed_documents" ("owner_user_id");
--> statement-breakpoint

-- Table: document_revisions ----------------------------------------------
CREATE TABLE IF NOT EXISTS "document_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL,
  "revision_number" integer NOT NULL,
  "sharepoint_version_id" text,
  "size_bytes" integer,
  "content_hash" text,
  "uploaded_by_user_id" integer,
  "uploaded_at" timestamp NOT NULL DEFAULT now(),
  "notes" text,
  "is_current" boolean NOT NULL DEFAULT false,
  "is_controlled" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."managed_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_uploaded_by_user_fk"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "document_revisions_doc_rev_idx"
  ON "document_revisions" ("document_id", "revision_number");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_revisions_current_idx"
  ON "document_revisions" ("document_id", "is_current");
--> statement-breakpoint

-- Back-reference managed_documents.current_revision_id → document_revisions.id
-- Added AFTER document_revisions exists to avoid a circular CREATE.
DO $$ BEGIN
  ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_current_revision_fk"
    FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Table: document_locks --------------------------------------------------
CREATE TABLE IF NOT EXISTS "document_locks" (
  "document_id" integer PRIMARY KEY NOT NULL,
  "locked_by_user_id" integer NOT NULL,
  "locked_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "client_agent" text
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_locks" ADD CONSTRAINT "document_locks_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."managed_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_locks" ADD CONSTRAINT "document_locks_user_fk"
    FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Table: document_comments -----------------------------------------------
CREATE TABLE IF NOT EXISTS "document_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL,
  "revision_id" integer,
  "parent_comment_id" integer,
  "author_user_id" integer NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "edited_at" timestamp,
  "deleted_at" timestamp
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."managed_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_revision_fk"
    FOREIGN KEY ("revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_comments_doc_idx"
  ON "document_comments" ("document_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_comments_parent_idx"
  ON "document_comments" ("parent_comment_id");
--> statement-breakpoint

-- Table: document_comment_mentions ---------------------------------------
CREATE TABLE IF NOT EXISTS "document_comment_mentions" (
  "comment_id" integer NOT NULL,
  "mentioned_user_id" integer NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_comment_mentions" ADD CONSTRAINT "document_comment_mentions_comment_fk"
    FOREIGN KEY ("comment_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_comment_mentions" ADD CONSTRAINT "document_comment_mentions_user_fk"
    FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "document_comment_mentions_pk"
  ON "document_comment_mentions" ("comment_id", "mentioned_user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_comment_mentions_user_idx"
  ON "document_comment_mentions" ("mentioned_user_id");
--> statement-breakpoint

-- Table: document_activity -----------------------------------------------
CREATE TABLE IF NOT EXISTS "document_activity" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "actor_role" text,
  "root_scope" "document_root_scope_enum" NOT NULL,
  "project_id" integer,
  "company_root_id" integer,
  "document_id" integer,
  "revision_id" integer,
  "drive_id" text NOT NULL,
  "item_id" text,
  "item_path" text,
  "item_name" text,
  "action" "document_activity_action_enum" NOT NULL,
  "size_bytes" integer,
  "request_id" text,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_company_root_fk"
    FOREIGN KEY ("company_root_id") REFERENCES "public"."company_sharepoint_roots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."managed_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_revision_fk"
    FOREIGN KEY ("revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_activity_project_idx"
  ON "document_activity" ("project_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_activity_document_idx"
  ON "document_activity" ("document_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_activity_user_idx"
  ON "document_activity" ("user_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_activity_action_idx"
  ON "document_activity" ("action", "created_at");
