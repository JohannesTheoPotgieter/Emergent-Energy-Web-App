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
