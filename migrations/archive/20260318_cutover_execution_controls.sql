BEGIN;

CREATE TABLE IF NOT EXISTS internal.cutover_backup_references (
  id BIGSERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL,
  backup_type TEXT NOT NULL DEFAULT 'database_snapshot',
  recorded_by TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal.cutover_execution_log (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_by TEXT NOT NULL DEFAULT 'system',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal.cutover_domain_state (
  domain TEXT PRIMARY KEY,
  cutover_state TEXT NOT NULL,
  promoted_read_primary BOOLEAN NOT NULL DEFAULT FALSE,
  dual_write_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_fallback_available BOOLEAN NOT NULL DEFAULT TRUE,
  rollback_flag_key TEXT,
  readiness_evidence_source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

INSERT INTO internal.cutover_domain_state (
  domain,
  cutover_state,
  promoted_read_primary,
  dual_write_enabled,
  legacy_fallback_available,
  rollback_flag_key,
  readiness_evidence_source,
  updated_by
)
VALUES
  ('core_master_data', 'cutover_ready_with_compat', TRUE, TRUE, TRUE, 'promoted_core_projects_read/promoted_core_clients_read/promoted_core_portfolios_read/promoted_core_portfolio_assignments_read', 'core.v_domain_rollout_readiness + core promoted-vs-legacy comparison views', 'migration_20260318'),
  ('project_detail_master', 'cutover_ready_with_compat', TRUE, TRUE, TRUE, 'promoted_core_project_detail_read', 'compareProjectDetailMasterReadiness + core.v_domain_rollout_readiness', 'migration_20260318'),
  ('project_management', 'blocked', FALSE, FALSE, TRUE, 'promoted_project_management_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('project_development', 'blocked', FALSE, FALSE, TRUE, 'promoted_project_development_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('engineering', 'blocked', FALSE, FALSE, TRUE, 'promoted_engineering_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('quality', 'blocked', FALSE, FALSE, TRUE, 'promoted_quality_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('documentation', 'blocked', FALSE, FALSE, TRUE, 'promoted_documentation_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('finance', 'blocked', FALSE, FALSE, TRUE, 'promoted_finance_read', 'core.v_domain_rollout_readiness', 'migration_20260318'),
  ('imports_governance', 'cutover_ready_with_compat', FALSE, FALSE, TRUE, 'imports_governance_enforcement_preview', 'compareImportsGovernanceReadiness + imports.v_source_update_ack_gaps', 'migration_20260318'),
  ('work_item_convergence', 'blocked', FALSE, FALSE, TRUE, 'promoted_core_work_item_summary_read', 'core.v_domain_rollout_readiness + work-item reconciliation diagnostics', 'migration_20260318')
ON CONFLICT (domain) DO UPDATE
SET cutover_state = EXCLUDED.cutover_state,
    promoted_read_primary = EXCLUDED.promoted_read_primary,
    dual_write_enabled = EXCLUDED.dual_write_enabled,
    legacy_fallback_available = EXCLUDED.legacy_fallback_available,
    rollback_flag_key = EXCLUDED.rollback_flag_key,
    readiness_evidence_source = EXCLUDED.readiness_evidence_source,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by;

INSERT INTO app_settings (key, value, updated_by, updated_at)
VALUES
  ('promoted_core_clients_read', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_projects_read', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_portfolios_read', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_portfolio_assignments_read', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_project_detail_read', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_clients_dual_write', 'true', 'cutover_20260318', NOW()),
  ('promoted_core_project_master_dual_write', 'true', 'cutover_20260318', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

CREATE OR REPLACE VIEW core.v_cutover_post_validation AS
SELECT
  s.domain,
  s.cutover_state,
  s.promoted_read_primary,
  s.dual_write_enabled,
  s.legacy_fallback_available,
  s.rollback_flag_key,
  s.readiness_evidence_source,
  COALESCE(r.readiness::text, CASE WHEN s.cutover_state = 'blocked' THEN 'blocked' ELSE 'partial' END) AS readiness,
  COALESCE(r.blocker_count, 0) AS blocker_count,
  COALESCE(r.mismatch_count, 0) AS mismatch_count,
  COALESCE(r.mismatch_categories, ARRAY[]::TEXT[]) AS mismatch_categories,
  COALESCE(r.sample_ids, ARRAY[]::BIGINT[]) AS sample_ids,
  COALESCE(r.blocker_summary, 'no_blocker_summary_available') AS blocker_summary,
  s.updated_at,
  s.updated_by
FROM internal.cutover_domain_state s
LEFT JOIN core.v_domain_rollout_readiness r ON r.domain = s.domain;

COMMENT ON VIEW core.v_cutover_post_validation IS
'Cutover validation artifact: domain cutover state + readiness mismatches + rollback/fallback metadata.';

COMMIT;
