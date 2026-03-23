-- Add financial estimate fields to pd_tickets for pipeline value forecasting
ALTER TABLE pd_tickets
  ADD COLUMN IF NOT EXISTS estimated_project_value DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS estimated_margin DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS estimated_margin_percent DECIMAL(6, 2),
  ADD COLUMN IF NOT EXISTS financial_notes TEXT;
