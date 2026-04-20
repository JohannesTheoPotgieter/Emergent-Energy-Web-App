-- Add COS status override columns for admin-controlled status overrides
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override TEXT;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_by INTEGER REFERENCES users(id);
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_at TIMESTAMP;
ALTER TABLE normalized_cost_lines ADD COLUMN IF NOT EXISTS cos_status_override_reason TEXT;
