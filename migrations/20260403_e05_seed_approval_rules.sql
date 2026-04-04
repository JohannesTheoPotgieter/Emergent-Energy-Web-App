-- Seed: 20260403_e05_seed_approval_rules.sql
-- Phase E.5: Seed core.approval_rules with known business approval patterns.
-- These are the approval rules currently hardcoded across the application.
-- Admin can manage (enable/disable/modify) via settings.
-- Idempotent: ON CONFLICT DO NOTHING on (entity_type, approval_type) pairs.
-- Must run AFTER: 20260403_e04_create_approval_rules_instances.sql
BEGIN;

-- Add unique constraint for idempotent seeding
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_rules_entity_approval_type
  ON core.approval_rules (entity_type, approval_type)
  WHERE required_role IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_rules_entity_approval_type_role
  ON core.approval_rules (entity_type, approval_type, required_role)
  WHERE required_role IS NOT NULL;

INSERT INTO core.approval_rules (entity_type, approval_type, required_role, is_mandatory, escalation_days, rule_data)
VALUES
  -- Gate approvals: project manager must approve gate transitions
  ('gate', 'gate', 'project_manager', true, 5,
    '{"description": "Gate transition requires project manager approval"}'::jsonb),

  -- Budget approvals: finance manager must approve budget changes
  ('budget', 'budget', 'finance_manager', true, 3,
    '{"description": "Budget changes require finance manager approval"}'::jsonb),

  -- Handover approvals: both PD and PM must sign off
  ('handover', 'handover', 'project_developer', true, 5,
    '{"description": "PD must sign off on handover pack"}'::jsonb),
  ('handover', 'handover_pack', 'project_manager', true, 5,
    '{"description": "PM must accept handover pack"}'::jsonb),

  -- Variation order / change request approvals
  ('change_request', 'vo', 'project_manager', true, 5,
    '{"description": "Variation orders require PM approval"}'::jsonb),

  -- Procurement approvals
  ('procurement', 'procurement', 'procurement_manager', true, 3,
    '{"description": "Procurement actions require procurement manager sign-off"}'::jsonb),

  -- Exception approvals: senior management must approve gate exceptions
  ('gate_exception', 'exception', 'senior_manager', true, 3,
    '{"description": "Gate exceptions require senior management approval"}'::jsonb),

  -- HSE incident approvals
  ('hse', 'hse_incident', 'hse_manager', true, 1,
    '{"description": "HSE incidents require HSE manager review"}'::jsonb),
  ('hse', 'hse_corrective_action', 'hse_manager', true, 3,
    '{"description": "HSE corrective actions require HSE manager sign-off"}'::jsonb),

  -- Quality approvals
  ('quality', 'quality_ncr', 'quality_manager', true, 3,
    '{"description": "Non-conformance reports require quality manager approval"}'::jsonb),
  ('quality', 'quality_inspection', 'quality_manager', true, 3,
    '{"description": "Quality inspections require quality manager sign-off"}'::jsonb),

  -- Contract approvals
  ('contract', 'contract', 'contracts_manager', true, 5,
    '{"description": "Contract changes require contracts manager approval"}'::jsonb),

  -- SSEG approvals
  ('sseg', 'sseg_application', 'project_manager', true, 5,
    '{"description": "SSEG applications require PM approval"}'::jsonb),
  ('sseg', 'sseg_document', 'project_manager', true, 5,
    '{"description": "SSEG documents require PM approval"}'::jsonb),

  -- General / catch-all approvals
  ('general', 'general', NULL, false, 7,
    '{"description": "General approvals — default non-mandatory rule"}'::jsonb)

ON CONFLICT DO NOTHING;

COMMIT;
