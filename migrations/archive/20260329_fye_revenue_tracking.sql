-- FYE Revenue Tracking feature tables
-- Adds: fye_budgets, forecast_pipeline, lost_deals

CREATE TABLE IF NOT EXISTS fye_budgets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project_info(id),
  project_name TEXT NOT NULL,
  fye TEXT NOT NULL,
  month_key TEXT NOT NULL,
  budget_type TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecast_pipeline (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_developer TEXT,
  location TEXT,
  size_kwp DECIMAL(12,2),
  deal_probability_pct INTEGER NOT NULL DEFAULT 75,
  forecast_signature_date TEXT,
  solar_revenue DECIMAL(15,2) DEFAULT 0,
  bess_revenue DECIMAL(15,2) DEFAULT 0,
  forecast_gp_pct DECIMAL(6,4) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_deals (
  id SERIAL PRIMARY KEY,
  deal_name TEXT NOT NULL,
  deal_value DECIMAL(15,2),
  business_developer TEXT,
  lost_reason TEXT,
  lost_date TEXT,
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
