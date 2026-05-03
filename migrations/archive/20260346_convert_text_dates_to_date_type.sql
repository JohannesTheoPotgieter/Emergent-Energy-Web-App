-- Migration: Convert TEXT date columns to proper DATE type
--
-- Many date columns were originally created as TEXT. This migration converts the
-- most critical ones to DATE type for better query performance, validation, and
-- compatibility with date arithmetic.
--
-- Safety: uses NULLIF to handle empty strings, and CASE expressions to skip
-- values that don't match YYYY-MM-DD format. Invalid values are set to NULL
-- rather than failing the migration.

-- ===================== work_items =====================

ALTER TABLE work_items
  ALTER COLUMN start_date TYPE date
    USING CASE
      WHEN start_date IS NULL OR start_date = '' THEN NULL
      WHEN start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN start_date::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN end_date TYPE date
    USING CASE
      WHEN end_date IS NULL OR end_date = '' THEN NULL
      WHEN end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN end_date::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN scheduled_date TYPE date
    USING CASE
      WHEN scheduled_date IS NULL OR scheduled_date = '' THEN NULL
      WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$' THEN scheduled_date::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN baseline_start TYPE date
    USING CASE
      WHEN baseline_start IS NULL OR baseline_start = '' THEN NULL
      WHEN baseline_start ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_start::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN baseline_end TYPE date
    USING CASE
      WHEN baseline_end IS NULL OR baseline_end = '' THEN NULL
      WHEN baseline_end ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_end::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN actual_start TYPE date
    USING CASE
      WHEN actual_start IS NULL OR actual_start = '' THEN NULL
      WHEN actual_start ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_start::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN actual_end TYPE date
    USING CASE
      WHEN actual_end IS NULL OR actual_end = '' THEN NULL
      WHEN actual_end ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_end::date
      ELSE NULL
    END;

ALTER TABLE work_items
  ALTER COLUMN recurrence_end_date TYPE date
    USING CASE
      WHEN recurrence_end_date IS NULL OR recurrence_end_date = '' THEN NULL
      WHEN recurrence_end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN recurrence_end_date::date
      ELSE NULL
    END;

-- ===================== work_item_scheduling =====================

ALTER TABLE work_item_scheduling
  ALTER COLUMN scheduled_date TYPE date
    USING CASE
      WHEN scheduled_date IS NULL OR scheduled_date = '' THEN NULL
      WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$' THEN scheduled_date::date
      ELSE NULL
    END;

ALTER TABLE work_item_scheduling
  ALTER COLUMN baseline_start TYPE date
    USING CASE
      WHEN baseline_start IS NULL OR baseline_start = '' THEN NULL
      WHEN baseline_start ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_start::date
      ELSE NULL
    END;

ALTER TABLE work_item_scheduling
  ALTER COLUMN baseline_end TYPE date
    USING CASE
      WHEN baseline_end IS NULL OR baseline_end = '' THEN NULL
      WHEN baseline_end ~ '^\d{4}-\d{2}-\d{2}$' THEN baseline_end::date
      ELSE NULL
    END;

ALTER TABLE work_item_scheduling
  ALTER COLUMN actual_start TYPE date
    USING CASE
      WHEN actual_start IS NULL OR actual_start = '' THEN NULL
      WHEN actual_start ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_start::date
      ELSE NULL
    END;

ALTER TABLE work_item_scheduling
  ALTER COLUMN actual_end TYPE date
    USING CASE
      WHEN actual_end IS NULL OR actual_end = '' THEN NULL
      WHEN actual_end ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_end::date
      ELSE NULL
    END;

ALTER TABLE work_item_scheduling
  ALTER COLUMN recurrence_end_date TYPE date
    USING CASE
      WHEN recurrence_end_date IS NULL OR recurrence_end_date = '' THEN NULL
      WHEN recurrence_end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN recurrence_end_date::date
      ELSE NULL
    END;

-- ===================== task_time_entries =====================

