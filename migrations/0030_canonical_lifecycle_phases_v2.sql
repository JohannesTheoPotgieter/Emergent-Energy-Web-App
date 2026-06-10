-- ============================================================
-- 0030_canonical_lifecycle_phases_v2.sql
-- Update the canonical lifecycle to v2 (2026-04-24):
--   1. Rename "Design & Cost Proposal"  -> "Cost Proposal & Design"
--   2. Rename "Post-Handover Review"    -> "3 Months Post HO Review"
--   3. Swap order: 3 Months Post HO Review = 9, Compliance Handover = 10
--   4. Add two terminal "branch" stages:
--        S_HOLD (Hold)  — resumable, preserves prior phase
--        S_DONE (Done)  — permanent terminal
--   5. Backfill projects with project_status='hold' to a Hold stage
--      instance (storing prior phase in project_execution_state.previous_phase
--      and stage instance notes), and project_status='closed' to a Done
--      stage instance.
--
-- All operations are additive and idempotent (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Add the two terminal "branch" stages.
-- ------------------------------------------------------------
INSERT INTO stage_definitions (stage_code, stage_name, stage_sequence, description, default_owner_role, default_approver_role, is_active)
VALUES
  ('S_HOLD', 'Hold', 0,
   'Terminal "branch" stage — project is parked. Resumable: project_execution_state.previous_phase preserves the sequential phase the project was in, so it can pick up where it left off.',
   NULL, NULL, true),
  ('S_DONE', 'Done', 0,
   'Terminal "branch" stage — project is closed/done. Permanent terminal: no further sequential progression.',
   NULL, NULL, true)
ON CONFLICT (stage_code) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Rename canonical labels.
-- ------------------------------------------------------------
UPDATE stage_definitions SET stage_name = 'Cost Proposal & Design'
 WHERE stage_code = 'S02_DESIGN_COST_PROPOSAL'
   AND stage_name <> 'Cost Proposal & Design';

UPDATE stage_definitions SET stage_name = '3 Months Post HO Review'
 WHERE stage_code = 'S10_POST_HANDOVER_REVIEW'
   AND stage_name <> '3 Months Post HO Review';

-- ------------------------------------------------------------
-- 3. Swap display order so 3 Months Post HO Review sits at 9 and
--    Compliance Handover sits at 10 (compliance is the final
--    sequential phase). Two-step swap via temporary sentinel to
--    avoid violating any future unique constraint on stage_sequence.
-- ------------------------------------------------------------
UPDATE stage_definitions SET stage_sequence = 999 WHERE stage_code = 'S10_POST_HANDOVER_REVIEW';
UPDATE stage_definitions SET stage_sequence = 10  WHERE stage_code = 'S9B_COMPLIANCE_HANDOVER';
UPDATE stage_definitions SET stage_sequence = 9   WHERE stage_code = 'S10_POST_HANDOVER_REVIEW';

-- ------------------------------------------------------------
-- 4. Extend stage_code_aliases for the new labels and terminal branches.
-- ------------------------------------------------------------
-- GUARDED 2026-06-10 (migration-ledger integrity repair): this section
-- references prod-era legacy artifacts (stage_code_aliases and/or
-- project_info.phase / execution_phase) that schema-built fresh databases
-- never had, so the unguarded statements failed migrate-from-zero at parse
-- time. plpgsql resolves statements lazily, so on a fresh DB the body is
-- never parsed. DML is unchanged.
DO $lc_v2_aliases$
BEGIN
IF EXISTS (
     SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'stage_code_aliases'
   ) THEN

INSERT INTO stage_code_aliases (alias_text, canonical_code) VALUES
  -- New canonical labels (and tolerated variants)
  ('cost proposal & design',      'S02_DESIGN_COST_PROPOSAL'),
  ('cost proposal and design',    'S02_DESIGN_COST_PROPOSAL'),
  ('cost proposal/design',        'S02_DESIGN_COST_PROPOSAL'),
  ('3 months post ho review',     'S10_POST_HANDOVER_REVIEW'),
  ('3 month post ho review',      'S10_POST_HANDOVER_REVIEW'),
  ('three months post ho review', 'S10_POST_HANDOVER_REVIEW'),
  -- Terminal branch aliases
  ('hold',                        'S_HOLD'),
  ('on hold',                     'S_HOLD'),
  ('on-hold',                     'S_HOLD'),
  ('parked',                      'S_HOLD'),
  ('done',                        'S_DONE'),
  ('closed',                      'S_DONE'),
  ('gone',                        'S_DONE'),
  ('complete',                    'S_DONE'),
  ('completed',                   'S_DONE'),
  ('cancelled',                   'S_DONE'),
  ('canceled',                    'S_DONE')
ON CONFLICT (alias_text) DO UPDATE SET canonical_code = EXCLUDED.canonical_code;

END IF;
END $lc_v2_aliases$;

-- ------------------------------------------------------------
-- 5. Add previous_phase column to project_execution_state so Hold
--    can preserve where the project was before being parked.
-- ------------------------------------------------------------
ALTER TABLE project_execution_state
  ADD COLUMN IF NOT EXISTS previous_phase TEXT;

-- ------------------------------------------------------------
-- 6. Normalise legacy phase strings to the new canonical labels.
--    project_info still carries phase + execution_phase columns;
--    project_execution_state mirrors them.
-- ------------------------------------------------------------
-- GUARDED 2026-06-10 (migration-ledger integrity repair): this section
-- references prod-era legacy artifacts (stage_code_aliases and/or
-- project_info.phase / execution_phase) that schema-built fresh databases
-- never had, so the unguarded statements failed migrate-from-zero at parse
-- time. plpgsql resolves statements lazily, so on a fresh DB the body is
-- never parsed. DML is unchanged.
DO $lc_v2_pi_phase$
BEGIN
IF EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_info' AND column_name = 'phase'
   )
   AND EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_info' AND column_name = 'execution_phase'
   ) THEN

