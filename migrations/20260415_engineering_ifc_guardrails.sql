-- Engineering workflow guardrails (additive, idempotent)
--
-- Introduces an explicit "controlled document" lifecycle on engineering
-- deliverables so that "approved" can no longer be silently equated with
-- "issued for construction". Also adds per-stage Definition of Done and
-- audit timestamps on project eng stages. All columns are nullable / have
-- safe defaults so existing rows and existing code paths keep working.
--
-- Safe to re-run: every column uses IF NOT EXISTS.

-- 1) projectEngDeliverables: controlled-document lifecycle
ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS released_for text NOT NULL DEFAULT 'draft';

ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS issued_for_construction_at timestamp;

ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS issued_for_construction_by integer
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS as_built_at timestamp;

ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS as_built_by integer
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_eng_deliverables
  ADD COLUMN IF NOT EXISTS superseded_by_id integer
    REFERENCES project_eng_deliverables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_eng_deliverables_released_for
  ON project_eng_deliverables (released_for);

-- 2) projectEngStages: handover/IFC audit timestamps
ALTER TABLE project_eng_stages
  ADD COLUMN IF NOT EXISTS ifc_issued_at timestamp;

ALTER TABLE project_eng_stages
  ADD COLUMN IF NOT EXISTS handover_ready_at timestamp;

-- 3) engStageTemplates: explicit Definition of Done per stage
ALTER TABLE eng_stage_templates
  ADD COLUMN IF NOT EXISTS definition_of_done text[];

-- 4) drawingRegister: explicit audit of IFC issuance (separate from the
--    free-form `status` column so that transitions can be queried)
ALTER TABLE drawing_register
  ADD COLUMN IF NOT EXISTS issued_for_construction_at timestamp;

ALTER TABLE drawing_register
  ADD COLUMN IF NOT EXISTS issued_for_construction_by integer
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE drawing_register
  ADD COLUMN IF NOT EXISTS as_built_at timestamp;

ALTER TABLE drawing_register
  ADD COLUMN IF NOT EXISTS as_built_by integer
    REFERENCES users(id) ON DELETE SET NULL;
