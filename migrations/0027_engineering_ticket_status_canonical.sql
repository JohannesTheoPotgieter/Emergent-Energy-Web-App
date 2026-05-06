-- 0027_engineering_ticket_status_canonical.sql
--
-- Align `engineering_tickets.status` with the engineering-board canonical
-- 10-state task status set (`shared/schema/tasks.ts::TASK_STATUSES`):
--
--     not_started, to_do, in_progress, hold, projects_assistance,
--     needs_approval, qc_approved, provide_feedback,
--     operational_approval, complete
--
-- Historically `engineering_tickets.status` (pre-rename: `pd_tickets.status`)
-- carried free-form Title-Case values: 'Draft', 'In Progress', 'On Hold',
-- 'Completed', 'Cancelled'. The PD work surface and the Engineering board
-- now share a single status vocabulary so tile counts, kanban columns and
-- filters mean the same thing on both screens.
--
-- This migration:
--   1. Rewrites every legacy value to its canonical equivalent. The mapping
--      mirrors `normalizeEngineeringTicketStatus()` in
--      `shared/engineering-ticket-status.ts`. 'Cancelled' is folded into
--      'complete' because the canonical set has no separate cancelled state
--      — both already counted as terminal/done-for-reporting in every read
--      path, so no behavioural change.
--   2. Shifts the column DEFAULT from 'Draft' to 'to_do' so newly inserted
--      rows land on the canonical value.
--
-- The column TYPE stays `text` (no type change). No PK or FK touched.
-- Idempotent: re-running the UPDATE is a no-op once values are canonical;
-- ALTER ... SET DEFAULT is naturally idempotent.

BEGIN;

-- 1. Backfill legacy free-form values to canonical engineering-board values.
UPDATE engineering_tickets SET status = 'to_do'        WHERE status IN ('Draft', 'draft');
UPDATE engineering_tickets SET status = 'in_progress'  WHERE status IN ('In Progress', 'in progress');
UPDATE engineering_tickets SET status = 'hold'         WHERE status IN ('On Hold', 'on hold', 'on_hold', 'Blocked', 'blocked');
UPDATE engineering_tickets SET status = 'complete'     WHERE status IN ('Completed', 'completed', 'Done', 'done', 'Closed', 'closed', 'Resolved', 'resolved');
UPDATE engineering_tickets SET status = 'complete'     WHERE status IN ('Cancelled', 'cancelled', 'Canceled', 'canceled');
UPDATE engineering_tickets SET status = 'not_started'  WHERE status IN ('Not Started', 'not started');
UPDATE engineering_tickets SET status = 'qc_approved'  WHERE status IN ('QC Approved', 'qc approved');
UPDATE engineering_tickets SET status = 'needs_approval'       WHERE status IN ('Needs Approval', 'needs approval');
UPDATE engineering_tickets SET status = 'provide_feedback'     WHERE status IN ('Provide Feedback', 'provide feedback');
UPDATE engineering_tickets SET status = 'operational_approval' WHERE status IN ('Operational Approval', 'operational approval');
UPDATE engineering_tickets SET status = 'projects_assistance'  WHERE status IN ('Projects Assistance', 'projects assistance');

-- Safety net: any value not in the canonical set after the explicit
-- mappings above falls through to 'to_do' so the column never carries
-- an unknown state. Use a CASE on LOWER() to be belt-and-braces.
UPDATE engineering_tickets
   SET status = 'to_do'
 WHERE status NOT IN (
    'not_started','to_do','in_progress','hold','projects_assistance',
    'needs_approval','qc_approved','provide_feedback',
    'operational_approval','complete'
 );

-- 2. Shift the column default to the canonical "fresh ticket" value.
ALTER TABLE engineering_tickets ALTER COLUMN status SET DEFAULT 'to_do';

COMMIT;
