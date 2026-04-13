-- C6 — Status casing normalization to lowercase_underscore
--
-- Normalizes every workflow status column from its historical
-- casing (UPPER, UPPER_UNDERSCORE, "Title Case", "TitleCase", spaces,
-- hyphens) to a single canonical form: lowercase_underscore.
--
-- See shared/utils/status-normalization.ts for the in-app helpers that
-- accept legacy strings transparently for one release cycle while
-- callers catch up.
--
-- Two parts:
--   PART A — pgEnum renames via ALTER TYPE RENAME VALUE (Postgres 10+).
--            Idempotent: each rename is wrapped in a DO block that
--            checks pg_enum for the old value first.
--   PART B — Text column UPDATE statements for the non-enum tables
--            (work_items, deliverables, deliverable_versions,
--            project_stage_*, intake_*, etc.). Idempotent because the
--            WHERE clauses key on the old uppercase form.
--
-- Rollback: 20260413_status_casing_normalization_rollback.sql

BEGIN;

-- ============================================================
-- PART A — pgEnum renames
-- ============================================================
--
-- Each block uses pg_enum lookup to verify the old value still exists
-- before renaming, so this migration can be re-run safely.

-- revenue_line_status: PLANNED, INVOICED, PAID, IN_BANK, REALISED
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'PLANNED') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'PLANNED' TO 'planned';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'INVOICED') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'INVOICED' TO 'invoiced';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'PAID') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'PAID' TO 'paid';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'IN_BANK') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'IN_BANK' TO 'in_bank';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'revenue_line_status'::regtype AND enumlabel = 'REALISED') THEN
    ALTER TYPE revenue_line_status RENAME VALUE 'REALISED' TO 'realised';
  END IF;
END $$;

-- cost_line_status: PLANNED, INVOICED, APPROVED, PAID
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'cost_line_status'::regtype AND enumlabel = 'PLANNED') THEN
    ALTER TYPE cost_line_status RENAME VALUE 'PLANNED' TO 'planned';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'cost_line_status'::regtype AND enumlabel = 'INVOICED') THEN
    ALTER TYPE cost_line_status RENAME VALUE 'INVOICED' TO 'invoiced';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'cost_line_status'::regtype AND enumlabel = 'APPROVED') THEN
    ALTER TYPE cost_line_status RENAME VALUE 'APPROVED' TO 'approved';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'cost_line_status'::regtype AND enumlabel = 'PAID') THEN
    ALTER TYPE cost_line_status RENAME VALUE 'PAID' TO 'paid';
  END IF;
END $$;

-- pattern_match_outcome: AUTO_APPLIED, USER_CONFIRMED, USER_OVERRIDDEN, UNRESOLVED
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'pattern_match_outcome'::regtype AND enumlabel = 'AUTO_APPLIED') THEN
    ALTER TYPE pattern_match_outcome RENAME VALUE 'AUTO_APPLIED' TO 'auto_applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'pattern_match_outcome'::regtype AND enumlabel = 'USER_CONFIRMED') THEN
    ALTER TYPE pattern_match_outcome RENAME VALUE 'USER_CONFIRMED' TO 'user_confirmed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'pattern_match_outcome'::regtype AND enumlabel = 'USER_OVERRIDDEN') THEN
    ALTER TYPE pattern_match_outcome RENAME VALUE 'USER_OVERRIDDEN' TO 'user_overridden';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'pattern_match_outcome'::regtype AND enumlabel = 'UNRESOLVED') THEN
    ALTER TYPE pattern_match_outcome RENAME VALUE 'UNRESOLVED' TO 'unresolved';
  END IF;
END $$;

