-- ============================================================================
-- script/delete-sporty-generator.sql
-- ----------------------------------------------------------------------------
-- One-shot cleanup: removes ALL data for the "SportyGenerator" project, which
-- is a confirmed duplicate. Deletes in FK-safe order (grandchild → child →
-- parent) so no constraint is violated, then rolls back unless you opt in.
--
-- Usage
-- -----
--   # Dry run — prints row counts, then rolls back (SAFE, no data lost):
--   psql "$DATABASE_URL" -v dry_run=1 -f script/delete-sporty-generator.sql
--
--   # Live run — commits permanently:
--   psql "$DATABASE_URL" -v dry_run=0 -f script/delete-sporty-generator.sql
--
--   # No -v flag → defaults to ROLLBACK for safety.
--
-- Safety
-- ------
--   * Everything runs inside a single transaction — any FK error aborts all.
--   * Defaults to ROLLBACK unless dry_run=0 is explicitly passed.
--   * Nullifies cross-project project_plan_dependency.imported_dependency_id
--     pointers before deleting, preventing FK violations from other projects.
--   * payment_batch_items and proof_of_payment are deleted before
--     payment_requests (non-cascade FK).
--   * expense_task_links is deleted before normalized_cost_lines
--     (non-cascade canonical_expense_id FK).
--   * writeback_audit_log is deleted before writeback_mappings
--     (non-cascade mapping_id FK).
--   * po_review_assignments is deleted before purchase_orders
--     (cascade, but explicit for clarity).
-- ============================================================================

BEGIN;

-- ── 1. Locate the project ──────────────────────────────────────────────────
CREATE TEMP TABLE _target AS
  SELECT id AS pid
  FROM project_info
  WHERE project_name = 'SportyGenerator'
    AND deleted_at IS NULL;

DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM _target;
  IF cnt = 0 THEN
    RAISE EXCEPTION 'No active project named "SportyGenerator" found — aborting.';
  END IF;
  IF cnt > 1 THEN
    RAISE EXCEPTION 'Found % projects named "SportyGenerator" — aborting.', cnt;
  END IF;
END $$;

\echo '▶ Target:'
SELECT pid AS sporty_generator_project_id FROM _target;

-- ── 2. Pre-flight row counts ───────────────────────────────────────────────
\echo '▶ Pre-flight counts (non-zero = rows that will be deleted):'
SELECT
  (SELECT COUNT(*) FROM payment_batch_items
     WHERE payment_request_id IN (
       SELECT id FROM payment_requests WHERE project_id IN (SELECT pid FROM _target)
     ))                                                           AS payment_batch_items,
  (SELECT COUNT(*) FROM proof_of_payment
     WHERE payment_request_id IN (
       SELECT id FROM payment_requests WHERE project_id IN (SELECT pid FROM _target)
     ))                                                           AS proof_of_payment,
  (SELECT COUNT(*) FROM writeback_audit_log
     WHERE mapping_id IN (
       SELECT id FROM writeback_mappings WHERE project_id IN (SELECT pid FROM _target)
     ))                                                           AS writeback_audit_log,
  (SELECT COUNT(*) FROM po_review_assignments
     WHERE purchase_order_id IN (
       SELECT id FROM purchase_orders WHERE project_id IN (SELECT pid FROM _target)
     ))                                                           AS po_review_assignments,
  (SELECT COUNT(*) FROM project_plan_dependency
     WHERE imported_dependency_id IN (
       SELECT id FROM project_plan_dependency
       WHERE project_id IN (SELECT pid FROM _target)
     )
     AND project_id NOT IN (SELECT pid FROM _target))            AS cross_proj_plan_deps_to_nullify,
  (SELECT COUNT(*) FROM project_info
     WHERE id IN (SELECT pid FROM _target))                       AS project_info_rows;

-- ── 3. Nullify cross-project plan dependency pointers ─────────────────────
-- Another project's plan dependency may point at SportyGenerator's rows via
-- imported_dependency_id (no CASCADE on that FK). Clear those first.
UPDATE project_plan_dependency
SET    imported_dependency_id = NULL
WHERE  imported_dependency_id IN (
  SELECT id FROM project_plan_dependency
  WHERE  project_id IN (SELECT pid FROM _target)
)
AND project_id NOT IN (SELECT pid FROM _target);

