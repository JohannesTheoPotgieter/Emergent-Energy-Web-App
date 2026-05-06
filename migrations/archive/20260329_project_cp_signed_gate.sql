-- CP Signed gate columns on project_info
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_date TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_signed_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_type TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS cp_evidence_ref TEXT;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS pm_task_pack_created BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS eng_post_cp_task_pack_created BOOLEAN NOT NULL DEFAULT false;