-- allocation_confidence: DIRECT, HEADER_ERROR_POSITIONAL, PROVISIONAL, MANUAL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'allocation_confidence'::regtype AND enumlabel = 'DIRECT') THEN
    ALTER TYPE allocation_confidence RENAME VALUE 'DIRECT' TO 'direct';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'allocation_confidence'::regtype AND enumlabel = 'HEADER_ERROR_POSITIONAL') THEN
    ALTER TYPE allocation_confidence RENAME VALUE 'HEADER_ERROR_POSITIONAL' TO 'header_error_positional';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'allocation_confidence'::regtype AND enumlabel = 'PROVISIONAL') THEN
    ALTER TYPE allocation_confidence RENAME VALUE 'PROVISIONAL' TO 'provisional';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'allocation_confidence'::regtype AND enumlabel = 'MANUAL') THEN
    ALTER TYPE allocation_confidence RENAME VALUE 'MANUAL' TO 'manual';
  END IF;
END $$;

-- tr_rag_status: Red, Amber, Green
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_rag_status'::regtype AND enumlabel = 'Red') THEN
    ALTER TYPE tr_rag_status RENAME VALUE 'Red' TO 'red';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_rag_status'::regtype AND enumlabel = 'Amber') THEN
    ALTER TYPE tr_rag_status RENAME VALUE 'Amber' TO 'amber';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_rag_status'::regtype AND enumlabel = 'Green') THEN
    ALTER TYPE tr_rag_status RENAME VALUE 'Green' TO 'green';
  END IF;
END $$;

-- tr_status: Active, Completed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_status'::regtype AND enumlabel = 'Active') THEN
    ALTER TYPE tr_status RENAME VALUE 'Active' TO 'active';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_status'::regtype AND enumlabel = 'Completed') THEN
    ALTER TYPE tr_status RENAME VALUE 'Completed' TO 'completed';
  END IF;
END $$;

-- tr_link_status: Linked, TaskCreated, Done
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_link_status'::regtype AND enumlabel = 'Linked') THEN
    ALTER TYPE tr_link_status RENAME VALUE 'Linked' TO 'linked';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_link_status'::regtype AND enumlabel = 'TaskCreated') THEN
    ALTER TYPE tr_link_status RENAME VALUE 'TaskCreated' TO 'task_created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_link_status'::regtype AND enumlabel = 'Done') THEN
    ALTER TYPE tr_link_status RENAME VALUE 'Done' TO 'done';
  END IF;
END $$;

-- tr_suggestion_decision: Suggested, Accepted, Rejected, Suppressed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_suggestion_decision'::regtype AND enumlabel = 'Suggested') THEN
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'Suggested' TO 'suggested';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_suggestion_decision'::regtype AND enumlabel = 'Accepted') THEN
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'Accepted' TO 'accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_suggestion_decision'::regtype AND enumlabel = 'Rejected') THEN
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'Rejected' TO 'rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'tr_suggestion_decision'::regtype AND enumlabel = 'Suppressed') THEN
    ALTER TYPE tr_suggestion_decision RENAME VALUE 'Suppressed' TO 'suppressed';
  END IF;
END $$;

-- smart_import_status: PREVIEW, AWAITING_REVIEW, COMMITTED, ROLLED_BACK, FAILED, SUPERSEDED
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'PREVIEW') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'PREVIEW' TO 'preview';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'AWAITING_REVIEW') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'AWAITING_REVIEW' TO 'awaiting_review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'COMMITTED') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'COMMITTED' TO 'committed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'ROLLED_BACK') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'ROLLED_BACK' TO 'rolled_back';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'FAILED') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'FAILED' TO 'failed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'smart_import_status'::regtype AND enumlabel = 'SUPERSEDED') THEN
    ALTER TYPE smart_import_status RENAME VALUE 'SUPERSEDED' TO 'superseded';
  END IF;
END $$;

-- ============================================================
-- PART B — Text column data normalization
-- ============================================================
--
-- These are plain TEXT columns (no enum / no CHECK constraint) so we
-- just UPDATE the row values. Each statement is keyed on the OLD
-- string so re-running this migration is a no-op.

