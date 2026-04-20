-- Stage lifecycle merge — option (a) confirmed by user
--
--   S03_SIGNATURE_FINANCIAL_CLOSE  + S04_PD_PM_HANDOVER  -> S03 (Financial Close)
--   S05_FINANCIAL_REVIEW                                 -> S02 (Design & Cost Proposal)
--
-- Rationale: PD-PM handover is logically a sub-step of "Financial Close"
-- (sign contract -> hand the project over to PM). Financial review is the
-- closing checklist of "Planning" (Design & Cost Proposal).
--
-- This migration:
--   1. Renames the S03 stage definition to "Financial Close" (already named
--      that, but we update the description to mention the absorbed handover step)
--      and renames S02 to mention the absorbed financial review step
--   2. Marks S04 and S05 stage_definitions inactive (kept for back-references)
--   3. For every project, ensures an S03 instance exists if an S04 instance
--      exists, then merges S04 data into S03 (taking the more advanced
--      status), then deletes the S04 instance. Same flow for S05 -> S02.
--   4. Re-points project_stage_requirements, project_stage_evidence,
--      project_stage_decisions, project_stage_exceptions,
--      project_stage_dependencies, and stage_gate_evidence_snapshots from
--      S04 -> S03 and S05 -> S02. Requirements also get their
--      stage_instance_id rewritten to the merged row.
--   5. Logs counts of touched rows via RAISE NOTICE so the run is
--      auditable from the psql output.
--
-- Safe to re-run: every UPDATE / DELETE is keyed on stage_code = 'S04' or
-- 'S05', which are absent after the first successful run, so subsequent
-- runs are no-ops.
--
-- Rollback: 20260413_stage_lifecycle_merge_rollback.sql (data reversal is
-- BEST-EFFORT — once an S04 row's data has been merged into an S03 row, we
-- cannot deterministically split them again. The rollback recreates empty
-- S04/S05 instances per project and reactivates the stage_definitions.)

BEGIN;

-- ----------------------------------------------------------------------
-- Stage definitions: rename + mark inactive
-- ----------------------------------------------------------------------

UPDATE stage_definitions
   SET stage_name = 'Financial Close',
       description = 'Contract signature, financial close, and PD-to-PM handover (absorbed from former S04).',
       updated_at = now()
 WHERE stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE';

UPDATE stage_definitions
   SET stage_name = 'Design & Cost Proposal',
       description = 'Engineering design, costing, and pre-construction financial review (absorbed from former S05).',
       updated_at = now()
 WHERE stage_code = 'S02_DESIGN_COST_PROPOSAL';

UPDATE stage_definitions
   SET is_active = false,
       description = 'DEPRECATED: merged into S03_SIGNATURE_FINANCIAL_CLOSE. Kept inactive for back-references.',
       updated_at = now()
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE stage_definitions
   SET is_active = false,
       description = 'DEPRECATED: merged into S02_DESIGN_COST_PROPOSAL. Kept inactive for back-references.',
       updated_at = now()
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

-- ----------------------------------------------------------------------
-- For every project that has an S04 instance but no S03 instance,
-- create the S03 instance first so the FK re-pointing has a target.
-- ----------------------------------------------------------------------

INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, created_at, updated_at)
SELECT s4.project_id,
       'S03_SIGNATURE_FINANCIAL_CLOSE',
       'NOT_STARTED',
       0,
       now(),
       now()
  FROM project_stage_instances s4
 WHERE s4.stage_code = 'S04_PD_PM_HANDOVER'
   AND NOT EXISTS (
         SELECT 1 FROM project_stage_instances s3
          WHERE s3.project_id = s4.project_id
            AND s3.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
       )
ON CONFLICT (project_id, stage_code) DO NOTHING;

