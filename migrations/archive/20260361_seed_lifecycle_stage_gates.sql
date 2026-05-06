-- D4: Seed formal lifecycle stage gate rules
-- Uses existing stage_gate_definitions table from the stage gate engine

-- Gate: Handover (PD → PM) — Stage 2→3
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Handover Gate', 'PD_HANDOVER', 'PLANNING', 'required_field', 'signed_status', '{"field":"signedStatus","label":"Contract signed","expected":"SIGNED"}', true, 1),
  ('Handover Gate', 'PD_HANDOVER', 'PLANNING', 'required_linked_record', 'handover_accepted', '{"table":"project_pd_pm_handover","field":"status","expected":"accepted","label":"PD-PM Handover accepted"}', true, 2),
  ('Handover Gate', 'PD_HANDOVER', 'PLANNING', 'required_field', 'client_id', '{"field":"clientId","label":"Client linked"}', true, 3)
ON CONFLICT DO NOTHING;

-- Gate: Mobilisation — Stage 3→4
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Mobilisation Gate', 'PLANNING', 'DESIGN', 'required_linked_record', 'budget_baseline_locked', '{"table":"budget_baselines","field":"change_locked","expected":true,"label":"Budget baseline locked"}', true, 1),
  ('Mobilisation Gate', 'PLANNING', 'DESIGN', 'required_field', 'pm_user_id', '{"field":"pmUserId","label":"PM assigned"}', true, 2),
  ('Mobilisation Gate', 'PLANNING', 'DESIGN', 'required_field', 'engineering_lead_user_id', '{"field":"engineeringLeadUserId","label":"Engineering lead assigned"}', true, 3)
ON CONFLICT DO NOTHING;

-- Gate: Design Complete — Stage 4→5
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Design Complete', 'DESIGN', 'PROCUREMENT', 'required_approval', 'design_review_approved', '{"approvalType":"gate","label":"Design review approved"}', true, 1)
ON CONFLICT DO NOTHING;

-- Gate: Site Start — Stage 5→6
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Site Start', 'PROCUREMENT', 'CONSTRUCTION', 'required_field', 'construction_manager_user_id', '{"field":"constructionManagerUserId","label":"Construction manager assigned"}', true, 1),
  ('Site Start', 'PROCUREMENT', 'CONSTRUCTION', 'required_field', 'site_id', '{"field":"siteId","label":"Site linked"}', true, 2)
ON CONFLICT DO NOTHING;

-- Gate: PC Gate — Stage 6→7
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('PC Gate', 'CONSTRUCTION', 'COMMISSIONING', 'required_field', 'quality_lead_user_id', '{"field":"qualityLeadUserId","label":"Quality lead assigned"}', true, 1)
ON CONFLICT DO NOTHING;

-- Gate: Client Handover — Stage 7→8
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Client Handover', 'COMMISSIONING', 'HANDOVER', 'required_linked_record', 'client_handover_pack', '{"table":"handover_packs","field":"status","expected":"accepted","filter":{"pack_type":"client_handover"},"label":"Client handover pack accepted"}', true, 1)
ON CONFLICT DO NOTHING;

-- Gate: Matriarch Handover — Stage 8→9
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Matriarch Handover', 'HANDOVER', 'O_AND_M', 'required_linked_record', 'matriarch_handover_pack', '{"table":"handover_packs","field":"status","expected":"accepted","filter":{"pack_type":"matriarch_handover"},"label":"Matriarch handover pack accepted"}', true, 1)
ON CONFLICT DO NOTHING;

-- Gate: Final Closeout — Stage 9→10
INSERT INTO stage_gate_definitions (gate_name, from_stage, target_stage, requirement_type, requirement_key, requirement_config, is_required, display_order)
VALUES
  ('Final Closeout', 'O_AND_M', 'CLOSED', 'required_linked_record', 'sseg_complete', '{"table":"sseg_items","label":"All SSEG items complete"}', true, 1)
ON CONFLICT DO NOTHING;
