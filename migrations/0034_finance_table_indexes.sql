-- =========================================================================
-- Performance: composite indexes on the two highest-frequency temporal
-- finance tables.
--
-- Every project-dashboard query filters normalized_cost_lines and
-- normalized_revenue_lines by (project_id, effective_to IS NULL). Without
-- these indexes the database performs a full table scan on every page load,
-- which degrades exponentially as import volume grows.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS is safe to re-run.
-- =========================================================================

-- normalized_cost_lines: (project_id, effective_to) ----------------------
CREATE INDEX IF NOT EXISTS "idx_ncl_project_effective_to"
  ON "normalized_cost_lines" ("project_id", "effective_to");
--> statement-breakpoint

-- normalized_cost_lines: partial index for active rows only (effective_to IS NULL)
-- Speeds up the most common query pattern: WHERE project_id = $1 AND effective_to IS NULL
CREATE INDEX IF NOT EXISTS "idx_ncl_project_active"
  ON "normalized_cost_lines" ("project_id")
  WHERE "effective_to" IS NULL;
--> statement-breakpoint

-- normalized_revenue_lines: (project_id, effective_to) -------------------
CREATE INDEX IF NOT EXISTS "idx_nrl_project_effective_to"
  ON "normalized_revenue_lines" ("project_id", "effective_to");
--> statement-breakpoint

-- normalized_revenue_lines: partial index for active rows only
CREATE INDEX IF NOT EXISTS "idx_nrl_project_active"
  ON "normalized_revenue_lines" ("project_id")
  WHERE "effective_to" IS NULL;
