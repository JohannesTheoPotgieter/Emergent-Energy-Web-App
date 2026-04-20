ALTER TABLE project_pd_pm_handover
  ADD COLUMN IF NOT EXISTS feasibility_status TEXT,
  ADD COLUMN IF NOT EXISTS feasibility_notes TEXT,
  ADD COLUMN IF NOT EXISTS dependency_summary TEXT,
  ADD COLUMN IF NOT EXISTS handover_readiness_status TEXT,
  ADD COLUMN IF NOT EXISTS handover_readiness_notes TEXT;
