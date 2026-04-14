-- Read-only drift audit pack
-- Run this script separately against DEV and PROD, then diff outputs.
-- Safe: contains SELECT statements only.

\echo '=== 1) migration files visible to DB runner (if tracked tables exist) ==='
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('__drizzle_migrations', 'drizzle_migrations', 'schema_migrations', 'flyway_schema_history')
ORDER BY table_schema, table_name;

\echo '=== 2) applied migration rows (best effort) ==='
SELECT * FROM __drizzle_migrations ORDER BY created_at DESC NULLS LAST LIMIT 200;
SELECT * FROM drizzle_migrations ORDER BY created_at DESC NULLS LAST LIMIT 200;
SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 200;
SELECT * FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 200;

\echo '=== 3) normalized finance indexes ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('normalized_cost_lines','normalized_revenue_lines')
ORDER BY tablename, indexname;

\echo '=== 4) FK definitions touching project_info ==='
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  rc.update_rule,
  rc.delete_rule,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
  AND tc.table_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'project_info'
ORDER BY tc.table_name, tc.constraint_name;

\echo '=== 5) duplicate-ish route-sensitive feature flags in app_settings ==='
SELECT key, value, updated_at, updated_by
FROM app_settings
WHERE key IN (
  'migration_bridge_project_read_v1',
  'migration_bridge_lifecycle_read_v1',
  'migration_bridge_approvals_dual_read_v1',
  'migration_bridge_finance_read_v1',
  'migration_bridge_deliverables_read_v1',
  'migration_bridge_party_read_v1',
  'canonical_finance_costline_read_v1',
  'promoted_core_project_master_dual_write',
  'promoted_finance_read',
  'task_management_hub',
  'standup_system'
)
ORDER BY key;

\echo '=== 6) permissions + overrides ==='
SELECT role, can_manage_users, can_manage_roles, updated_at
FROM role_permissions
ORDER BY role;

SELECT user_id, entity, action, allowed, expires_at, created_at
FROM user_permission_overrides
ORDER BY user_id, entity, action
LIMIT 500;

\echo '=== 7) seed/backfill registry and derived data health checks ==='
SELECT key, completed_at, notes
FROM startup_backfill_registry
ORDER BY completed_at DESC NULLS LAST;

SELECT 'project_info' AS table_name, COUNT(*) AS row_count FROM project_info
UNION ALL
SELECT 'normalized_cost_lines', COUNT(*) FROM normalized_cost_lines
UNION ALL
SELECT 'normalized_revenue_lines', COUNT(*) FROM normalized_revenue_lines
UNION ALL
SELECT 'project_stage_instances', COUNT(*) FROM project_stage_instances
UNION ALL
SELECT 'project_gate_evaluations', COUNT(*) FROM project_gate_evaluations;

\echo '=== 8) potentially dangerous legacy tables still present ==='
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('program_expense','program_inflows')
ORDER BY table_name;