-- ----- work_items.status -----
-- Historical: "Not Started", "TO DO", "IN PROGRESS", "HOLD", "COMPLETE",
--             "PROJECTS ASSISTANCE", "NEEDS APPROVAL", "QC APPROVED",
--             "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL"
UPDATE work_items SET status = 'not_started'        WHERE status = 'Not Started';
UPDATE work_items SET status = 'to_do'              WHERE status = 'TO DO';
UPDATE work_items SET status = 'in_progress'        WHERE status = 'IN PROGRESS';
UPDATE work_items SET status = 'hold'               WHERE status = 'HOLD';
UPDATE work_items SET status = 'complete'           WHERE status = 'COMPLETE';
UPDATE work_items SET status = 'projects_assistance'   WHERE status = 'PROJECTS ASSISTANCE';
UPDATE work_items SET status = 'needs_approval'     WHERE status = 'NEEDS APPROVAL';
UPDATE work_items SET status = 'qc_approved'        WHERE status = 'QC APPROVED';
UPDATE work_items SET status = 'provide_feedback'   WHERE status = 'PROVIDE FEEDBACK';
UPDATE work_items SET status = 'operational_approval'  WHERE status = 'OPERATIONAL APPROVAL';

-- ----- work_item_status_history -----
UPDATE work_item_status_history SET old_status = 'not_started'        WHERE old_status = 'Not Started';
UPDATE work_item_status_history SET old_status = 'to_do'              WHERE old_status = 'TO DO';
UPDATE work_item_status_history SET old_status = 'in_progress'        WHERE old_status = 'IN PROGRESS';
UPDATE work_item_status_history SET old_status = 'hold'               WHERE old_status = 'HOLD';
UPDATE work_item_status_history SET old_status = 'complete'           WHERE old_status = 'COMPLETE';
UPDATE work_item_status_history SET old_status = 'projects_assistance'   WHERE old_status = 'PROJECTS ASSISTANCE';
UPDATE work_item_status_history SET old_status = 'needs_approval'     WHERE old_status = 'NEEDS APPROVAL';
UPDATE work_item_status_history SET old_status = 'qc_approved'        WHERE old_status = 'QC APPROVED';
UPDATE work_item_status_history SET old_status = 'provide_feedback'   WHERE old_status = 'PROVIDE FEEDBACK';
UPDATE work_item_status_history SET old_status = 'operational_approval'  WHERE old_status = 'OPERATIONAL APPROVAL';

UPDATE work_item_status_history SET new_status = 'not_started'        WHERE new_status = 'Not Started';
UPDATE work_item_status_history SET new_status = 'to_do'              WHERE new_status = 'TO DO';
UPDATE work_item_status_history SET new_status = 'in_progress'        WHERE new_status = 'IN PROGRESS';
UPDATE work_item_status_history SET new_status = 'hold'               WHERE new_status = 'HOLD';
UPDATE work_item_status_history SET new_status = 'complete'           WHERE new_status = 'COMPLETE';
UPDATE work_item_status_history SET new_status = 'projects_assistance'   WHERE new_status = 'PROJECTS ASSISTANCE';
UPDATE work_item_status_history SET new_status = 'needs_approval'     WHERE new_status = 'NEEDS APPROVAL';
UPDATE work_item_status_history SET new_status = 'qc_approved'        WHERE new_status = 'QC APPROVED';
UPDATE work_item_status_history SET new_status = 'provide_feedback'   WHERE new_status = 'PROVIDE FEEDBACK';
UPDATE work_item_status_history SET new_status = 'operational_approval'  WHERE new_status = 'OPERATIONAL APPROVAL';

-- ----- deliverables.status / deliverable_versions.status -----
UPDATE deliverables SET status = 'to_do'              WHERE status = 'TO DO';
UPDATE deliverables SET status = 'in_progress'        WHERE status = 'IN PROGRESS';
UPDATE deliverables SET status = 'needs_approval'     WHERE status = 'NEEDS APPROVAL';
UPDATE deliverables SET status = 'provide_feedback'   WHERE status = 'PROVIDE FEEDBACK';
UPDATE deliverables SET status = 'qc_approved'        WHERE status = 'QC APPROVED';
UPDATE deliverables SET status = 'operational_approval'  WHERE status = 'OPERATIONAL APPROVAL';
UPDATE deliverables SET status = 'complete'           WHERE status = 'COMPLETE';

UPDATE deliverable_versions SET status = 'in_progress' WHERE status = 'IN PROGRESS';

