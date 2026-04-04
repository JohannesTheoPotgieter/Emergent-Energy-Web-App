-- Migration: Create standup_entries_v2 table
-- This table was previously created inline in standup-routes.ts
-- with no production guard. This migration formalizes it.
--
-- Rollback: DROP TABLE IF EXISTS standup_entries_v2;

CREATE TABLE IF NOT EXISTS standup_entries_v2 (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  yesterday TEXT,
  today TEXT,
  blockers TEXT,
  project_id INTEGER,
  team_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
