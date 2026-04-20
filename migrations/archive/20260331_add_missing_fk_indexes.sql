-- =============================================================================
-- Migration: Add missing indexes to high-traffic FK columns and composite paths
-- Date: 2026-03-31
-- Risk: LOW
--
-- Transaction behavior:
--   The migration runner (db.execute via drizzle-orm) does NOT auto-wrap in a
--   transaction, so each statement runs independently. This means:
--   - CREATE INDEX CONCURRENTLY *could* be used since there's no outer transaction.
--   - However, existing migrations in this codebase consistently use plain
--     CREATE INDEX IF NOT EXISTS (not CONCURRENTLY).
--   - We follow the established pattern for consistency.
--   - For production with large tables, consider running these statements
--     individually with CONCURRENTLY to avoid table locks:
--       CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name ON table(col);
--
-- Idempotent: all use IF NOT EXISTS.
--
-- SKIPPED (already exist in 20260340_schema_consistency_fixes.sql):
--   - idx_work_items_client_id on work_items(client_id)
--   - idx_normalized_cost_lines_counterparty_id on normalized_cost_lines(counterparty_id)
-- =============================================================================

-- ─── Single-column FK indexes ───────────────────────────────────────────────

-- normalized_cost_lines: import_run_id is queried on every import commit/rollback
CREATE INDEX IF NOT EXISTS idx_ncl_import_run_id
  ON normalized_cost_lines(import_run_id);

-- normalized_revenue_lines: import_run_id is queried on every import commit/rollback
CREATE INDEX IF NOT EXISTS idx_nrl_import_run_id
  ON normalized_revenue_lines(import_run_id);

-- handover_checklist_items: handover_pack_id FK used in handover pack detail queries
CREATE INDEX IF NOT EXISTS idx_hci_handover_pack_id
  ON handover_checklist_items(handover_pack_id);

-- sites: client_id FK used in project-site-client joins
CREATE INDEX IF NOT EXISTS idx_sites_client_id
  ON sites(client_id);

-- users: role used in permission evaluation, dashboard routing, role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);


-- ─── Composite indexes for common query paths ──────────────────────────────

-- change_sets: entity_type + entity_id queried together for audit/diff lookups
CREATE INDEX IF NOT EXISTS idx_cs_entity
  ON change_sets(entity_type, entity_id);

-- normalized_cost_lines: project_id + snapshot_run_id for temporal snapshot queries
CREATE INDEX IF NOT EXISTS idx_ncl_project_snapshot
  ON normalized_cost_lines(project_id, snapshot_run_id);

-- normalized_revenue_lines: project_id + snapshot_run_id for temporal snapshot queries
CREATE INDEX IF NOT EXISTS idx_nrl_project_snapshot
  ON normalized_revenue_lines(project_id, snapshot_run_id);

-- project_stage_instances: project_id + stage_code for lifecycle gate lookups
CREATE INDEX IF NOT EXISTS idx_psi_project_stage
  ON project_stage_instances(project_id, stage_code);
