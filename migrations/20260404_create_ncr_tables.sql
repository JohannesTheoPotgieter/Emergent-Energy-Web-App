-- Migration: Create NCR (Non-Conformance Report) tables
-- These tables were previously created inline in quality-ncr-routes.ts
-- with no production guard. This migration formalizes them.
--
-- Rollback: DROP TABLE IF EXISTS ncr_comments; DROP TABLE IF EXISTS ncr_attachments; DROP TABLE IF EXISTS ncr_reports;

CREATE TABLE IF NOT EXISTS ncr_reports (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  reported_by INTEGER NOT NULL,
  assigned_to INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  due_date TEXT,
  closed_at TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ncr_attachments (
  id SERIAL PRIMARY KEY,
  ncr_id INTEGER NOT NULL REFERENCES ncr_reports(id),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ncr_comments (
  id SERIAL PRIMARY KEY,
  ncr_id INTEGER NOT NULL REFERENCES ncr_reports(id),
  user_id INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
