-- Migration: Drop deprecated override tables
-- These tables held inline overrides that were collapsed into base table rows
-- during Spine V2 Prompts 3-4 (override collapse). All application consumers
-- have been removed — the tables are no longer read or written.

DROP TABLE IF EXISTS expenditure_overrides CASCADE;
DROP TABLE IF EXISTS revenue_tracking_overrides CASCADE;
DROP TABLE IF EXISTS cashflow_planning_overrides CASCADE;
DROP TABLE IF EXISTS cos_status_overrides CASCADE;
DROP TABLE IF EXISTS finance_revenue_overrides CASCADE;
DROP TABLE IF EXISTS finance_cos_overrides CASCADE;
DROP TABLE IF EXISTS project_plan_overrides CASCADE;
DROP TABLE IF EXISTS working_plan_task_override CASCADE;
DROP TABLE IF EXISTS line_item_overrides CASCADE;
DROP TABLE IF EXISTS planning_overrides CASCADE;
DROP TABLE IF EXISTS date_overrides CASCADE;
