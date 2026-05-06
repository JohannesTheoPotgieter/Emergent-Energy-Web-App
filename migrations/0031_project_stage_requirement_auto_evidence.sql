-- Task #84: Auto-populate stage gates from existing app data
-- Adds auto-evaluator columns to project_stage_requirements so the gate
-- auto-evaluator registry can persist what it detected without disturbing
-- the manual `status` column (which remains the user's source of override).
--
-- Columns:
--   auto_status        : RequirementStatus | NULL — what the evaluator detected
--   auto_source_label  : human label e.g. "Pipedrive deal #4123 — signed 12 Apr 2026"
--   auto_source_ref    : machine ref e.g. "opportunity:4123" used by deep-link helpers
--   auto_evidence_url  : direct deep-link URL for the user
--   auto_confidence    : 'high' | 'medium' (no 'low' — keeps signal noise out)
--   auto_computed_at   : timestamp of the last evaluation
--
-- All columns are nullable. NULL `auto_status` means "evaluator did not detect
-- anything for this item" (item still relies on manual completion).

ALTER TABLE project_stage_requirements
  ADD COLUMN IF NOT EXISTS auto_status TEXT,
  ADD COLUMN IF NOT EXISTS auto_source_label TEXT,
  ADD COLUMN IF NOT EXISTS auto_source_ref TEXT,
  ADD COLUMN IF NOT EXISTS auto_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS auto_confidence TEXT,
  ADD COLUMN IF NOT EXISTS auto_computed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS psr_auto_status_idx
  ON project_stage_requirements (auto_status)
  WHERE auto_status IS NOT NULL;