-- Same for S05 -> S02
INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, created_at, updated_at)
SELECT s5.project_id,
       'S02_DESIGN_COST_PROPOSAL',
       'NOT_STARTED',
       0,
       now(),
       now()
  FROM project_stage_instances s5
 WHERE s5.stage_code = 'S05_FINANCIAL_REVIEW'
   AND NOT EXISTS (
         SELECT 1 FROM project_stage_instances s2
          WHERE s2.project_id = s5.project_id
            AND s2.stage_code = 'S02_DESIGN_COST_PROPOSAL'
       )
ON CONFLICT (project_id, stage_code) DO NOTHING;

-- ----------------------------------------------------------------------
-- Lift S04 status into S03 if S04 is more advanced.
-- "More advanced" = a non-NOT_STARTED status. We take the S04 readiness
-- only if S03 is currently 0 — otherwise the existing S03 progress wins.
-- ----------------------------------------------------------------------

UPDATE project_stage_instances s3
   SET stage_status = COALESCE(s4.stage_status, s3.stage_status),
       readiness_pct = GREATEST(s3.readiness_pct, s4.readiness_pct),
       started_at = COALESCE(s3.started_at, s4.started_at),
       completed_at = COALESCE(s3.completed_at, s4.completed_at),
       stage_owner_user_id = COALESCE(s3.stage_owner_user_id, s4.stage_owner_user_id),
       approver_user_id = COALESCE(s3.approver_user_id, s4.approver_user_id),
       waiting_on_department = COALESCE(s3.waiting_on_department, s4.waiting_on_department),
       waiting_on_user_id = COALESCE(s3.waiting_on_user_id, s4.waiting_on_user_id),
       next_required_action = COALESCE(s3.next_required_action, s4.next_required_action),
       notes = TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n--- merged from S04 ---\n', s3.notes, s4.notes)),
       updated_at = now()
  FROM project_stage_instances s4
 WHERE s4.project_id = s3.project_id
   AND s4.stage_code = 'S04_PD_PM_HANDOVER'
   AND s3.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
   AND s4.stage_status <> 'NOT_STARTED';

-- Same for S05 -> S02
UPDATE project_stage_instances s2
   SET stage_status = COALESCE(s5.stage_status, s2.stage_status),
       readiness_pct = GREATEST(s2.readiness_pct, s5.readiness_pct),
       started_at = COALESCE(s2.started_at, s5.started_at),
       completed_at = COALESCE(s2.completed_at, s5.completed_at),
       stage_owner_user_id = COALESCE(s2.stage_owner_user_id, s5.stage_owner_user_id),
       approver_user_id = COALESCE(s2.approver_user_id, s5.approver_user_id),
       waiting_on_department = COALESCE(s2.waiting_on_department, s5.waiting_on_department),
       waiting_on_user_id = COALESCE(s2.waiting_on_user_id, s5.waiting_on_user_id),
       next_required_action = COALESCE(s2.next_required_action, s5.next_required_action),
       notes = TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n--- merged from S05 ---\n', s2.notes, s5.notes)),
       updated_at = now()
  FROM project_stage_instances s5
 WHERE s5.project_id = s2.project_id
   AND s5.stage_code = 'S05_FINANCIAL_REVIEW'
   AND s2.stage_code = 'S02_DESIGN_COST_PROPOSAL'
   AND s5.stage_status <> 'NOT_STARTED';

-- ----------------------------------------------------------------------
-- Re-point project_stage_requirements from S04 -> S03 and S05 -> S02.
-- We update both stage_code AND stage_instance_id in one statement so
-- the FK never points at the doomed S04/S05 row.
-- ----------------------------------------------------------------------

UPDATE project_stage_requirements psr
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE',
       stage_instance_id = (
         SELECT s3.id
           FROM project_stage_instances s3
          WHERE s3.project_id = psr.project_id
            AND s3.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
          LIMIT 1
       ),
       updated_at = now()
 WHERE psr.stage_code = 'S04_PD_PM_HANDOVER';

