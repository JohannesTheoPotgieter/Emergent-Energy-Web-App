-- =============================================================================
-- Delete project 314 (M5 Free) completely from the production database.
--
-- Wraps everything in a single transaction. If any statement fails the entire
-- delete is rolled back, so it is safe to re-run.
--
-- Strategy:
--   1. Verify the project exists (and is the one you expect) — abort otherwise.
--   2. Delete grandchildren that point at project-scoped tables via NO ACTION
--      foreign keys (documents → work_items, expense_task_links → cost_lines,
--      payment_batch_items → payment_requests, etc.).
--   3. Delete each NO ACTION child of project_info directly.
--   4. DELETE FROM project_info — CASCADE children clean up automatically.
--
-- Run from psql (recommended so the BEGIN/COMMIT span the whole file):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/delete-project-314.sql
-- =============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Safety check
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p_name TEXT;
BEGIN
  SELECT project_name INTO p_name FROM project_info WHERE id = 314;
  IF p_name IS NULL THEN
    RAISE EXCEPTION 'Project 314 not found — aborting';
  END IF;
  RAISE NOTICE 'About to delete project 314: %', p_name;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Grandchildren of work_items (NO ACTION FKs)
--    CASCADE children (work_item_activity, comments, attachments, …) will be
--    removed automatically when their parent work_items row is deleted.
-- ---------------------------------------------------------------------------
DELETE FROM documents
 WHERE linked_work_item_id IN (SELECT id FROM work_items WHERE project_id = 314);

DELETE FROM project_eng_tasks_legacy_archive
 WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = 314);

UPDATE project_eng_tasks SET linked_work_item_id = NULL
 WHERE linked_work_item_id IN (SELECT id FROM work_items WHERE project_id = 314);

UPDATE qc_item_instances SET linked_work_item_id = NULL
 WHERE linked_work_item_id IN (SELECT id FROM work_items WHERE project_id = 314);

UPDATE intake_tasks SET linked_work_item_id = NULL
 WHERE linked_work_item_id IN (SELECT id FROM work_items WHERE project_id = 314);

DELETE FROM expense_task_links
 WHERE canonical_task_id IN (SELECT id FROM work_items WHERE project_id = 314)
    OR canonical_expense_id IN (SELECT id FROM normalized_cost_lines WHERE project_id = 314);

DELETE FROM _deliverables_legacy
 WHERE linked_work_item_id   IN (SELECT id FROM work_items             WHERE project_id = 314)
    OR linked_cost_line_id    IN (SELECT id FROM normalized_cost_lines  WHERE project_id = 314)
    OR linked_revenue_line_id IN (SELECT id FROM normalized_revenue_lines WHERE project_id = 314)
    OR project_id = 314;

-- Break the self-referencing parent_work_item_id link so the work_items
-- delete below does not violate the NO ACTION self-FK.
UPDATE work_items SET parent_work_item_id = NULL
 WHERE project_id = 314 AND parent_work_item_id IS NOT NULL;

DELETE FROM work_items WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 2. Finance lines (normalized_cost_lines / revenue_lines / phases)
--    normalized_cost_line_actuals CASCADEs from cost_lines.
-- ---------------------------------------------------------------------------
UPDATE normalized_cost_lines SET category_allocation_id = NULL
 WHERE project_id = 314 AND category_allocation_id IS NOT NULL;

DELETE FROM normalized_cost_lines      WHERE project_id = 314;
DELETE FROM normalized_revenue_lines   WHERE project_id = 314;
DELETE FROM normalized_execution_phases WHERE project_id = 314;
DELETE FROM category_revenue_allocations WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 3. Purchase orders & payment requests
-- ---------------------------------------------------------------------------
DELETE FROM proof_of_payment
 WHERE payment_request_id IN (
   SELECT id FROM payment_requests
    WHERE project_id = 314
       OR purchase_order_id IN (SELECT id FROM purchase_orders WHERE project_id = 314)
 );

DELETE FROM payment_batch_items
 WHERE payment_request_id IN (
   SELECT id FROM payment_requests
    WHERE project_id = 314
       OR purchase_order_id IN (SELECT id FROM purchase_orders WHERE project_id = 314)
 );

DELETE FROM payment_requests
 WHERE project_id = 314
    OR purchase_order_id IN (SELECT id FROM purchase_orders WHERE project_id = 314);

-- po_review_assignments CASCADEs from purchase_orders
DELETE FROM purchase_orders WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 4. Intake / PD tickets (intake_tasks CASCADEs from intake_requests)
-- ---------------------------------------------------------------------------
UPDATE intake_requests SET pd_ticket_id = NULL
 WHERE pd_ticket_id IN (SELECT id FROM pd_tickets WHERE project_id = 314);