-- ── 4. Grandchild tables ───────────────────────────────────────────────────
-- These reference intermediate child tables without CASCADE, so they must be
-- deleted before we touch those intermediate tables.

-- payment_batch_items → payment_requests (no CASCADE)
DELETE FROM payment_batch_items
WHERE payment_request_id IN (
  SELECT id FROM payment_requests WHERE project_id IN (SELECT pid FROM _target)
);

-- proof_of_payment → payment_requests (nullable, no CASCADE)
DELETE FROM proof_of_payment
WHERE payment_request_id IN (
  SELECT id FROM payment_requests WHERE project_id IN (SELECT pid FROM _target)
);

-- writeback_audit_log → writeback_mappings (no CASCADE)
DELETE FROM writeback_audit_log
WHERE mapping_id IN (
  SELECT id FROM writeback_mappings WHERE project_id IN (SELECT pid FROM _target)
);

-- po_review_assignments → purchase_orders (CASCADE exists, explicit for safety)
DELETE FROM po_review_assignments
WHERE purchase_order_id IN (
  SELECT id FROM purchase_orders WHERE project_id IN (SELECT pid FROM _target)
);

-- normalized_cost_line_actuals has direct project_id FK too (CASCADE), but
-- deleting explicitly ensures clean ordering.
DELETE FROM normalized_cost_line_actuals
WHERE project_id IN (SELECT pid FROM _target);

-- ── 5. Finance domain — order matters ─────────────────────────────────────
-- expense_task_links.canonical_expense_id → normalized_cost_lines (no CASCADE)
DELETE FROM expense_task_links         WHERE project_id IN (SELECT pid FROM _target);
-- milestone_task_links.task_id → project_plan (CASCADE exists, explicit)
DELETE FROM milestone_task_links       WHERE project_id IN (SELECT pid FROM _target);
-- project_plan_dependency must go before project_plan
DELETE FROM project_plan_dependency    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_plan               WHERE project_id IN (SELECT pid FROM _target);

DELETE FROM normalized_cost_lines          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM normalized_revenue_lines       WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM category_revenue_allocations   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM writeback_mappings             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM financial_edit_requests        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM financial_integration_rules    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM cashflow_points                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM finance_revenue_monthly        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM finance_cos_monthly            WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM working_plan_scenario          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM schedule_change_notice         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM invoice_pattern_matches        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM invoice_captures               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM procurement_items              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM payment_requests               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM purchase_orders                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM fye_budgets                    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM forecast_pipeline              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM budget_baselines               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM weekly_reviews                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM tr_item_project_links          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM tr_item_suggestion_decisions   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM tracker_revenue_summary        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM tracker_project_metadata       WHERE project_id IN (SELECT pid FROM _target);

-- ── 6. All other direct children (remaining domains) ──────────────────────

-- Collaboration / workflow
DELETE FROM acceptance_reservations        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM approvals                      WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM audit_events                   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM change_requests                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM client_commitments             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM client_updates                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM entity_assignments             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM evidence_collected_items       WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM evidence_evaluations           WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM evidence_override_records      WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM evidence_requests              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM evidence_requirement_definitions WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM import_history                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM notifications                  WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_milestones             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM stage_acceptances              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM standup_schedules              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM teams_chat_groups              WHERE project_id IN (SELECT pid FROM _target);

-- Engineering
DELETE FROM deliverables                   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM drawing_register               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM eng_transmittals               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM engineering_tickets            WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_eng_stages             WHERE project_id IN (SELECT pid FROM _target);

-- Construction
DELETE FROM contractor_assignments         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM site_activities                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM site_inspections               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM snags                          WHERE project_id IN (SELECT pid FROM _target);

-- Quality / commissioning
DELETE FROM commissioning_items            WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM commissioning_snapshots        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM commissioning_sources          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM ncr_reports                    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM qc_checklist                   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM qc_item_evidence               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM qc_plan_link                   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM qc_postmortem                  WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM qc_warning                     WHERE project_id IN (SELECT pid FROM _target);

-- HSE
DELETE FROM corrective_actions             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM hse_incidents                  WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM safety_file_items              WHERE project_id IN (SELECT pid FROM _target);

-- Documents
DELETE FROM controlled_documents           WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM document_activity              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM managed_documents              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_folders                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_sharepoint_roots       WHERE project_id IN (SELECT pid FROM _target);