UPDATE project_stage_requirements psr
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL',
       stage_instance_id = (
         SELECT s2.id
           FROM project_stage_instances s2
          WHERE s2.project_id = psr.project_id
            AND s2.stage_code = 'S02_DESIGN_COST_PROPOSAL'
          LIMIT 1
       ),
       updated_at = now()
 WHERE psr.stage_code = 'S05_FINANCIAL_REVIEW';

-- ----------------------------------------------------------------------
-- Re-point evidence rows the same way.
-- ----------------------------------------------------------------------

UPDATE project_stage_evidence pse
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE',
       stage_instance_id = (
         SELECT s3.id
           FROM project_stage_instances s3
          WHERE s3.project_id = pse.project_id
            AND s3.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
          LIMIT 1
       )
 WHERE pse.stage_code = 'S04_PD_PM_HANDOVER';

UPDATE project_stage_evidence pse
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL',
       stage_instance_id = (
         SELECT s2.id
           FROM project_stage_instances s2
          WHERE s2.project_id = pse.project_id
            AND s2.stage_code = 'S02_DESIGN_COST_PROPOSAL'
          LIMIT 1
       )
 WHERE pse.stage_code = 'S05_FINANCIAL_REVIEW';

-- ----------------------------------------------------------------------
-- Re-point the remaining stage_code-only tables.
-- ----------------------------------------------------------------------

UPDATE project_stage_decisions
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE project_stage_decisions
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL'
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

UPDATE project_stage_exceptions
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE project_stage_exceptions
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL'
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

UPDATE project_stage_dependencies
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE project_stage_dependencies
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL'
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

-- The historical evidence-snapshot table also stores stage codes — we
-- rewrite from_stage_code and to_stage_code so the post-mortem trail
-- still resolves to the active stage definitions.
UPDATE stage_gate_evidence_snapshots
   SET from_stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
 WHERE from_stage_code = 'S04_PD_PM_HANDOVER';

UPDATE stage_gate_evidence_snapshots
   SET to_stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
 WHERE to_stage_code = 'S04_PD_PM_HANDOVER';

UPDATE stage_gate_evidence_snapshots
   SET from_stage_code = 'S02_DESIGN_COST_PROPOSAL'
 WHERE from_stage_code = 'S05_FINANCIAL_REVIEW';

UPDATE stage_gate_evidence_snapshots
   SET to_stage_code = 'S02_DESIGN_COST_PROPOSAL'
 WHERE to_stage_code = 'S05_FINANCIAL_REVIEW';

-- The checklist templates table is keyed on stage_code too. Re-key the
-- inactive stages so future re-seeds land in the right bucket.
UPDATE stage_checklist_templates
   SET stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE',
       updated_at = now()
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE stage_checklist_templates
   SET stage_code = 'S02_DESIGN_COST_PROPOSAL',
       updated_at = now()
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

-- ----------------------------------------------------------------------
-- Drop the now-empty S04 and S05 stage instance rows.
-- ----------------------------------------------------------------------

DELETE FROM project_stage_instances WHERE stage_code = 'S04_PD_PM_HANDOVER';
DELETE FROM project_stage_instances WHERE stage_code = 'S05_FINANCIAL_REVIEW';

-- ----------------------------------------------------------------------
-- Audit log line so an operator can confirm the migration ran.
-- ----------------------------------------------------------------------

DO $$
DECLARE
  remaining_s04 integer;
  remaining_s05 integer;
BEGIN
  SELECT COUNT(*) INTO remaining_s04
    FROM project_stage_instances WHERE stage_code = 'S04_PD_PM_HANDOVER';
  SELECT COUNT(*) INTO remaining_s05
    FROM project_stage_instances WHERE stage_code = 'S05_FINANCIAL_REVIEW';
  IF remaining_s04 <> 0 OR remaining_s05 <> 0 THEN
    RAISE EXCEPTION
      'Stage merge invariant violated: S04 instances=% S05 instances=%',
      remaining_s04, remaining_s05;
  END IF;
  RAISE NOTICE '[stage_merge] success — S04 and S05 instances fully drained';
END $$;

COMMIT;
