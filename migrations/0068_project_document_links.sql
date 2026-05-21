DO $$ BEGIN
  CREATE TYPE "document_root_scope_enum" AS ENUM ('project', 'company');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "document_activity_action_enum" AS ENUM (
    'upload',
    'download',
    'rename',
    'create_folder',
    'view',
    'checkout',
    'checkin',
    'discard_checkout',
    'restore_revision',
    'comment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "managed_document_state_enum" AS ENUM (
    'draft',
    'in_review',
    'approved',
    'superseded',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_document_domain_enum AS ENUM ('engineering', 'quality');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_document_status_enum AS ENUM (
    'draft',
    'submitted_for_review',
    'changes_required',
    'approved',
    'superseded',
    'rejected',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_document_review_status_enum AS ENUM (
    'draft',
    'submitted_for_review',
    'changes_required',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_document_sync_confidence_enum AS ENUM (
    'high',
    'medium',
    'low',
    'stale',
    'broken'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "company_sharepoint_roots" (
  "id" SERIAL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "drive_id" TEXT,
  "root_item_id" TEXT,
  "root_path" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE "company_sharepoint_roots"
    ADD CONSTRAINT "company_sharepoint_roots_kind_unique" UNIQUE ("kind");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "project_sharepoint_roots" (
  "id" SERIAL PRIMARY KEY,
  "project_id" INTEGER NOT NULL REFERENCES "public"."project_info"("id") ON DELETE CASCADE,
  "drive_id" TEXT,
  "root_item_id" TEXT,
  "root_path" TEXT NOT NULL,
  "configured_by_user_id" INTEGER REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "configured_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE "project_sharepoint_roots"
    ADD CONSTRAINT "project_sharepoint_roots_project_unique" UNIQUE ("project_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "managed_documents" (
  "id" SERIAL PRIMARY KEY,
  "root_scope" "document_root_scope_enum" NOT NULL,
  "project_id" INTEGER REFERENCES "public"."project_info"("id") ON DELETE CASCADE,
  "company_root_id" INTEGER REFERENCES "public"."company_sharepoint_roots"("id") ON DELETE CASCADE,
  "parent_folder_id" INTEGER,
  "drive_id" TEXT NOT NULL,
  "drive_item_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "current_revision_id" INTEGER,
  "owner_user_id" INTEGER REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "state" "managed_document_state_enum" NOT NULL DEFAULT 'draft',
  "created_by_user_id" INTEGER REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMP
);

ALTER TABLE "managed_documents"
  ADD COLUMN IF NOT EXISTS "parent_folder_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "managed_documents_drive_item_idx"
  ON "managed_documents" ("drive_id", "drive_item_id");

CREATE INDEX IF NOT EXISTS "managed_documents_project_idx"
  ON "managed_documents" ("project_id");

CREATE INDEX IF NOT EXISTS "managed_documents_company_root_idx"
  ON "managed_documents" ("company_root_id");

CREATE INDEX IF NOT EXISTS "managed_documents_owner_idx"
  ON "managed_documents" ("owner_user_id");

CREATE INDEX IF NOT EXISTS "managed_documents_parent_folder_idx"
  ON "managed_documents" ("parent_folder_id");

CREATE TABLE IF NOT EXISTS "document_revisions" (
  "id" SERIAL PRIMARY KEY,
  "document_id" INTEGER NOT NULL REFERENCES "public"."managed_documents"("id") ON DELETE CASCADE,
  "revision_number" INTEGER NOT NULL,
  "sharepoint_version_id" TEXT,
  "size_bytes" INTEGER,
  "content_hash" TEXT,
  "uploaded_by_user_id" INTEGER REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "uploaded_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "notes" TEXT,
  "is_current" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_controlled" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_revisions_doc_rev_idx"
  ON "document_revisions" ("document_id", "revision_number");

CREATE INDEX IF NOT EXISTS "document_revisions_current_idx"
  ON "document_revisions" ("document_id", "is_current");

DO $$ BEGIN
  ALTER TABLE "managed_documents"
    ADD CONSTRAINT "managed_documents_current_revision_fk"
    FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "document_locks" (
  "document_id" INTEGER PRIMARY KEY REFERENCES "public"."managed_documents"("id") ON DELETE CASCADE,
  "locked_by_user_id" INTEGER NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "locked_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMP,
  "client_agent" TEXT
);

CREATE TABLE IF NOT EXISTS "document_comments" (
  "id" SERIAL PRIMARY KEY,
  "document_id" INTEGER NOT NULL REFERENCES "public"."managed_documents"("id") ON DELETE CASCADE,
  "revision_id" INTEGER REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL,
  "parent_comment_id" INTEGER,
  "author_user_id" INTEGER NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "edited_at" TIMESTAMP,
  "deleted_at" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "document_comments_doc_idx"
  ON "document_comments" ("document_id", "created_at");

CREATE INDEX IF NOT EXISTS "document_comments_parent_idx"
  ON "document_comments" ("parent_comment_id");

CREATE TABLE IF NOT EXISTS "document_comment_mentions" (
  "comment_id" INTEGER NOT NULL REFERENCES "public"."document_comments"("id") ON DELETE CASCADE,
  "mentioned_user_id" INTEGER NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_comment_mentions_pk"
  ON "document_comment_mentions" ("comment_id", "mentioned_user_id");

CREATE INDEX IF NOT EXISTS "document_comment_mentions_user_idx"
  ON "document_comment_mentions" ("mentioned_user_id");

CREATE TABLE IF NOT EXISTS "document_activity" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "actor_role" TEXT,
  "root_scope" "document_root_scope_enum" NOT NULL,
  "project_id" INTEGER REFERENCES "public"."project_info"("id") ON DELETE SET NULL,
  "company_root_id" INTEGER REFERENCES "public"."company_sharepoint_roots"("id") ON DELETE SET NULL,
  "document_id" INTEGER REFERENCES "public"."managed_documents"("id") ON DELETE SET NULL,
  "revision_id" INTEGER REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL,
  "drive_id" TEXT NOT NULL,
  "item_id" TEXT,
  "item_path" TEXT,
  "item_name" TEXT,
  "action" "document_activity_action_enum" NOT NULL,
  "size_bytes" INTEGER,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "document_activity_project_idx"
  ON "document_activity" ("project_id", "created_at");

CREATE INDEX IF NOT EXISTS "document_activity_document_idx"
  ON "document_activity" ("document_id", "created_at");

CREATE INDEX IF NOT EXISTS "document_activity_user_idx"
  ON "document_activity" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "document_activity_action_idx"
  ON "document_activity" ("action", "created_at");

CREATE TABLE IF NOT EXISTS project_document_links (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  managed_document_id INTEGER REFERENCES managed_documents(id) ON DELETE SET NULL,
  domain project_document_domain_enum NOT NULL,
  document_type TEXT NOT NULL,
  discipline TEXT,
  revision TEXT,
  status project_document_status_enum NOT NULL DEFAULT 'draft',
  review_status project_document_review_status_enum NOT NULL DEFAULT 'draft',
  current_revision BOOLEAN NOT NULL DEFAULT TRUE,
  superseded BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  prepared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  requires_preng_signoff BOOLEAN NOT NULL DEFAULT FALSE,
  preng_signed_off_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  preng_signed_off_at TIMESTAMP,
  close_out_evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
  close_out_evidence_linked BOOLEAN NOT NULL DEFAULT FALSE,
  sharepoint_drive_id TEXT,
  sharepoint_item_id TEXT,
  sharepoint_web_url TEXT,
  sharepoint_folder_path TEXT,
  file_name TEXT,
  last_synced_at TIMESTAMP,
  sync_confidence project_document_sync_confidence_enum NOT NULL DEFAULT 'high',
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS project_document_links_project_domain_idx
  ON project_document_links(project_id, domain);

CREATE INDEX IF NOT EXISTS project_document_links_managed_document_idx
  ON project_document_links(managed_document_id);

CREATE INDEX IF NOT EXISTS project_document_links_sharepoint_item_idx
  ON project_document_links(sharepoint_drive_id, sharepoint_item_id);

CREATE INDEX IF NOT EXISTS project_document_links_status_idx
  ON project_document_links(status, review_status);
