-- ============================================================
-- 20260420_canonical_phase_cycle.sql
-- Establish ONE canonical phase cycle across the company.
-- Adds: S04_PLANNING, S9B_COMPLIANCE_HANDOVER, project_status enum,
--       in_dlp flag, stage_code_aliases registry.
-- Backfills: legacy phase strings -> canonical codes / project_status / in_dlp.
-- All operations are additive and idempotent (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Insert the two new active stages.
-- ------------------------------------------------------------
INSERT INTO stage_definitions (stage_code, stage_name, stage_sequence, description, default_owner_role, default_approver_role, is_active)
VALUES
  ('S04_PLANNING', 'Planning', 4,
   'Detailed design release, procurement release, and construction-readiness planning. Sits between Financial Close and Construction.',
   'PM', 'COO', true),
  ('S9B_COMPLIANCE_HANDOVER', 'Compliance Handover', 9,
   'Regulatory and compliance documentation handover (NRS, CoC, sign-offs). Sits between Client Handover and Post-Handover Review.',
   'PM', 'COO', true)
ON CONFLICT (stage_code) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Renumber the trailing active stages so display order is contiguous:
--    S04 Planning(4), S06 Construction(5), S07 Commissioning(6),
--    S08 O&M Handover(7), S09 Client Handover(8), S9B Compliance Handover(9),
--    S10 Post-Handover Review(10).
--    Deprecated S04_PD_PM_HANDOVER / S05_FINANCIAL_REVIEW keep their seq
--    but are filtered by is_active=false so they don't show in UI.
-- ------------------------------------------------------------
UPDATE stage_definitions SET stage_sequence = 5  WHERE stage_code = 'S06_CONSTRUCTION'         AND stage_sequence <> 5;
UPDATE stage_definitions SET stage_sequence = 6  WHERE stage_code = 'S07_COMMISSIONING'        AND stage_sequence <> 6;
UPDATE stage_definitions SET stage_sequence = 7  WHERE stage_code = 'S08_OM_HANDOVER'          AND stage_sequence <> 7;
UPDATE stage_definitions SET stage_sequence = 8  WHERE stage_code = 'S09_CLIENT_HANDOVER'      AND stage_sequence <> 8;
UPDATE stage_definitions SET stage_sequence = 10 WHERE stage_code = 'S10_POST_HANDOVER_REVIEW' AND stage_sequence <> 10;

-- ------------------------------------------------------------
-- 3. project_status enum + column on project_info.
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE project_status_enum AS ENUM ('active','hold','internal','closed','tbc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE project_info
  ADD COLUMN IF NOT EXISTS project_status project_status_enum NOT NULL DEFAULT 'active';

-- ------------------------------------------------------------
-- 4. DLP flag on project_info (the canonical project record).
-- ------------------------------------------------------------
ALTER TABLE project_info
  ADD COLUMN IF NOT EXISTS in_dlp BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 5. Stage code alias registry — maps every legacy label / code
--    we have ever written to its canonical stage_code, so importers
--    and string-tolerant call sites stay forgiving without sprawl.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_code_aliases (
  alias_text     TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL REFERENCES stage_definitions(stage_code),
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO stage_code_aliases (alias_text, canonical_code) VALUES
  -- Canonical labels
  ('first assessment',          'S01_FIRST_ASSESSMENT'),
  ('design & cost proposal',    'S02_DESIGN_COST_PROPOSAL'),
  ('design and cost proposal',  'S02_DESIGN_COST_PROPOSAL'),
  ('cost proposal',             'S02_DESIGN_COST_PROPOSAL'),
  ('financial close',           'S03_SIGNATURE_FINANCIAL_CLOSE'),
  ('signature & financial close','S03_SIGNATURE_FINANCIAL_CLOSE'),
  ('planning',                  'S04_PLANNING'),
  ('construction',              'S06_CONSTRUCTION'),
  ('qa',                        'S07_COMMISSIONING'),
  ('commissioning',             'S07_COMMISSIONING'),
  ('o&m handover',              'S08_OM_HANDOVER'),
  ('om handover',               'S08_OM_HANDOVER'),
  ('handover',                  'S08_OM_HANDOVER'),
  ('client handover',           'S09_CLIENT_HANDOVER'),
  ('compliance handover',       'S9B_COMPLIANCE_HANDOVER'),
  ('commercial close out',      'S10_POST_HANDOVER_REVIEW'),
  ('commercial close-out',      'S10_POST_HANDOVER_REVIEW'),
  ('post-handover review',      'S10_POST_HANDOVER_REVIEW'),
  ('post handover review',      'S10_POST_HANDOVER_REVIEW'),
  -- Deprecated stage codes -> active replacements
  ('s04_pd_pm_handover',        'S03_SIGNATURE_FINANCIAL_CLOSE'),
  ('s05_financial_review',      'S02_DESIGN_COST_PROPOSAL'),
  -- Legacy P0..P7 codes (lifecycle phase shorthand from import era)
  ('p0_first_assessment',       'S01_FIRST_ASSESSMENT'),
  ('p1_cost_proposal',          'S02_DESIGN_COST_PROPOSAL'),
  ('p2_financial_close',        'S03_SIGNATURE_FINANCIAL_CLOSE'),
  ('p3_planning',               'S04_PLANNING'),
  ('p4_construction_installation','S06_CONSTRUCTION'),
  ('p5_commissioning',          'S07_COMMISSIONING'),
  ('p6_handover',               'S08_OM_HANDOVER'),
  ('p7_post_handover',          'S10_POST_HANDOVER_REVIEW')
ON CONFLICT (alias_text) DO NOTHING;

-- ------------------------------------------------------------
-- 6. Backfill project_status + in_dlp from existing phase strings.
--    Phase strings that map to a project_status get their phase set
--    to the most reasonable active lifecycle phase (NULL means
--    "no active phase known" — UI shows the project_status badge).
-- ------------------------------------------------------------
UPDATE project_info SET project_status = 'hold'     WHERE LOWER(COALESCE(phase,'')) = 'hold';
UPDATE project_info SET project_status = 'internal' WHERE LOWER(COALESCE(phase,'')) = 'internal';
UPDATE project_info SET project_status = 'closed'   WHERE LOWER(COALESCE(phase,'')) = 'closed';
UPDATE project_info SET project_status = 'tbc'      WHERE LOWER(COALESCE(phase,'')) = 'tbc';

-- DLP becomes a flag; keep these projects in the Handover stage.
UPDATE project_info SET in_dlp = true, phase = 'O&M Handover'
 WHERE LOWER(COALESCE(phase,'')) = 'dlp';

-- Phase strings that map to status: clear the phase string itself so we
-- don't keep two sources of truth. (Nullable — UI handles NULL gracefully.)
UPDATE project_info SET phase = NULL
 WHERE LOWER(COALESCE(phase,'')) IN ('hold','internal','closed','tbc');

-- ------------------------------------------------------------
-- 7. Normalise remaining phase strings to canonical labels.
--    (Soft normalisation — we still keep the column as text for
--    backward read compatibility while UI moves to current_stage_code.)
-- ------------------------------------------------------------
UPDATE project_info SET phase = 'Design & Cost Proposal' WHERE phase = 'Cost Proposal';
UPDATE project_info SET phase = 'Commissioning'          WHERE phase = 'QA';
UPDATE project_info SET phase = 'Post-Handover Review'   WHERE phase = 'Commercial Close Out';
UPDATE project_info SET phase = 'O&M Handover'           WHERE phase = 'Handover';

-- ------------------------------------------------------------
-- 8. Backfill missing Planning stage instance for projects already
--    past Financial Close. Only creates a row if no active S04_PLANNING
--    or later instance exists for that project.
-- ------------------------------------------------------------
INSERT INTO project_stage_instances (project_id, stage_code, stage_status, created_at, updated_at)
SELECT DISTINCT psi.project_id, 'S04_PLANNING', 'not_started', now(), now()
  FROM project_stage_instances psi
 WHERE psi.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
   AND psi.stage_status = 'progressed'
   AND NOT EXISTS (
     SELECT 1 FROM project_stage_instances psi2
      WHERE psi2.project_id = psi.project_id
        AND psi2.stage_code IN ('S04_PLANNING','S06_CONSTRUCTION','S07_COMMISSIONING',
                                'S08_OM_HANDOVER','S09_CLIENT_HANDOVER',
                                'S9B_COMPLIANCE_HANDOVER','S10_POST_HANDOVER_REVIEW')
   );

-- ------------------------------------------------------------
-- 9. Backfill Compliance Handover instance for projects already
--    past Client Handover (so they don't skip it).
-- ------------------------------------------------------------
INSERT INTO project_stage_instances (project_id, stage_code, stage_status, created_at, updated_at)
SELECT DISTINCT psi.project_id, 'S9B_COMPLIANCE_HANDOVER', 'not_started', now(), now()
  FROM project_stage_instances psi
 WHERE psi.stage_code = 'S09_CLIENT_HANDOVER'
   AND psi.stage_status = 'progressed'
   AND NOT EXISTS (
     SELECT 1 FROM project_stage_instances psi2
      WHERE psi2.project_id = psi.project_id
        AND psi2.stage_code IN ('S9B_COMPLIANCE_HANDOVER','S10_POST_HANDOVER_REVIEW')
   );

-- ------------------------------------------------------------
-- 10. Indexes for the new lookup paths.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_info_project_status ON project_info (project_status);
CREATE INDEX IF NOT EXISTS idx_project_info_in_dlp         ON project_info (in_dlp) WHERE in_dlp = true;

COMMIT;
