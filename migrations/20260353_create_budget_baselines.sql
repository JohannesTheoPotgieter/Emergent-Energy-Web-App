-- Step B5: Create Budget Baseline entity — formal frozen baselines with version control
-- New table, zero impact on existing finance logic

CREATE TABLE IF NOT EXISTS budget_baselines (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id),
  version INTEGER NOT NULL DEFAULT 1,
  revenue_baseline DECIMAL(15, 2),
  cos_baseline DECIMAL(15, 2),
  margin_baseline DECIMAL(15, 2),
  contingency DECIMAL(15, 2),
  approved_by_user_id INTEGER REFERENCES users(id),
  approved_date TIMESTAMP,
  change_locked BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, version)
);
