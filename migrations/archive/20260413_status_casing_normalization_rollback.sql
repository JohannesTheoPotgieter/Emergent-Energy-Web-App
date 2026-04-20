-- Rollback for 20260413_status_casing_normalization.sql
--
-- WARNING: BEST-EFFORT. Once the codebase has started writing canonical
-- lowercase values, rolling back means a mix of old and new strings
-- will exist. Prefer fixing forward.

BEGIN;

-- Reverse the pgEnum renames
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'planned') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'planned' TO 'PLANNED';
    ALTER TYPE revenue_line_status RENAME VALUE 'invoiced' TO 'INVOICED';
    ALTER TYPE revenue_line_status RENAME VALUE 'paid' TO 'PAID';
    ALTER TYPE revenue_line_status RENAME VALUE 'in_bank' TO 'IN_BANK';
    ALTER TYPE revenue_line_status RENAME VALUE 'realised' TO 'REALISED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'cost_line_status'::regtype AND enumlabel = 'planned') THEN
    ALTER TYPE cost_line_status RENAME VALUE 'planned' TO 'PLANNED';
    ALTER TYPE cost_line_status RENAME VALUE 'invoiced' TO 'INVOICED';
    ALTER TYPE cost_line_status RENAME VALUE 'approved' TO 'APPROVED';
    ALTER TYPE cost_line_status RENAME VALUE 'paid' TO 'PAID';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'pattern_match_outcome'::regtype AND enumlabel = 'auto_applied') THEN
    ALTER TYPE pattern_match_outcome RENAME VALUE 'auto_applied' TO 'AUTO_APPLIED';
    ALTER TYPE pattern_match_outcome RENAME VALUE 'user_confirmed' TO 'USER_CONFIRMED';
    ALTER TYPE pattern_match_outcome RENAME VALUE 'user_overridden' TO 'USER_OVERRIDDEN';
    ALTER TYPE pattern_match_outcome RENAME VALUE 'unresolved' TO 'UNRESOLVED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'allocation_confidence'::regtype AND enumlabel = 'direct') THEN
    ALTER TYPE allocation_confidence RENAME VALUE 'direct' TO 'DIRECT';
    ALTER TYPE allocation_confidence RENAME VALUE 'header_error_positional' TO 'HEADER_ERROR_POSITIONAL';
    ALTER TYPE allocation_confidence RENAME VALUE 'provisional' TO 'PROVISIONAL';
    ALTER TYPE allocation_confidence RENAME VALUE 'manual' TO 'MANUAL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_rag_status'::regtype AND enumlabel = 'red') THEN
    ALTER TYPE tr_rag_status RENAME VALUE 'red' TO 'Red';
    ALTER TYPE tr_rag_status RENAME VALUE 'amber' TO 'Amber';
    ALTER TYPE tr_rag_status RENAME VALUE 'green' TO 'Green';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_status'::regtype AND enumlabel = 'active') THEN
    ALTER TYPE tr_status RENAME VALUE 'active' TO 'Active';
    ALTER TYPE tr_status RENAME VALUE 'completed' TO 'Completed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_link_status'::regtype AND enumlabel = 'linked') THEN
    ALTER TYPE tr_link_status RENAME VALUE 'linked' TO 'Linked';
    ALTER TYPE tr_link_status RENAME VALUE 'task_created' TO 'TaskCreated';
    ALTER TYPE tr_link_status RENAME VALUE 'done' TO 'Done';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_suggestion_decision'::regtype AND enumlabel = 'suggested') THEN
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'suggested' TO 'Suggested';
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'accepted' TO 'Accepted';
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'rejected' TO 'Rejected';
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'suppressed' TO 'Suppressed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'preview') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'preview' TO 'PREVIEW';
    ALTER TYPE smart_import_status RENAME VALUE 'awaiting_review' TO 'AWAITING_REVIEW';
    ALTER TYPE smart_import_status RENAME VALUE 'committed' TO 'COMMITTED';
    ALTER TYPE smart_import_status RENAME VALUE 'rolled_back' TO 'ROLLED_BACK';
    ALTER TYPE smart_import_status RENAME VALUE 'failed' TO 'FAILED';
    ALTER TYPE smart_import_status RENAME VALUE 'superseded' TO 'SUPERSEDED';
  END IF;
END $$;

-- Reverse text-column UPDATEs (most-common subset; manual triage may
-- be needed for any rows written canonical-lowercase since the forward
-- migration ran).
UPDATE work_items SET status = 'Not Started'        WHERE status = 'not_started';
UPDATE work_items SET status = 'TO DO'              WHERE status = 'to_do';
UPDATE work_items SET status = 'IN PROGRESS'        WHERE status = 'in_progress';
UPDATE work_items SET status = 'HOLD'               WHERE status = 'hold';
UPDATE work_items SET status = 'COMPLETE'           WHERE status = 'complete';

UPDATE project_stage_instances SET stage_status = 'NOT_STARTED'        WHERE stage_status = 'not_started';
UPDATE project_stage_instances SET stage_status = 'IN_PROGRESS'        WHERE stage_status = 'in_progress';
UPDATE project_stage_instances SET stage_status = 'READY_FOR_REVIEW'   WHERE stage_status = 'ready_for_review';
UPDATE project_stage_instances SET stage_status = 'APPROVED'           WHERE stage_status = 'approved';
UPDATE project_stage_instances SET stage_status = 'PROGRESSED'         WHERE stage_status = 'progressed';
UPDATE project_stage_instances SET stage_status = 'EXCEPTION_APPROVED' WHERE stage_status = 'exception_approved';
UPDATE project_stage_instances SET stage_status = 'BLOCKED'            WHERE stage_status = 'blocked';

ALTER TABLE work_items                  ALTER COLUMN status            SET DEFAULT 'Not Started';
ALTER TABLE deliverables                ALTER COLUMN status            SET DEFAULT 'TO DO';
ALTER TABLE deliverable_versions        ALTER COLUMN status            SET DEFAULT 'IN PROGRESS';
ALTER TABLE project_stage_instances     ALTER COLUMN stage_status      SET DEFAULT 'NOT_STARTED';
ALTER TABLE project_stage_requirements  ALTER COLUMN status            SET DEFAULT 'NOT_STARTED';
ALTER TABLE project_stage_exceptions    ALTER COLUMN status            SET DEFAULT 'REQUESTED';
ALTER TABLE project_stage_exceptions    ALTER COLUMN risk_level        SET DEFAULT 'MEDIUM';
ALTER TABLE project_stage_dependencies  ALTER COLUMN status            SET DEFAULT 'WAITING';

COMMIT;