ALTER TABLE task_time_entries
  ALTER COLUMN date TYPE date
    USING CASE
      WHEN date IS NULL OR date = '' THEN NULL
      WHEN date ~ '^\d{4}-\d{2}-\d{2}$' THEN date::date
      ELSE NULL
    END;

-- ===================== project_plan =====================

ALTER TABLE project_plan
  ALTER COLUMN actual_start TYPE date
    USING CASE
      WHEN actual_start IS NULL OR actual_start = '' THEN NULL
      WHEN actual_start ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_start::date
      ELSE NULL
    END;

ALTER TABLE project_plan
  ALTER COLUMN actual_end TYPE date
    USING CASE
      WHEN actual_end IS NULL OR actual_end = '' THEN NULL
      WHEN actual_end ~ '^\d{4}-\d{2}-\d{2}$' THEN actual_end::date
      ELSE NULL
    END;

-- ===================== program_expense (date columns) =====================

ALTER TABLE program_expense
  ALTER COLUMN forecast_payment_date TYPE date
    USING CASE
      WHEN forecast_payment_date IS NULL OR forecast_payment_date = '' THEN NULL
      WHEN forecast_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN forecast_payment_date::date
      ELSE NULL
    END;

ALTER TABLE program_expense
  ALTER COLUMN expense_invoiced_date TYPE date
    USING CASE
      WHEN expense_invoiced_date IS NULL OR expense_invoiced_date = '' THEN NULL
      WHEN expense_invoiced_date ~ '^\d{4}-\d{2}-\d{2}$' THEN expense_invoiced_date::date
      ELSE NULL
    END;

ALTER TABLE program_expense
  ALTER COLUMN expense_payment_date TYPE date
    USING CASE
      WHEN expense_payment_date IS NULL OR expense_payment_date = '' THEN NULL
      WHEN expense_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN expense_payment_date::date
      ELSE NULL
    END;

ALTER TABLE program_expense
  ALTER COLUMN computed_forecast_payment_date TYPE date
    USING CASE
      WHEN computed_forecast_payment_date IS NULL OR computed_forecast_payment_date = '' THEN NULL
      WHEN computed_forecast_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN computed_forecast_payment_date::date
      ELSE NULL
    END;

-- ===================== program_inflows (date columns) =====================

ALTER TABLE program_inflows
  ALTER COLUMN planned_payment_date TYPE date
    USING CASE
      WHEN planned_payment_date IS NULL OR planned_payment_date = '' THEN NULL
      WHEN planned_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN planned_payment_date::date
      ELSE NULL
    END;

ALTER TABLE program_inflows
  ALTER COLUMN invoice_raised_date TYPE date
    USING CASE
      WHEN invoice_raised_date IS NULL OR invoice_raised_date = '' THEN NULL
      WHEN invoice_raised_date ~ '^\d{4}-\d{2}-\d{2}$' THEN invoice_raised_date::date
      ELSE NULL
    END;

ALTER TABLE program_inflows
  ALTER COLUMN payment_received_date TYPE date
    USING CASE
      WHEN payment_received_date IS NULL OR payment_received_date = '' THEN NULL
      WHEN payment_received_date ~ '^\d{4}-\d{2}-\d{2}$' THEN payment_received_date::date
      ELSE NULL
    END;

ALTER TABLE program_inflows
  ALTER COLUMN computed_forecast_receipt_date TYPE date
    USING CASE
      WHEN computed_forecast_receipt_date IS NULL OR computed_forecast_receipt_date = '' THEN NULL
      WHEN computed_forecast_receipt_date ~ '^\d{4}-\d{2}-\d{2}$' THEN computed_forecast_receipt_date::date
      ELSE NULL
    END;

-- ===================== cashflow_points =====================

ALTER TABLE cashflow_points
  ALTER COLUMN point_date TYPE date
    USING CASE
      WHEN point_date IS NULL OR point_date = '' THEN NULL
      WHEN point_date ~ '^\d{4}-\d{2}-\d{2}$' THEN point_date::date
      ELSE NULL
    END;

