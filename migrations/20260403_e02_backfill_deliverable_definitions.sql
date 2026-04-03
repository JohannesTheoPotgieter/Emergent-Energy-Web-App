-- Backfill: 20260403_e02_backfill_deliverable_definitions.sql
-- Phase E.2: Populate core.deliverable_definitions from eng_deliverable_templates.
-- Idempotent: ON CONFLICT (legacy_template_id) DO NOTHING.
-- Must run AFTER: 20260403_e01_create_deliverable_definitions.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings: detect unresolvable references
-- -------------------------------------------------------
DO $$
DECLARE
  _orphaned_templates INTEGER;
BEGIN
  SELECT COUNT(*) INTO _orphaned_templates
  FROM eng_deliverable_templates edt
  WHERE NOT EXISTS (
    SELECT 1 FROM eng_stage_templates est WHERE est.id = edt.stage_template_id
  );
  IF _orphaned_templates > 0 THEN
    RAISE WARNING '[Phase E.2 backfill] % deliverable_template(s) reference non-existent stage_template_id; code will be generated without stage context', _orphaned_templates;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Seed from eng_deliverable_templates
-- -------------------------------------------------------
INSERT INTO core.deliverable_definitions (
  legacy_template_id, code, name, description,
  applies_to_scope, is_required, allowed_file_types, required_count,
  is_ad_hoc, created_at
)
SELECT
  edt.id,
  LOWER(REPLACE(REPLACE(TRIM(edt.name), ' ', '_'), '-', '_')) || '_' || edt.id,
  edt.name,
  edt.description,
  'stage',
  COALESCE(edt.is_required, true),
  edt.allowed_file_types,
  COALESCE(edt.required_count, 1),
  false,
  COALESCE(est.created_at, NOW())
FROM eng_deliverable_templates edt
LEFT JOIN eng_stage_templates est ON est.id = edt.stage_template_id
ON CONFLICT (legacy_template_id) DO NOTHING;

COMMIT;
