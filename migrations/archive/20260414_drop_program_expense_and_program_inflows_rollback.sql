-- ============================================================================
-- Rollback for 20260414_drop_program_expense_and_program_inflows.sql
-- ============================================================================
--
-- ⚠️ STRUCTURE-ONLY ROLLBACK ⚠️
-- ----------------------------
-- This rollback recreates the empty program_expense and program_inflows
-- tables with the same columns as the original Drizzle schema at the time
-- of the drop. It does NOT restore any data. Restoring data after the
-- forward migration has run requires a database backup and a separate
-- recovery procedure.
--
-- This file exists so that:
--   * if the drop was run by mistake, the code that references
--     programExpense/programInflows (if any still exists, e.g. a feature
--     branch that was not yet rebased) can at least instantiate Drizzle
--     selects against an empty table without throwing "relation does not
--     exist";
--   * any feature branch that still imports these types can rebase past
--     the drop without a manual db fix.
--
-- If you need actual data restored, use a database backup from before
-- the forward migration ran.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS program_expense (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  row_number INTEGER,
  row_type TEXT DEFAULT 'item',
  expense_category TEXT,
  expense_line_item TEXT,
  budget_qty NUMERIC(12,4),
  budget_rate_unit NUMERIC(15,2),
  budget_total NUMERIC(15,2),
  forecast_payment_date DATE,
  budget_cos_total NUMERIC(15,2),
  expense_qty NUMERIC(12,4),
  expense_rate_unit NUMERIC(15,2),
  expense_actual_total NUMERIC(15,2),
  expense_po_number TEXT,
  expense_invoice_number TEXT,
  expense_invoiced_date DATE,
  invoice_date_confirmed BOOLEAN DEFAULT FALSE,
  invoice_date_font_color TEXT,
  expense_payment_date DATE,
  payment_date_confirmed BOOLEAN DEFAULT FALSE,
  payment_date_font_color TEXT,
  revenue_amount NUMERIC(15,2),
  actual_cos_total NUMERIC(15,2),
  line_status TEXT,
  expense_line_hash TEXT,
  computed_state TEXT,
  computed_forecast_payment_date DATE,
  admin_date_override DATE,
  admin_date_override_reason TEXT,
  admin_date_override_by INTEGER,
  admin_date_override_at TIMESTAMP,
  supplier_name TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  sub_project_name TEXT,
  cos_status_override TEXT,
  cos_status_override_by INTEGER,
  cos_status_override_at TIMESTAMP,
  cos_status_override_reason TEXT,
  data_source TEXT DEFAULT 'SMART_IMPORT',
  project_id INTEGER NOT NULL,
  import_run_id INTEGER,
  "source" TEXT NOT NULL DEFAULT 'imported',
  import_snapshot JSONB,
  last_edited_by INTEGER,
  last_edited_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP,
  snapshot_run_id INTEGER,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_inflows (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  row_number INTEGER,
  milestone_no TEXT,
  milestone_name TEXT,
  milestone_percent NUMERIC(6,4),
  milestone_amount NUMERIC(15,2),
  planned_payment_date DATE,
  milestone_invoice_number TEXT,
  invoice_raised_date DATE,
  payment_received_date DATE,
  milestone_notes TEXT,
  documents_received TEXT,
  in_bank INTEGER DEFAULT 0,
  inflow_line_hash TEXT,
  computed_forecast_receipt_date DATE,
  admin_date_override DATE,
  admin_date_override_reason TEXT,
  admin_date_override_by INTEGER,
  admin_date_override_at TIMESTAMP,
  sub_project_name TEXT,
  data_source TEXT DEFAULT 'SMART_IMPORT',
  project_id INTEGER NOT NULL,
  import_run_id INTEGER,
  "source" TEXT NOT NULL DEFAULT 'imported',
  import_snapshot JSONB,
  last_edited_by INTEGER,
  last_edited_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP,
  snapshot_run_id INTEGER
);

COMMIT;
