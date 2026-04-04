-- Migration: Create report history and scheduled reports tables
-- These tables were previously created inline in report-routes.ts
-- with no production guard. This migration formalizes them.
--
-- Rollback: DROP TABLE IF EXISTS scheduled_reports; DROP TABLE IF EXISTS report_history;

CREATE TABLE IF NOT EXISTS report_history (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  report_type TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  parameters TEXT,
  download_url TEXT,
  created_at TEXT NOT NULL,
  schedule_cron TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  report_type TEXT NOT NULL,
  format TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  parameters TEXT,
  created_at TEXT NOT NULL
);