UPDATE project_info
   SET phase = 'Cost Proposal & Design'
 WHERE phase IN ('Design & Cost Proposal', 'Cost Proposal');
UPDATE project_info
   SET execution_phase = 'Cost Proposal & Design'
 WHERE execution_phase IN ('Design & Cost Proposal', 'Cost Proposal');
UPDATE project_info
   SET phase = '3 Months Post HO Review'
 WHERE phase IN ('Post-Handover Review', 'Commercial Close Out', 'Commercial Close out', 'Closeout');
UPDATE project_info
   SET execution_phase = '3 Months Post HO Review'
 WHERE execution_phase IN ('Post-Handover Review', 'Commercial Close Out', 'Commercial Close out', 'Closeout');

END IF;
END $lc_v2_pi_phase$;

UPDATE project_execution_state
   SET phase = 'Cost Proposal & Design'
 WHERE phase IN ('Design & Cost Proposal', 'Cost Proposal');
UPDATE project_execution_state
   SET execution_phase = 'Cost Proposal & Design'
 WHERE execution_phase IN ('Design & Cost Proposal', 'Cost Proposal');
UPDATE project_execution_state
   SET phase = '3 Months Post HO Review'
 WHERE phase IN ('Post-Handover Review', 'Commercial Close Out', 'Commercial Close out', 'Closeout');
UPDATE project_execution_state
   SET execution_phase = '3 Months Post HO Review'
 WHERE execution_phase IN ('Post-Handover Review', 'Commercial Close Out', 'Commercial Close out', 'Closeout');

-- ------------------------------------------------------------
-- 7. Backfill terminal branch stage instances.
--
--    For projects with project_status='hold': create an S_HOLD
--    project_stage_instance (or update an existing one) and copy the
--    current sequential phase into project_execution_state.previous_phase
--    AND into the stage instance notes so we can resume the project later.
--
--    For projects with project_status='closed': create an S_DONE
--    project_stage_instance.
-- ------------------------------------------------------------