-- ===================== finance_revenue_monthly / finance_cos_monthly =====================

ALTER TABLE finance_revenue_monthly
  ALTER COLUMN month_end_date TYPE date
    USING CASE
      WHEN month_end_date IS NULL OR month_end_date = '' THEN NULL
      WHEN month_end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN month_end_date::date
      ELSE NULL
    END;

ALTER TABLE finance_cos_monthly
  ALTER COLUMN month_end_date TYPE date
    USING CASE
      WHEN month_end_date IS NULL OR month_end_date = '' THEN NULL
      WHEN month_end_date ~ '^\d{4}-\d{2}-\d{2}$' THEN month_end_date::date
      ELSE NULL
    END;

-- ===================== normalized_revenue_lines (date columns) =====================

ALTER TABLE normalized_revenue_lines
  ALTER COLUMN invoice_date TYPE date
    USING CASE
      WHEN invoice_date IS NULL OR invoice_date = '' THEN NULL
      WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}$' THEN invoice_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_revenue_lines
  ALTER COLUMN expected_payment_date TYPE date
    USING CASE
      WHEN expected_payment_date IS NULL OR expected_payment_date = '' THEN NULL
      WHEN expected_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN expected_payment_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_revenue_lines
  ALTER COLUMN paid_date TYPE date
    USING CASE
      WHEN paid_date IS NULL OR paid_date = '' THEN NULL
      WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}$' THEN paid_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_revenue_lines
  ALTER COLUMN in_bank_date TYPE date
    USING CASE
      WHEN in_bank_date IS NULL OR in_bank_date = '' THEN NULL
      WHEN in_bank_date ~ '^\d{4}-\d{2}-\d{2}$' THEN in_bank_date::date
      ELSE NULL
    END;

-- ===================== normalized_cost_lines (date columns) =====================

ALTER TABLE normalized_cost_lines
  ALTER COLUMN invoice_date TYPE date
    USING CASE
      WHEN invoice_date IS NULL OR invoice_date = '' THEN NULL
      WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}$' THEN invoice_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_cost_lines
  ALTER COLUMN approved_date TYPE date
    USING CASE
      WHEN approved_date IS NULL OR approved_date = '' THEN NULL
      WHEN approved_date ~ '^\d{4}-\d{2}-\d{2}$' THEN approved_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_cost_lines
  ALTER COLUMN paid_date TYPE date
    USING CASE
      WHEN paid_date IS NULL OR paid_date = '' THEN NULL
      WHEN paid_date ~ '^\d{4}-\d{2}-\d{2}$' THEN paid_date::date
      ELSE NULL
    END;

ALTER TABLE normalized_cost_lines
  ALTER COLUMN forecast_payment_date TYPE date
    USING CASE
      WHEN forecast_payment_date IS NULL OR forecast_payment_date = '' THEN NULL
      WHEN forecast_payment_date ~ '^\d{4}-\d{2}-\d{2}$' THEN forecast_payment_date::date
      ELSE NULL
    END;

-- ===================== cashflow & schedule misc =====================

ALTER TABLE cashflow_weekly_manual
  ALTER COLUMN week_start_date TYPE date
    USING CASE
      WHEN week_start_date IS NULL OR week_start_date = '' THEN NULL
      WHEN week_start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN week_start_date::date
      ELSE NULL
    END;

ALTER TABLE cashflow_balance_history
  ALTER COLUMN week_start_date TYPE date
    USING CASE
      WHEN week_start_date IS NULL OR week_start_date = '' THEN NULL
      WHEN week_start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN week_start_date::date
      ELSE NULL
    END;

ALTER TABLE available_payment_overrides
  ALTER COLUMN week_start_date TYPE date
    USING CASE
      WHEN week_start_date IS NULL OR week_start_date = '' THEN NULL
      WHEN week_start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN week_start_date::date
      ELSE NULL
    END;