-- Handover
DELETE FROM handover_packs                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM om_handovers                   WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM sseg_applications              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM sseg_items                     WHERE project_id IN (SELECT pid FROM _target);

-- Comms / links
DELETE FROM email_project_links            WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM teams_project_links            WHERE project_id IN (SELECT pid FROM _target);

-- Smart Import / plan ingestion
DELETE FROM import_logs                    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM intake_requests                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM issue_resolution_rules         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM normalized_plan_tasks          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM plan_edit_notifications        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM smart_import_runs              WHERE project_id IN (SELECT pid FROM _target);

-- MyTool
DELETE FROM mytool_company_priorities      WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM mytool_recurrence_templates    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM priority_links                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM priority_projects              WHERE project_id IN (SELECT pid FROM _target);

-- Role-based / contracts
DELETE FROM contracts                      WHERE project_id IN (SELECT pid FROM _target);

-- Stage lifecycle / governance
DELETE FROM execution_gate_log             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_access                 WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_gate_evaluations       WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_handover_gates         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_decisions        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_dependencies     WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_evidence         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_exceptions       WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_financial_close_tracks WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_requirements     WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM stage_gate_evidence_snapshots  WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM stage_gate_overrides           WHERE project_id IN (SELECT pid FROM _target);
-- stage_instances after their dependent rows
DELETE FROM project_stage_instances        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_stage_data             WHERE project_id IN (SELECT pid FROM _target);

-- Stage collaboration (separate from raw collaboration tables above)
DELETE FROM project_charters               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_client_commitments     WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_client_updates         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_queries                WHERE project_id IN (SELECT pid FROM _target);

-- Core project sub-tables
DELETE FROM dashboard_project_metrics      WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM derived_project_kpis           WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM key_date_mappings              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM merge_audit_log                WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM normalized_execution_phases    WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM phase_template_application     WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_client_history         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_editable_fields        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_execution_state        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_financial_reviews      WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_handover_history       WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_pd_pm_handover         WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_phase_history          WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_portfolio_assignments  WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_rag_audit              WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_revenue_summary        WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_settings               WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_subcontractor_assignments WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM project_team_members           WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM raid_items                     WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM user_project_folders           WHERE project_id IN (SELECT pid FROM _target);

-- Misc
DELETE FROM template_overrides             WHERE project_id IN (SELECT pid FROM _target);
DELETE FROM work_items                     WHERE project_id IN (SELECT pid FROM _target);

-- ── 7. Delete the project row itself ──────────────────────────────────────
DELETE FROM project_info WHERE id IN (SELECT pid FROM _target);

-- ── 8. Verification — all counts should be 0 ──────────────────────────────
\echo '▶ Post-delete verification (all should be 0):'
SELECT
  (SELECT COUNT(*) FROM project_info WHERE id IN (SELECT pid FROM _target)) AS project_info,
  (SELECT COUNT(*) FROM project_execution_state WHERE project_id IN (SELECT pid FROM _target)) AS project_execution_state,
  (SELECT COUNT(*) FROM normalized_cost_lines   WHERE project_id IN (SELECT pid FROM _target)) AS normalized_cost_lines,
  (SELECT COUNT(*) FROM normalized_revenue_lines WHERE project_id IN (SELECT pid FROM _target)) AS normalized_revenue_lines,
  (SELECT COUNT(*) FROM cashflow_points          WHERE project_id IN (SELECT pid FROM _target)) AS cashflow_points,
  (SELECT COUNT(*) FROM work_items               WHERE project_id IN (SELECT pid FROM _target)) AS work_items,
  (SELECT COUNT(*) FROM payment_requests         WHERE project_id IN (SELECT pid FROM _target)) AS payment_requests;

-- ── 9. Commit or roll back ─────────────────────────────────────────────────
\if :{?dry_run}
  \if :dry_run
    \echo '▶ DRY RUN — rolling back. Re-run with -v dry_run=0 to commit.'
    ROLLBACK;
  \else
    \echo '▶ COMMITTING — SportyGenerator project permanently deleted.'
    COMMIT;
  \endif
\else
  \echo '▶ No dry_run flag passed — defaulting to ROLLBACK for safety.'
  \echo '  Re-run with -v dry_run=0 to commit, or -v dry_run=1 for an explicit dry run.'
  ROLLBACK;
\endif
