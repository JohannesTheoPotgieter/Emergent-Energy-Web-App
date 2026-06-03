-- ============================================================================
-- DELETE PROJECTS FROM PRODUCTION  (FULL, IRREVERSIBLE)
-- Generated: 2026-06-03   TARGET: PRODUCTION (Neon) ONLY
--
-- Removes ALL data for these three projects across every related table:
--   393  COS Analysis May 2026
--   394  FY2026 FYTD Tool
--   395  FY2026 Financials Cashflow
--
-- Plain DELETE statements only -- no CTEs, no temp tables, no DO blocks.
-- Statements are ordered child-before-parent so foreign keys never block.
--
-- HARD DELETE: rows are physically removed. There is NO backup and NO undo
-- in this script. BEFORE running, create a Neon restore point / branch (or
-- note the current timestamp) so you can point-in-time restore if needed.
--
-- Run as ONE transaction. Review the final counts (all must be 0), then COMMIT.
-- ============================================================================

BEGIN;

-- Block concurrent writers for a consistent point-in-time delete.
LOCK TABLE project_info IN SHARE ROW EXCLUSIVE MODE;

-- ---- child / related tables (deleted first) ----
DELETE FROM _approvals_legacy WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _client_commitments_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _client_updates_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _deliverables_legacy WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _engineering_tasks_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _operational_tasks_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM _tasks_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM acceptance_reservations WHERE project_id::text IN ('393', '394', '395');
DELETE FROM approvals WHERE project_id::text IN ('393', '394', '395');
DELETE FROM audit_events WHERE project_id::text IN ('393', '394', '395');
DELETE FROM budget_baselines WHERE project_id::text IN ('393', '394', '395');
DELETE FROM budgets WHERE project_id::text IN ('393', '394', '395');
DELETE FROM cashflow_points WHERE project_id::text IN ('393', '394', '395');
DELETE FROM change_requests WHERE project_id::text IN ('393', '394', '395');
DELETE FROM client_commitments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM client_updates WHERE project_id::text IN ('393', '394', '395');
DELETE FROM commissioning_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM commissioning_snapshots WHERE project_id::text IN ('393', '394', '395');
DELETE FROM communication_follow_ups WHERE project_id::text IN ('393', '394', '395');
DELETE FROM contractor_assignments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM contracts WHERE project_id::text IN ('393', '394', '395');
DELETE FROM controlled_documents WHERE project_id::text IN ('393', '394', '395');
DELETE FROM corrective_actions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM cos_status_overrides WHERE project_id::text IN ('393', '394', '395');
DELETE FROM dashboard_project_metrics WHERE project_id::text IN ('393', '394', '395');
DELETE FROM derived_project_kpis WHERE project_id::text IN ('393', '394', '395');
DELETE FROM document_activity WHERE project_id::text IN ('393', '394', '395');
DELETE FROM document_comment_mentions WHERE comment_id IN (SELECT id FROM document_comments WHERE document_id IN (SELECT id FROM managed_documents WHERE project_id::text IN ('393', '394', '395')));
DELETE FROM document_comments WHERE document_id IN (SELECT id FROM managed_documents WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM document_locks WHERE document_id IN (SELECT id FROM managed_documents WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM document_revisions WHERE document_id IN (SELECT id FROM managed_documents WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM domain_events WHERE project_id::text IN ('393', '394', '395');
DELETE FROM drawing_register WHERE project_id::text IN ('393', '394', '395');
DELETE FROM email_project_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM entity_assignments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM evidence_collected_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM evidence_evaluations WHERE project_id::text IN ('393', '394', '395');
DELETE FROM evidence_override_records WHERE project_id::text IN ('393', '394', '395');
DELETE FROM evidence_requests WHERE project_id::text IN ('393', '394', '395');
DELETE FROM evidence_requirement_definitions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM execution_gate_log WHERE project_id::text IN ('393', '394', '395');
DELETE FROM expense_task_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM expenses WHERE project_id::text IN ('393', '394', '395');
DELETE FROM field_changes WHERE change_set_id IN (SELECT id FROM change_sets WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM finance_cos_monthly WHERE project_id::text IN ('393', '394', '395');
DELETE FROM finance_revenue_monthly WHERE project_id::text IN ('393', '394', '395');
DELETE FROM financial_edit_requests WHERE project_id::text IN ('393', '394', '395');
DELETE FROM financial_integration_rules WHERE project_id::text IN ('393', '394', '395');
DELETE FROM forecast_pipeline WHERE project_id::text IN ('393', '394', '395');
DELETE FROM fye_budgets WHERE project_id::text IN ('393', '394', '395');
DELETE FROM handover_packs WHERE project_id::text IN ('393', '394', '395');
DELETE FROM handover_stakeholders WHERE handover_id IN (SELECT id FROM project_pd_pm_handover WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM hse_incidents WHERE project_id::text IN ('393', '394', '395');
DELETE FROM import_issues WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM import_logs WHERE project_id::text IN ('393', '394', '395');
DELETE FROM intake_requests WHERE project_id::text IN ('393', '394', '395');
DELETE FROM invoice_captures WHERE project_id::text IN ('393', '394', '395');
DELETE FROM invoice_pattern_matches WHERE project_id::text IN ('393', '394', '395');
DELETE FROM issue_resolution_rules WHERE project_id::text IN ('393', '394', '395');
DELETE FROM key_date_mappings WHERE project_id::text IN ('393', '394', '395');
DELETE FROM managed_documents WHERE project_id::text IN ('393', '394', '395');
DELETE FROM milestone_task_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM mytool_recurrence_templates WHERE project_id::text IN ('393', '394', '395');
DELETE FROM mytool_tasks WHERE project_id::text IN ('393', '394', '395');
DELETE FROM mytool_tasks_legacy_archive WHERE project_id::text IN ('393', '394', '395');
DELETE FROM ncr_reports WHERE project_id::text IN ('393', '394', '395');
DELETE FROM normalized_cost_line_actuals WHERE project_id::text IN ('393', '394', '395');
DELETE FROM normalized_execution_phases WHERE project_id::text IN ('393', '394', '395');
DELETE FROM normalized_plan_tasks WHERE project_id::text IN ('393', '394', '395');
DELETE FROM notifications WHERE project_id::text IN ('393', '394', '395');
DELETE FROM om_handovers WHERE project_id::text IN ('393', '394', '395');
DELETE FROM payment_batch_items WHERE payment_request_id IN (SELECT id FROM payment_requests WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM phase_template_application WHERE project_id::text IN ('393', '394', '395');
DELETE FROM plan_edit_notifications WHERE project_id::text IN ('393', '394', '395');
DELETE FROM pm_compliance_tracking WHERE project_id::text IN ('393', '394', '395');
DELETE FROM pm_on_the_go_actions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM pm_site_visits WHERE project_id::text IN ('393', '394', '395');
DELETE FROM po_review_assignments WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM priority_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM priority_projects WHERE project_id::text IN ('393', '394', '395');
DELETE FROM procurement_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_access WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_charters WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_client_commitments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_client_history WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_client_updates WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_communication_timeline_events WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_document_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_editable_fields WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_eng_approvals WHERE project_eng_stage_id IN (SELECT id FROM project_eng_stages WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM project_eng_deliverables WHERE project_eng_stage_id IN (SELECT id FROM project_eng_stages WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM project_eng_stages WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_eng_tasks_legacy_archive WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM project_events WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_execution_state WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_financial_reviews WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_gate_evaluations WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_handover_gates WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_handover_history WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_pd_pm_handover WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_phase_history WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_plan WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_portfolio_assignments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_queries WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_rag_audit WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_revenue_summary WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_settings WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_sharepoint_roots WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_data WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_decisions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_dependencies WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_evidence WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_exceptions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_financial_close_tracks WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_instances WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_stage_requirements WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_subcontractor_assignments WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_team_members WHERE project_id::text IN ('393', '394', '395');
DELETE FROM proof_of_payment WHERE payment_request_id IN (SELECT id FROM payment_requests WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM qb_link_proposed_cascades WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_checklist WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_item_evidence WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_plan_link WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_postmortem WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_postmortem_metric_value WHERE postmortem_id IN (SELECT id FROM qc_postmortem WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM qc_postmortem_summary WHERE postmortem_id IN (SELECT id FROM qc_postmortem WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM qc_risk_answer WHERE checklist_id IN (SELECT id FROM qc_checklist WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM qc_warning WHERE project_id::text IN ('393', '394', '395');
DELETE FROM qc_warning_event WHERE warning_id IN (SELECT id FROM qc_warning WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM quickbooks_cost_allocations WHERE project_id::text IN ('393', '394', '395');
DELETE FROM quickbooks_customer_mappings WHERE project_id::text IN ('393', '394', '395');
DELETE FROM quickbooks_invoice_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM raid_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM revenues WHERE project_id::text IN ('393', '394', '395');
DELETE FROM safety_file_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM schedule_change_notice WHERE project_id::text IN ('393', '394', '395');
DELETE FROM site_activities WHERE project_id::text IN ('393', '394', '395');
DELETE FROM site_inspections WHERE project_id::text IN ('393', '394', '395');
DELETE FROM snags WHERE project_id::text IN ('393', '394', '395');
DELETE FROM sseg_applications WHERE project_id::text IN ('393', '394', '395');
DELETE FROM sseg_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM stage_acceptances WHERE project_id::text IN ('393', '394', '395');
DELETE FROM stage_gate_evidence_snapshots WHERE project_id::text IN ('393', '394', '395');
DELETE FROM stage_gate_overrides WHERE project_id::text IN ('393', '394', '395');
DELETE FROM standup_entries WHERE schedule_id IN (SELECT id FROM standup_schedules WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM standup_entries_v2 WHERE project_id::text IN ('393', '394', '395');
DELETE FROM standup_participants WHERE schedule_id IN (SELECT id FROM standup_schedules WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM standup_schedules WHERE project_id::text IN ('393', '394', '395');
DELETE FROM task_time_entries WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM teams_chat_groups WHERE project_id::text IN ('393', '394', '395');
DELETE FROM teams_chat_members WHERE group_id IN (SELECT id FROM teams_chat_groups WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM teams_chat_messages WHERE group_id IN (SELECT id FROM teams_chat_groups WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM teams_project_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM tr_item_project_links WHERE project_id::text IN ('393', '394', '395');
DELETE FROM tr_item_suggestion_decisions WHERE project_id::text IN ('393', '394', '395');
DELETE FROM tracker_project_metadata WHERE project_id::text IN ('393', '394', '395');
DELETE FROM tracker_revenue_summary WHERE project_id::text IN ('393', '394', '395');
DELETE FROM user_project_folders WHERE project_id::text IN ('393', '394', '395');
DELETE FROM weekly_reviews WHERE project_id::text IN ('393', '394', '395');
DELETE FROM work_item_assignments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM work_item_attachments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM work_item_comments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM work_item_dependencies WHERE predecessor_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM work_item_status_history WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM work_item_tags WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM working_plan_dependency_override WHERE scenario_id IN (SELECT id FROM working_plan_scenario WHERE project_id::text IN ('393', '394', '395'));
DELETE FROM working_plan_scenario WHERE project_id::text IN ('393', '394', '395');
DELETE FROM writeback_audit_log WHERE project_id::text IN ('393', '394', '395');
DELETE FROM normalized_revenue_lines WHERE project_id::text IN ('393', '394', '395');
DELETE FROM commissioning_sources WHERE project_id::text IN ('393', '394', '395');
DELETE FROM normalized_cost_lines WHERE project_id::text IN ('393', '394', '395');
DELETE FROM change_sets WHERE project_id::text IN ('393', '394', '395');
DELETE FROM work_items WHERE project_id::text IN ('393', '394', '395');
DELETE FROM payment_requests WHERE project_id::text IN ('393', '394', '395');
DELETE FROM quickbooks_documents WHERE project_id::text IN ('393', '394', '395');
DELETE FROM project_plan_dependency WHERE project_id::text IN ('393', '394', '395');
DELETE FROM writeback_mappings WHERE project_id::text IN ('393', '394', '395');
DELETE FROM category_revenue_allocations WHERE project_id::text IN ('393', '394', '395');
DELETE FROM engineering_tickets WHERE project_id::text IN ('393', '394', '395');
DELETE FROM purchase_orders WHERE project_id::text IN ('393', '394', '395');
DELETE FROM smart_import_runs WHERE project_id::text IN ('393', '394', '395');

-- ---- finally, the project rows themselves ----
DELETE FROM project_info WHERE id IN (393, 394, 395);

-- ---- verification: every count below MUST be 0 before you COMMIT ----
SELECT
  (SELECT count(*) FROM project_info WHERE id IN (393, 394, 395))                 AS projects_left,
  (SELECT count(*) FROM work_items   WHERE project_id IN (393, 394, 395))         AS work_items_left,
  (SELECT count(*) FROM normalized_cost_lines WHERE project_id IN (393,394,395))  AS cost_lines_left,
  (SELECT count(*) FROM budgets      WHERE project_id IN (393, 394, 395))         AS budgets_left;

-- If all counts are 0:  COMMIT;
-- If anything looks wrong:  ROLLBACK;