ALTER TABLE available_payment_history
  ALTER COLUMN week_start_date TYPE date
    USING CASE
      WHEN week_start_date IS NULL OR week_start_date = '' THEN NULL
      WHEN week_start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN week_start_date::date
      ELSE NULL
    END;

ALTER TABLE opex_weekly_manual
  ALTER COLUMN week_start_date TYPE date
    USING CASE
      WHEN week_start_date IS NULL OR week_start_date = '' THEN NULL
      WHEN week_start_date ~ '^\d{4}-\d{2}-\d{2}$' THEN week_start_date::date
      ELSE NULL
    END;

ALTER TABLE schedule_change_notice
  ALTER COLUMN old_finish_date TYPE date
    USING CASE
      WHEN old_finish_date IS NULL OR old_finish_date = '' THEN NULL
      WHEN old_finish_date ~ '^\d{4}-\d{2}-\d{2}$' THEN old_finish_date::date
      ELSE NULL
    END;

ALTER TABLE schedule_change_notice
  ALTER COLUMN new_finish_date TYPE date
    USING CASE
      WHEN new_finish_date IS NULL OR new_finish_date = '' THEN NULL
      WHEN new_finish_date ~ '^\d{4}-\d{2}-\d{2}$' THEN new_finish_date::date
      ELSE NULL
    END;

-- ===================== milestone/expense task links =====================

ALTER TABLE milestone_task_links
  ALTER COLUMN date_override TYPE date
    USING CASE
      WHEN date_override IS NULL OR date_override = '' THEN NULL
      WHEN date_override ~ '^\d{4}-\d{2}-\d{2}$' THEN date_override::date
      ELSE NULL
    END;

ALTER TABLE expense_task_links
  ALTER COLUMN date_override TYPE date
    USING CASE
      WHEN date_override IS NULL OR date_override = '' THEN NULL
      WHEN date_override ~ '^\d{4}-\d{2}-\d{2}$' THEN date_override::date
      ELSE NULL
    END;

-- ===================== invoice_captures =====================

ALTER TABLE invoice_captures
  ALTER COLUMN invoice_date TYPE date
    USING CASE
      WHEN invoice_date IS NULL OR invoice_date = '' THEN NULL
      WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}$' THEN invoice_date::date
      ELSE NULL
    END;

-- ===================== procurement_items =====================

ALTER TABLE procurement_items
  ALTER COLUMN required_date TYPE date
    USING CASE
      WHEN required_date IS NULL OR required_date = '' THEN NULL
      WHEN required_date ~ '^\d{4}-\d{2}-\d{2}$' THEN required_date::date
      ELSE NULL
    END;

-- ===================== forecast_pipeline =====================

ALTER TABLE forecast_pipeline
  ALTER COLUMN forecast_signature_date TYPE date
    USING CASE
      WHEN forecast_signature_date IS NULL OR forecast_signature_date = '' THEN NULL
      WHEN forecast_signature_date ~ '^\d{4}-\d{2}-\d{2}$' THEN forecast_signature_date::date
      ELSE NULL
    END;

-- ===================== lost_deals =====================

ALTER TABLE lost_deals
  ALTER COLUMN lost_date TYPE date
    USING CASE
      WHEN lost_date IS NULL OR lost_date = '' THEN NULL
      WHEN lost_date ~ '^\d{4}-\d{2}-\d{2}$' THEN lost_date::date
      ELSE NULL
    END;

-- ===================== tr_items =====================

ALTER TABLE tr_items
  ALTER COLUMN scheduled_date TYPE date
    USING CASE
      WHEN scheduled_date IS NULL OR scheduled_date = '' THEN NULL
      WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$' THEN scheduled_date::date
      ELSE NULL
    END;

-- ===================== fye_report_snapshots =====================

ALTER TABLE fye_report_snapshots
  ALTER COLUMN snapshot_date TYPE date
    USING CASE
      WHEN snapshot_date IS NULL OR snapshot_date = '' THEN NULL
      WHEN snapshot_date ~ '^\d{4}-\d{2}-\d{2}$' THEN snapshot_date::date
      ELSE NULL
    END;
