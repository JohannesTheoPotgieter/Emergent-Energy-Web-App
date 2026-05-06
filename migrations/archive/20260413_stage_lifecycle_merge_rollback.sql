-- Rollback for 20260413_stage_lifecycle_merge.sql
--
-- WARNING: BEST-EFFORT ONLY. The forward migration merged S04 data into
-- S03 and S05 data into S02. We can no longer deterministically split a
-- merged S03 row back into S03 + S04 — the union of notes, max readiness,
-- and lifted statuses are now indistinguishable from data that was always
-- on S03.
--
-- This rollback re-creates EMPTY S04 and S05 stage instances per project
-- and reactivates the stage_definitions rows. Requirements, evidence,
-- decisions, exceptions, dependencies, snapshots, and checklist templates
-- stay where the forward migration put them — manual triage required.

BEGIN;

UPDATE stage_definitions
   SET is_active = true,
       description = 'Handover from project development to project management',
       updated_at = now()
 WHERE stage_code = 'S04_PD_PM_HANDOVER';

UPDATE stage_definitions
   SET is_active = true,
       description = 'Pre-construction financial review',
       updated_at = now()
 WHERE stage_code = 'S05_FINANCIAL_REVIEW';

UPDATE stage_definitions
   SET stage_name = 'Financial Close',
       description = 'Contract signature and financial close',
       updated_at = now()
 WHERE stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE';

UPDATE stage_definitions
   SET stage_name = 'Design & Cost Proposal',
       description = 'Engineering design and costing',
       updated_at = now()
 WHERE stage_code = 'S02_DESIGN_COST_PROPOSAL';

-- Recreate empty S04 / S05 instances for any project that still has
-- S03 / S02 instances. NOT_STARTED + 0% readiness so they don't claim
-- progress that the merge dropped.
INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, created_at, updated_at)
SELECT s3.project_id,
       'S04_PD_PM_HANDOVER',
       'NOT_STARTED',
       0,
       now(),
       now()
  FROM project_stage_instances s3
 WHERE s3.stage_code = 'S03_SIGNATURE_FINANCIAL_CLOSE'
   AND NOT EXISTS (
         SELECT 1 FROM project_stage_instances s4
          WHERE s4.project_id = s3.project_id
            AND s4.stage_code = 'S04_PD_PM_HANDOVER'
       )
ON CONFLICT (project_id, stage_code) DO NOTHING;

INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, created_at, updated_at)
SELECT s2.project_id,
       'S05_FINANCIAL_REVIEW',
       'NOT_STARTED',
       0,
       now(),
       now()
  FROM project_stage_instances s2
 WHERE s2.stage_code = 'S02_DESIGN_COST_PROPOSAL'
   AND NOT EXISTS (
         SELECT 1 FROM project_stage_instances s5
          WHERE s5.project_id = s2.project_id
            AND s5.stage_code = 'S05_FINANCIAL_REVIEW'
       )
ON CONFLICT (project_id, stage_code) DO NOTHING;

COMMIT;