-- deliverable_events from_status / to_status
UPDATE deliverable_events SET from_status = 'to_do'              WHERE from_status = 'TO DO';
UPDATE deliverable_events SET from_status = 'in_progress'        WHERE from_status = 'IN PROGRESS';
UPDATE deliverable_events SET from_status = 'needs_approval'     WHERE from_status = 'NEEDS APPROVAL';
UPDATE deliverable_events SET from_status = 'provide_feedback'   WHERE from_status = 'PROVIDE FEEDBACK';
UPDATE deliverable_events SET from_status = 'qc_approved'        WHERE from_status = 'QC APPROVED';
UPDATE deliverable_events SET from_status = 'operational_approval'  WHERE from_status = 'OPERATIONAL APPROVAL';
UPDATE deliverable_events SET from_status = 'complete'           WHERE from_status = 'COMPLETE';
UPDATE deliverable_events SET to_status = 'to_do'                WHERE to_status = 'TO DO';
UPDATE deliverable_events SET to_status = 'in_progress'          WHERE to_status = 'IN PROGRESS';
UPDATE deliverable_events SET to_status = 'needs_approval'       WHERE to_status = 'NEEDS APPROVAL';
UPDATE deliverable_events SET to_status = 'provide_feedback'     WHERE to_status = 'PROVIDE FEEDBACK';
UPDATE deliverable_events SET to_status = 'qc_approved'          WHERE to_status = 'QC APPROVED';
UPDATE deliverable_events SET to_status = 'operational_approval' WHERE to_status = 'OPERATIONAL APPROVAL';
UPDATE deliverable_events SET to_status = 'complete'             WHERE to_status = 'COMPLETE';

-- ----- project_stage_instances.stage_status -----
-- Historical: NOT_STARTED, IN_PROGRESS, READY_FOR_REVIEW, APPROVED,
--             PROGRESSED, EXCEPTION_APPROVED, BLOCKED
UPDATE project_stage_instances SET stage_status = 'not_started'        WHERE stage_status = 'NOT_STARTED';
UPDATE project_stage_instances SET stage_status = 'in_progress'        WHERE stage_status = 'IN_PROGRESS';
UPDATE project_stage_instances SET stage_status = 'ready_for_review'   WHERE stage_status = 'READY_FOR_REVIEW';
UPDATE project_stage_instances SET stage_status = 'approved'           WHERE stage_status = 'APPROVED';
UPDATE project_stage_instances SET stage_status = 'progressed'         WHERE stage_status = 'PROGRESSED';
UPDATE project_stage_instances SET stage_status = 'exception_approved' WHERE stage_status = 'EXCEPTION_APPROVED';
UPDATE project_stage_instances SET stage_status = 'blocked'            WHERE stage_status = 'BLOCKED';

-- ----- project_stage_requirements.status -----
-- Historical: NOT_STARTED, IN_PROGRESS, COMPLETE, NOT_APPLICABLE, WAIVED
UPDATE project_stage_requirements SET status = 'not_started'    WHERE status = 'NOT_STARTED';
UPDATE project_stage_requirements SET status = 'in_progress'    WHERE status = 'IN_PROGRESS';
UPDATE project_stage_requirements SET status = 'complete'       WHERE status = 'COMPLETE';
UPDATE project_stage_requirements SET status = 'not_applicable' WHERE status = 'NOT_APPLICABLE';
UPDATE project_stage_requirements SET status = 'waived'         WHERE status = 'WAIVED';

-- ----- project_stage_exceptions.status + risk_level -----
UPDATE project_stage_exceptions SET status = 'requested'                 WHERE status = 'REQUESTED';
UPDATE project_stage_exceptions SET status = 'approved'                  WHERE status = 'APPROVED';
UPDATE project_stage_exceptions SET status = 'approved_with_conditions'  WHERE status = 'APPROVED_WITH_CONDITIONS';
UPDATE project_stage_exceptions SET status = 'rejected'                  WHERE status = 'REJECTED';
UPDATE project_stage_exceptions SET status = 'closed'                    WHERE status = 'CLOSED';
UPDATE project_stage_exceptions SET status = 're_opened'                 WHERE status = 'RE_OPENED';
UPDATE project_stage_exceptions SET risk_level = 'low'      WHERE risk_level = 'LOW';
UPDATE project_stage_exceptions SET risk_level = 'medium'   WHERE risk_level = 'MEDIUM';
UPDATE project_stage_exceptions SET risk_level = 'high'     WHERE risk_level = 'HIGH';
UPDATE project_stage_exceptions SET risk_level = 'critical' WHERE risk_level = 'CRITICAL';

