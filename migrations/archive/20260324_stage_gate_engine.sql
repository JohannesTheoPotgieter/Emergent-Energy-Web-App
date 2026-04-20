CREATE TABLE IF NOT EXISTS stage_gate_definitions (
  id SERIAL PRIMARY KEY,
  gate_name TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  target_stage TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_key TEXT NOT NULL,
  requirement_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stage_gate_definitions_stage_idx
  ON stage_gate_definitions(from_stage, target_stage, is_active, sort_order);

CREATE TABLE IF NOT EXISTS stage_gate_overrides (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  target_stage TEXT NOT NULL,
  override_reason TEXT NOT NULL,
  overridden_by INTEGER REFERENCES users(id),
  overridden_by_role TEXT NOT NULL,
  note TEXT,
  expires_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stage_gate_overrides_lookup_idx
  ON stage_gate_overrides(project_id, gate_name, target_stage, is_active, expires_at);

CREATE TABLE IF NOT EXISTS project_gate_evaluations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  from_stage TEXT,
  target_stage TEXT NOT NULL,
  status TEXT NOT NULL,
  missing_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_id INTEGER,
  evaluated_by_user_id INTEGER REFERENCES users(id),
  evaluated_by_role TEXT,
  evaluated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_gate_evaluations_project_stage_idx
  ON project_gate_evaluations(project_id, target_stage, evaluated_at DESC);

-- baseline gates (idempotent inserts)
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:First Assessment->Cost Proposal', 'First Assessment', 'Cost Proposal', 'required_field', 'pd', '{"field":"pd","label":"Project Developer"}'::jsonb, 10
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:First Assessment->Cost Proposal' AND requirement_key = 'pd'
);

INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:Planning->Construction', 'Planning', 'Construction', 'required_commercial_control', 'signed_controls', '{}'::jsonb, 10
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:Planning->Construction' AND requirement_key = 'signed_controls'
);

INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:Planning->Construction', 'Planning', 'Construction', 'required_document', 'construction_pack', '{}'::jsonb, 20
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:Planning->Construction' AND requirement_key = 'construction_pack'
);

INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:Construction->QA', 'Construction', 'QA', 'required_milestone_state', 'construction_milestone_complete', '{"status":"Complete"}'::jsonb, 10
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:Construction->QA' AND requirement_key = 'construction_milestone_complete'
);

INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:QA->Handover', 'QA', 'Handover', 'required_approval', 'quality_signoff', '{"approvalCategory":"QUALITY_SIGNOFF"}'::jsonb, 10
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:QA->Handover' AND requirement_key = 'quality_signoff'
);

INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, sort_order)
SELECT 'gate:Handover->Compliance Handover', 'Handover', 'Compliance Handover', 'required_role_signoff', 'operations_signoff', '{"role":"PROGRAM_MANAGER","approvalCategory":"OPERATIONS_SIGNOFF"}'::jsonb, 10
WHERE NOT EXISTS (
  SELECT 1 FROM stage_gate_definitions WHERE gate_name = 'gate:Handover->Compliance Handover' AND requirement_key = 'operations_signoff'
);
