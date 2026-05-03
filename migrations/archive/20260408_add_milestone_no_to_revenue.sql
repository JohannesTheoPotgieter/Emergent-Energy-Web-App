-- Smart Import v2: Add milestoneNo and milestonePercent to normalized_revenue_lines
-- These fields are extracted from Excel trackers during normalization
-- and preserved canonically for row identity matching.
-- Safe additive migration: nullable columns, no data changes.

ALTER TABLE normalized_revenue_lines
  ADD COLUMN IF NOT EXISTS milestone_no TEXT,
  ADD COLUMN IF NOT EXISTS milestone_percent NUMERIC(6,4);
