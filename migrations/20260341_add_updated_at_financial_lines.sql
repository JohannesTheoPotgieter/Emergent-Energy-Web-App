-- Add updated_at column to normalized_cost_lines and normalized_revenue_lines
-- for optimistic locking on concurrent edits

ALTER TABLE normalized_cost_lines
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Auto-update trigger for normalized_cost_lines
CREATE OR REPLACE FUNCTION update_normalized_cost_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalized_cost_lines_updated_at ON normalized_cost_lines;
CREATE TRIGGER trg_normalized_cost_lines_updated_at
  BEFORE UPDATE ON normalized_cost_lines
  FOR EACH ROW EXECUTE FUNCTION update_normalized_cost_lines_updated_at();

-- Auto-update trigger for normalized_revenue_lines
CREATE OR REPLACE FUNCTION update_normalized_revenue_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalized_revenue_lines_updated_at ON normalized_revenue_lines;
CREATE TRIGGER trg_normalized_revenue_lines_updated_at
  BEFORE UPDATE ON normalized_revenue_lines
  FOR EACH ROW EXECUTE FUNCTION update_normalized_revenue_lines_updated_at();