-- 7a. Capture previous_phase for held projects (only if not already set).
--
--     The runtime resume path writes previous_phase straight into
--     current_stage_code, so it MUST be a canonical sequential stage
--     code — never a free-form phase label. Resolution order:
--       1. pes.current_stage_code if it's already a sequential code.
--       2. Resolve pes.phase, pi.phase, pi.execution_phase (in that
--          order) through stage_code_aliases (case-insensitive).
--       3. Direct match against stage_definitions.stage_code if the
--          label is itself a code.
--       4. Leave NULL if nothing resolves — better to require an
--          explicit pick on resume than to corrupt current_stage_code.
-- GUARDED 2026-06-10 (migration-ledger integrity repair): this section
-- references prod-era legacy artifacts (stage_code_aliases and/or
-- project_info.phase / execution_phase) that schema-built fresh databases
-- never had, so the unguarded statements failed migrate-from-zero at parse
-- time. plpgsql resolves statements lazily, so on a fresh DB the body is
-- never parsed. DML is unchanged.
DO $lc_v2_prev_phase$
BEGIN
IF EXISTS (
     SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'stage_code_aliases'
   )
   AND EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_info' AND column_name = 'phase'
   )
   AND EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_info' AND column_name = 'execution_phase'
   ) THEN

WITH sequential_codes AS (
  SELECT stage_code FROM stage_definitions
   WHERE stage_code NOT IN ('S_HOLD', 'S_DONE')
),
resolved AS (
  SELECT
    pes.project_id,
    -- Step 1: current_stage_code if sequential.
    CASE
      WHEN pes.current_stage_code IN (SELECT stage_code FROM sequential_codes)
        THEN pes.current_stage_code
      ELSE NULL
    END AS from_current,
    -- Step 2: alias lookup over the three label sources.
    (SELECT a.canonical_code FROM stage_code_aliases a
      WHERE LOWER(a.alias_text) = LOWER(NULLIF(pes.phase, ''))
        AND a.canonical_code IN (SELECT stage_code FROM sequential_codes)
      LIMIT 1) AS from_pes_phase_alias,
    (SELECT a.canonical_code FROM stage_code_aliases a
       JOIN project_info pi ON pi.id = pes.project_id
      WHERE LOWER(a.alias_text) = LOWER(NULLIF(pi.phase, ''))
        AND a.canonical_code IN (SELECT stage_code FROM sequential_codes)
      LIMIT 1) AS from_pi_phase_alias,
    (SELECT a.canonical_code FROM stage_code_aliases a
       JOIN project_info pi ON pi.id = pes.project_id
      WHERE LOWER(a.alias_text) = LOWER(NULLIF(pi.execution_phase, ''))
        AND a.canonical_code IN (SELECT stage_code FROM sequential_codes)
      LIMIT 1) AS from_pi_exec_phase_alias,
    -- Step 3: literal stage_code match (some imports store the code
    -- itself in pes.phase).
    CASE WHEN pes.phase IN (SELECT stage_code FROM sequential_codes) THEN pes.phase ELSE NULL END AS from_pes_phase_literal,
    (SELECT pi.phase FROM project_info pi
      WHERE pi.id = pes.project_id
        AND pi.phase IN (SELECT stage_code FROM sequential_codes)) AS from_pi_phase_literal,
    (SELECT pi.execution_phase FROM project_info pi
      WHERE pi.id = pes.project_id
        AND pi.execution_phase IN (SELECT stage_code FROM sequential_codes)) AS from_pi_exec_phase_literal
  FROM project_execution_state pes
  WHERE pes.project_id IN (SELECT id FROM project_info WHERE project_status = 'hold')
    AND (pes.previous_phase IS NULL OR pes.previous_phase = '' OR pes.previous_phase NOT IN (SELECT stage_code FROM sequential_codes))
)
UPDATE project_execution_state pes
   SET previous_phase = COALESCE(
         resolved.from_current,
         resolved.from_pes_phase_alias,
         resolved.from_pi_phase_alias,
         resolved.from_pi_exec_phase_alias,
         resolved.from_pes_phase_literal,
         resolved.from_pi_phase_literal,
         resolved.from_pi_exec_phase_literal
       )
  FROM resolved
 WHERE resolved.project_id = pes.project_id
   AND COALESCE(
         resolved.from_current,
         resolved.from_pes_phase_alias,
         resolved.from_pi_phase_alias,
         resolved.from_pi_exec_phase_alias,
         resolved.from_pes_phase_literal,
         resolved.from_pi_phase_literal,
         resolved.from_pi_exec_phase_literal
       ) IS NOT NULL;

