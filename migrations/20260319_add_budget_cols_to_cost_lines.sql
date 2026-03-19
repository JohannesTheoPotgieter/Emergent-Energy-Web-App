-- Add budget reference columns and revenue recognition to normalized_cost_lines
-- These store read-only budget data from the left pane of Expenditure Breakdown sheets.

ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_qty TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_rate TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_total TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS budget_cos TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS revenue_recognition_amount TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
