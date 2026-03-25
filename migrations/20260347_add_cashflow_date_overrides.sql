-- Add admin date override columns to program_expense
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER REFERENCES users(id);
ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMPTZ;

-- Add admin date override columns to program_inflows
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER REFERENCES users(id);
ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMPTZ;

-- Add admin date override columns to normalized_cost_lines
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER REFERENCES users(id);
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMPTZ;

-- Add admin date override columns to normalized_revenue_lines
ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override DATE;
ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_reason TEXT;
ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_by INTEGER REFERENCES users(id);
ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS admin_date_override_at TIMESTAMPTZ;
