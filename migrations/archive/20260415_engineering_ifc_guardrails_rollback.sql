-- Rollback for 20260415_engineering_ifc_guardrails.sql
-- All drops are IF EXISTS so re-running is safe.

DROP INDEX IF EXISTS idx_project_eng_deliverables_released_for;

ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS superseded_by_id;
ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS as_built_by;
ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS as_built_at;
ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS issued_for_construction_by;
ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS issued_for_construction_at;
ALTER TABLE project_eng_deliverables DROP COLUMN IF EXISTS released_for;

ALTER TABLE project_eng_stages DROP COLUMN IF EXISTS handover_ready_at;
ALTER TABLE project_eng_stages DROP COLUMN IF EXISTS ifc_issued_at;

ALTER TABLE eng_stage_templates DROP COLUMN IF EXISTS definition_of_done;

ALTER TABLE drawing_register DROP COLUMN IF EXISTS as_built_by;
ALTER TABLE drawing_register DROP COLUMN IF EXISTS as_built_at;
ALTER TABLE drawing_register DROP COLUMN IF EXISTS issued_for_construction_by;
ALTER TABLE drawing_register DROP COLUMN IF EXISTS issued_for_construction_at;
