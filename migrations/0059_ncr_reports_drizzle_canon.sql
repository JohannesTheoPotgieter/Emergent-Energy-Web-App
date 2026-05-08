-- Plan v3 Track D / T3-2 — bring ncr_reports under Drizzle canon.
-- Previously the table was created at runtime by `ensureNcrTables()` in
-- server/quality-ncr-routes.ts via `CREATE TABLE IF NOT EXISTS`. This
-- migration: (1) creates the enums, (2) ensures the columns the schema
-- now defines exist, (3) widens FKs to project_info / users / counterparties
-- where they were missing, (4) adds phase + sub-contractor + waived linkage.
-- Additive — no destructive backfill.

-- Enums first; both safe under IF NOT EXISTS via DO blocks.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_status') THEN
    CREATE TYPE ncr_status AS ENUM ('open', 'investigating', 'corrective_action', 'verification', 'closed', 'waived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_severity') THEN
    CREATE TYPE ncr_severity AS ENUM ('minor', 'major', 'critical');
  END IF;
END $$;

-- Ensure base table exists (idempotent — pre-existing runtime CREATE may have
-- run already in dev). Use the new shape with FKs.
CREATE TABLE IF NOT EXISTS ncr_reports (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  phase_at_raise_time TEXT,
  subcontractor_id INTEGER,
  related_checklist_item_id INTEGER,
  reported_by INTEGER NOT NULL,
  assigned_to INTEGER,
  closed_by_user_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'major',
  status TEXT NOT NULL DEFAULT 'open',
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  waiver_reason TEXT,
  due_date TEXT,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add new columns when the table pre-existed in a thinner shape.
ALTER TABLE ncr_reports ADD COLUMN IF NOT EXISTS phase_at_raise_time TEXT;
ALTER TABLE ncr_reports ADD COLUMN IF NOT EXISTS subcontractor_id INTEGER;
ALTER TABLE ncr_reports ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER;
ALTER TABLE ncr_reports ADD COLUMN IF NOT EXISTS waiver_reason TEXT;
ALTER TABLE ncr_reports ADD COLUMN IF NOT EXISTS related_checklist_item_id INTEGER;

-- Convert text severity / status to enums in place (only if currently text).
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'ncr_reports' AND column_name = 'severity') = 'text' THEN
    ALTER TABLE ncr_reports
      ALTER COLUMN severity DROP DEFAULT,
      ALTER COLUMN severity TYPE ncr_severity USING severity::ncr_severity,
      ALTER COLUMN severity SET DEFAULT 'major';
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'ncr_reports' AND column_name = 'status') = 'text' THEN
    ALTER TABLE ncr_reports
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE ncr_status USING status::ncr_status,
      ALTER COLUMN status SET DEFAULT 'open';
  END IF;
EXCEPTION WHEN others THEN NULL; -- pre-existing rows with non-enum-compatible values stay as-is via separate cleanup
END $$;

-- Convert closed_at from text to timestamp if it was created as text.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'ncr_reports' AND column_name = 'closed_at') = 'text' THEN
    ALTER TABLE ncr_reports ALTER COLUMN closed_at TYPE TIMESTAMP USING closed_at::TIMESTAMP;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- FKs (added if missing — pg_constraint check).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_project_id_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES project_info(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_subcontractor_id_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_subcontractor_id_fkey
      FOREIGN KEY (subcontractor_id) REFERENCES counterparties(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_related_checklist_item_id_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_related_checklist_item_id_fkey
      FOREIGN KEY (related_checklist_item_id) REFERENCES qc_item_instance(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_reported_by_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_reported_by_fkey
      FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_assigned_to_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_reports_closed_by_user_id_fkey') THEN
    ALTER TABLE ncr_reports ADD CONSTRAINT ncr_reports_closed_by_user_id_fkey
      FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for common reads.
CREATE INDEX IF NOT EXISTS ncr_reports_project_status_idx ON ncr_reports (project_id, status);
CREATE INDEX IF NOT EXISTS ncr_reports_subcontractor_status_idx ON ncr_reports (subcontractor_id, status);
CREATE INDEX IF NOT EXISTS ncr_reports_open_idx ON ncr_reports (status) WHERE status NOT IN ('closed', 'waived');

-- Children
CREATE TABLE IF NOT EXISTS ncr_attachments (
  id SERIAL PRIMARY KEY,
  ncr_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ncr_comments (
  id SERIAL PRIMARY KEY,
  ncr_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_attachments_ncr_id_fkey') THEN
    ALTER TABLE ncr_attachments ADD CONSTRAINT ncr_attachments_ncr_id_fkey
      FOREIGN KEY (ncr_id) REFERENCES ncr_reports(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_attachments_uploaded_by_fkey') THEN
    ALTER TABLE ncr_attachments ADD CONSTRAINT ncr_attachments_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_comments_ncr_id_fkey') THEN
    ALTER TABLE ncr_comments ADD CONSTRAINT ncr_comments_ncr_id_fkey
      FOREIGN KEY (ncr_id) REFERENCES ncr_reports(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_comments_user_id_fkey') THEN
    ALTER TABLE ncr_comments ADD CONSTRAINT ncr_comments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
