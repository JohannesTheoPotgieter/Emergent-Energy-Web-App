-- Add sub_project_name to program_expense and program_inflows tables
-- for multi-project (Ad Hoc) tracker support.
-- Also ensure budget columns exist on program_expense (they may have been
-- defined in the Drizzle schema but never added to the actual database).

ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_qty NUMERIC(12,4);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_rate_unit NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_total NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_cos_total NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_qty NUMERIC(12,4);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_rate_unit NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_actual_total NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_po_number TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoice_number TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoiced_date TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_font_color TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_payment_date TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_font_color TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS actual_cos_total NUMERIC(15,2);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS line_status TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_line_hash TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_state TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_forecast_payment_date TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_run_id INTEGER;

ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