-- ----- project_stage_dependencies.status -----
UPDATE project_stage_dependencies SET status = 'waiting'   WHERE status = 'WAITING';
UPDATE project_stage_dependencies SET status = 'resolved'  WHERE status = 'RESOLVED';
UPDATE project_stage_dependencies SET status = 'escalated' WHERE status = 'ESCALATED';
UPDATE project_stage_dependencies SET status = 'bypassed'  WHERE status = 'BYPASSED';

-- ----- project_stage_decisions.decision_type -----
UPDATE project_stage_decisions SET decision_type = 'gate_pass'         WHERE decision_type = 'GATE_PASS';
UPDATE project_stage_decisions SET decision_type = 'gate_fail'         WHERE decision_type = 'GATE_FAIL';
UPDATE project_stage_decisions SET decision_type = 'exception_granted' WHERE decision_type = 'EXCEPTION_GRANTED';
UPDATE project_stage_decisions SET decision_type = 'exception_denied'  WHERE decision_type = 'EXCEPTION_DENIED';
UPDATE project_stage_decisions SET decision_type = 'stage_override'    WHERE decision_type = 'STAGE_OVERRIDE';
UPDATE project_stage_decisions SET decision_type = 'stage_rollback'    WHERE decision_type = 'STAGE_ROLLBACK';

-- ----- intake_requests.status (UPPER + spaces) -----
UPDATE intake_requests SET status = 'not_started' WHERE status = 'NOT STARTED';
UPDATE intake_requests SET status = 'in_progress' WHERE status = 'IN PROGRESS';
UPDATE intake_requests SET status = 'completed'   WHERE status = 'COMPLETED';
UPDATE intake_requests SET status = 'on_hold'     WHERE status = 'ON HOLD';
UPDATE intake_requests SET status = 'cancelled'   WHERE status = 'CANCELLED';

-- ----- intake_tasks.status -----
UPDATE intake_tasks SET status = 'not_started' WHERE status = 'NOT_STARTED';

-- ----- import_logs.status (text column) -----
UPDATE import_logs SET status = 'success'  WHERE status = 'SUCCESS';
UPDATE import_logs SET status = 'partial'  WHERE status = 'PARTIAL';
UPDATE import_logs SET status = 'failed'   WHERE status = 'FAILED';
UPDATE import_logs SET status = 'rejected' WHERE status = 'REJECTED';

-- ============================================================
-- PART C — Default value re-anchor (text columns only)
-- ============================================================
--
-- pgEnum defaults are part of the column definition and don't need
-- special handling — Drizzle's next push regenerates them. For text
-- columns we set the default explicitly so a fresh insert without an
-- explicit value lands on the canonical form.

ALTER TABLE work_items                  ALTER COLUMN status            SET DEFAULT 'not_started';
ALTER TABLE deliverables                ALTER COLUMN status            SET DEFAULT 'to_do';
ALTER TABLE deliverable_versions        ALTER COLUMN status            SET DEFAULT 'in_progress';
ALTER TABLE project_stage_instances     ALTER COLUMN stage_status      SET DEFAULT 'not_started';
ALTER TABLE project_stage_requirements  ALTER COLUMN status            SET DEFAULT 'not_started';
ALTER TABLE project_stage_exceptions    ALTER COLUMN status            SET DEFAULT 'requested';
ALTER TABLE project_stage_exceptions    ALTER COLUMN risk_level        SET DEFAULT 'medium';
ALTER TABLE project_stage_dependencies  ALTER COLUMN status            SET DEFAULT 'waiting';

COMMIT;