DELETE FROM intake_requests WHERE project_id = 314;
DELETE FROM pd_tickets      WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 5. Engineering stages (project_eng_approvals / deliverables / tasks
--    CASCADE from project_eng_stages)
-- ---------------------------------------------------------------------------
DELETE FROM project_eng_stages WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 6. Smart-import runs (children NO ACTION on import_run_id)
-- ---------------------------------------------------------------------------
DELETE FROM data_conflicts
 WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = 314);
DELETE FROM import_issues
 WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = 314);
DELETE FROM invoice_pattern_matches
 WHERE project_id = 314
    OR import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = 314);
DELETE FROM smart_import_runs WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 7. Commissioning (snapshots reference sources via NO ACTION)
-- ---------------------------------------------------------------------------
DELETE FROM commissioning_snapshots WHERE project_id = 314;
DELETE FROM commissioning_items     WHERE project_id = 314;
DELETE FROM commissioning_sources   WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 8. Remaining NO ACTION children of project_info
--    (CASCADE children of project_info will be cleaned by the final delete.)
-- ---------------------------------------------------------------------------
DELETE FROM _approvals_legacy             WHERE project_id = 314;
DELETE FROM approvals                     WHERE project_id = 314;
DELETE FROM cashflow_points               WHERE project_id = 314;
DELETE FROM change_requests               WHERE project_id = 314;
DELETE FROM contracts                     WHERE project_id = 314;
DELETE FROM engineering_tickets           WHERE project_id = 314;
DELETE FROM entity_assignments            WHERE project_id = 314;
DELETE FROM fye_budgets                   WHERE project_id = 314;
DELETE FROM invoice_captures              WHERE project_id = 314;
DELETE FROM plan_edit_notifications       WHERE project_id = 314;
DELETE FROM procurement_items             WHERE project_id = 314;
DELETE FROM project_client_history        WHERE project_id = 314;
DELETE FROM project_pd_pm_handover        WHERE project_id = 314;
DELETE FROM project_portfolio_assignments WHERE project_id = 314;
DELETE FROM project_subcontractor_assignments WHERE project_id = 314;
DELETE FROM qc_checklist                  WHERE project_id = 314;
DELETE FROM raid_items                    WHERE project_id = 314;
DELETE FROM sseg_applications             WHERE project_id = 314;
DELETE FROM standup_schedules             WHERE project_id = 314;
DELETE FROM teams_chat_groups             WHERE project_id = 314;
DELETE FROM tracker_project_metadata      WHERE project_id = 314;
DELETE FROM tracker_revenue_summary       WHERE project_id = 314;

-- ---------------------------------------------------------------------------
-- 9. Final delete — all CASCADE children clean up automatically:
--      acceptance_reservations, client_commitments, client_updates,
--      controlled_documents, dashboard_project_metrics, email_project_links,
--      evidence_requests, execution_gate_log, normalized_cost_line_actuals,
--      om_handovers, phase_template_application, priority_projects,
--      project_access, project_charters, project_client_commitments,
--      project_client_updates, project_execution_state,
--      project_financial_reviews, project_handover_gates,
--      project_handover_history, project_phase_history, project_queries,
--      project_rag_audit, project_settings, project_sharepoint_roots,
--      project_stage_*, qc_item_evidence, safety_file_items,
--      stage_acceptances, stage_gate_evidence_snapshots,
--      teams_project_links, tr_item_project_links,
--      tr_item_suggestion_decisions, archive tables.
-- ---------------------------------------------------------------------------
DELETE FROM project_info WHERE id = 314;

-- ---------------------------------------------------------------------------
-- 10. Sanity verification — every check must return 0
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leftover BIGINT;
BEGIN
  SELECT COUNT(*) INTO leftover FROM project_info WHERE id = 314;
  IF leftover <> 0 THEN RAISE EXCEPTION 'project_info still has row for 314'; END IF;

  SELECT COUNT(*) INTO leftover FROM work_items WHERE project_id = 314;
  IF leftover <> 0 THEN RAISE EXCEPTION 'work_items rows still reference 314'; END IF;

  SELECT COUNT(*) INTO leftover FROM normalized_cost_lines WHERE project_id = 314;
  IF leftover <> 0 THEN RAISE EXCEPTION 'normalized_cost_lines still reference 314'; END IF;

  SELECT COUNT(*) INTO leftover FROM normalized_revenue_lines WHERE project_id = 314;
  IF leftover <> 0 THEN RAISE EXCEPTION 'normalized_revenue_lines still reference 314'; END IF;

  RAISE NOTICE 'Project 314 fully removed.';
END $$;

COMMIT;