END IF;
END $lc_v2_prev_phase$;

-- Defensive cleanup: if any earlier run of this migration left a stale
-- non-canonical previous_phase value behind (e.g. "Construction"),
-- null it out so resumeProjectFromHold raises a clear "no previous_phase"
-- rather than silently corrupting current_stage_code.
UPDATE project_execution_state pes
   SET previous_phase = NULL
 WHERE pes.previous_phase IS NOT NULL
   AND pes.previous_phase NOT IN (
     SELECT stage_code FROM stage_definitions WHERE stage_code NOT IN ('S_HOLD', 'S_DONE')
   );

-- 7b. Insert/upsert S_HOLD stage instance for held projects.
INSERT INTO project_stage_instances (
  project_id, stage_code, stage_status, started_at, notes, created_at, updated_at
)
SELECT
  pi.id,
  'S_HOLD',
  -- Canonical UPPER casing: matches the StageStatus enum the service
  -- writes via Drizzle ('IN_PROGRESS' / 'PROGRESSED' / etc).
  'IN_PROGRESS',
  NOW(),
  'Auto-created by 0030_canonical_lifecycle_phases_v2.sql for project_status=hold backfill. Resume via previous_phase = ' ||
    COALESCE((SELECT pes.previous_phase FROM project_execution_state pes WHERE pes.project_id = pi.id), '<unknown>'),
  NOW(),
  NOW()
FROM project_info pi
WHERE pi.project_status = 'hold'
  AND NOT EXISTS (
    SELECT 1 FROM project_stage_instances psi
     WHERE psi.project_id = pi.id AND psi.stage_code = 'S_HOLD'
  );

-- 7c. Insert/upsert S_DONE stage instance for closed projects.
INSERT INTO project_stage_instances (
  project_id, stage_code, stage_status, started_at, completed_at, notes, created_at, updated_at
)
SELECT
  pi.id,
  'S_DONE',
  -- Canonical UPPER casing — see step 7b.
  'PROGRESSED',
  NOW(),
  NOW(),
  'Auto-created by 0030_canonical_lifecycle_phases_v2.sql for project_status=closed backfill.',
  NOW(),
  NOW()
FROM project_info pi
WHERE pi.project_status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM project_stage_instances psi
     WHERE psi.project_id = pi.id AND psi.stage_code = 'S_DONE'
  );

-- 7b'/7c'. Canonicalize stage_status casing for any pre-existing
--          terminal-stage rows that an earlier (lowercase) run of
--          this migration may have inserted. The service writes
--          UPPER-case values via the StageStatus enum, so this
--          forces consistency end-to-end (migration + service).
UPDATE project_stage_instances
   SET stage_status = 'IN_PROGRESS', updated_at = NOW()
 WHERE stage_code = 'S_HOLD'
   AND stage_status = 'in_progress';

UPDATE project_stage_instances
   SET stage_status = 'PROGRESSED', updated_at = NOW()
 WHERE stage_code = 'S_DONE'
   AND stage_status = 'progressed';

