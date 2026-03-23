-- Rollback: Recreate deprecated override tables
-- These are empty shells to restore the schema — no data is recovered.

CREATE TABLE IF NOT EXISTS cashflow_planning_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  week_start_date TEXT NOT NULL,
  series_name TEXT NOT NULL,
  override_value DECIMAL(15,2) NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_plan_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  row_number INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  override_value TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_tracking_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  row_number INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  override_value TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenditure_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  row_number INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  override_value TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cos_status_overrides (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  row_number INTEGER NOT NULL,
  original_status TEXT NOT NULL,
  override_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  overridden_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_revenue_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  category TEXT NOT NULL,
  month_end_date TEXT NOT NULL,
  override_value DECIMAL(15,2),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_cos_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  category TEXT NOT NULL,
  month_end_date TEXT NOT NULL,
  override_value DECIMAL(15,2),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS working_plan_task_override (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES working_plan_scenario(id) ON DELETE CASCADE,
  imported_task_id INTEGER REFERENCES project_plan(id),
  override_start_date TEXT,
  override_end_date TEXT,
  override_duration_days INTEGER,
  override_name TEXT,
  override_task_no TEXT,
  override_comment TEXT,
  deleted_flag INTEGER NOT NULL DEFAULT 0,
  is_new_task INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_item_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  override_value TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planning_overrides (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  override_value TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS date_overrides (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  original_date TEXT,
  override_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
