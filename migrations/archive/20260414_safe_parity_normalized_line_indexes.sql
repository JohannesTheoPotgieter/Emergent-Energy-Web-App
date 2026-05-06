-- Safe parity guard: ensure critical normalized-line indexes exist in all envs.
-- Additive + idempotent.

CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project_id
  ON normalized_cost_lines (project_id);

CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_project_id
  ON normalized_revenue_lines (project_id);