-- 7d. Surface terminal stages on the dashboard.
--     Update project_execution_state.current_stage_code to the terminal
--     code for legacy hold/closed projects so the lifecycle board, the
--     CriticalControlPanel, and the resumeProjectFromHold guard
--     (`current_stage_code === 'S_HOLD'`) all line up with project_status.
--     Only touches rows that aren't already on a terminal code so re-
--     running the migration is a no-op, and previous_phase set in 7a
--     is preserved.
-- Strict mapping: project_status drives the terminal code. A closed
-- project that's somehow still on S_HOLD must end on S_DONE; a hold
-- project mistakenly on S_DONE must end on S_HOLD. The update is still
-- idempotent because rows already on the correct terminal code are
-- excluded.
UPDATE project_execution_state pes
   SET current_stage_code = 'S_HOLD',
       updated_at = NOW()
 WHERE pes.project_id IN (SELECT id FROM project_info WHERE project_status = 'hold')
   AND (pes.current_stage_code IS NULL OR pes.current_stage_code <> 'S_HOLD');

UPDATE project_execution_state pes
   SET current_stage_code = 'S_DONE',
       updated_at = NOW()
 WHERE pes.project_id IN (SELECT id FROM project_info WHERE project_status = 'closed')
   AND (pes.current_stage_code IS NULL OR pes.current_stage_code <> 'S_DONE');

-- 7e. Some legacy hold/closed projects may not have a row in
--     project_execution_state at all. Insert a minimal one pointing at
--     the terminal code so the resume/done routes have something to
--     update. This is also idempotent (NOT EXISTS).
INSERT INTO project_execution_state (project_id, current_stage_code, created_at, updated_at)
SELECT pi.id, 'S_HOLD', NOW(), NOW()
  FROM project_info pi
 WHERE pi.project_status = 'hold'
   AND NOT EXISTS (SELECT 1 FROM project_execution_state pes WHERE pes.project_id = pi.id);

INSERT INTO project_execution_state (project_id, current_stage_code, created_at, updated_at)
SELECT pi.id, 'S_DONE', NOW(), NOW()
  FROM project_info pi
 WHERE pi.project_status = 'closed'
   AND NOT EXISTS (SELECT 1 FROM project_execution_state pes WHERE pes.project_id = pi.id);

-- ------------------------------------------------------------
-- 8. Indexes.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pes_previous_phase
  ON project_execution_state (previous_phase)
  WHERE previous_phase IS NOT NULL;

COMMIT;

-- ============================================================
-- Rollback (manual — keep below the COMMIT, NOT executed by drizzle):
-- ============================================================
-- BEGIN;
--   DELETE FROM project_stage_instances WHERE stage_code IN ('S_HOLD','S_DONE');
--   ALTER TABLE project_execution_state DROP COLUMN IF EXISTS previous_phase;
--   DELETE FROM stage_code_aliases WHERE alias_text IN (
--     'cost proposal & design','cost proposal and design','cost proposal/design',
--     '3 months post ho review','3 month post ho review','three months post ho review',
--     'hold','on hold','on-hold','parked','done','closed','gone','complete','completed','cancelled','canceled'
--   );
--   UPDATE stage_definitions SET stage_sequence = 9   WHERE stage_code = 'S9B_COMPLIANCE_HANDOVER';
--   UPDATE stage_definitions SET stage_sequence = 10  WHERE stage_code = 'S10_POST_HANDOVER_REVIEW';
--   UPDATE stage_definitions SET stage_name = 'Design & Cost Proposal' WHERE stage_code = 'S02_DESIGN_COST_PROPOSAL';
--   UPDATE stage_definitions SET stage_name = 'Post-Handover Review'   WHERE stage_code = 'S10_POST_HANDOVER_REVIEW';
--   DELETE FROM stage_definitions WHERE stage_code IN ('S_HOLD','S_DONE');
-- COMMIT;
