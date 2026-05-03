-- B7 (audit closeout) — Safety File items
--
-- Per direction from the breakdown discussion:
--   "PD->PM SOP requires Compliance/HSE to start Safety File build within
--    7 days of handover. No `safety_file` table exists."
--
-- This migration creates the safety_file_items table used to track the
-- OHSA-required documents (Letter of Good Standing, Public Liability
-- Insurance, Construction Regulations appointment letters, etc.) per
-- project. The schema companion is shared/schema/hse.ts -> safetyFileItems.
--
-- Permission model (mirrors B3 HSE incidents):
--   - Any authenticated user can create an item.
--   - Any authenticated user can edit descriptive fields.
--   - Only HSE-approving roles (HSE_MANAGER, COO_ADMIN, CEO_ADMIN) can
--     change the compliance_status field.
--
-- Auto-seed: when a PD->PM handover is accepted, server-side code seeds
-- the 12 default OHSA items listed in DEFAULT_SAFETY_FILE_SEED with
-- due_date = acceptedAt + 7 days.
--
-- Rollback: 20260412_safety_file_items_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS safety_file_items (
  id                     serial PRIMARY KEY,
  project_id             integer NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  item_code              text NOT NULL,
  item_name              text NOT NULL,
  category               text NOT NULL DEFAULT 'other',
  required               boolean NOT NULL DEFAULT true,
  due_date               date,
  uploaded_at            timestamptz,
  uploaded_by_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  sharepoint_ref         text,
  compliance_status      text NOT NULL DEFAULT 'pending',
  approved_at            timestamptz,
  approved_by_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  rejected_reason        text,
  notes                  text,
  created_by_user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT chk_safety_file_items_status
    CHECK (compliance_status IN ('pending', 'submitted', 'approved', 'rejected', 'expired', 'not_applicable')),
  CONSTRAINT chk_safety_file_items_category
    CHECK (category IN ('statutory', 'registers', 'appointments', 'method_statements', 'emergency', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_safety_file_items_project
  ON safety_file_items(project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_file_items_due
  ON safety_file_items(due_date)
  WHERE deleted_at IS NULL AND compliance_status NOT IN ('approved', 'not_applicable');

CREATE INDEX IF NOT EXISTS idx_safety_file_items_status
  ON safety_file_items(compliance_status)
  WHERE deleted_at IS NULL;

-- Unique (project_id, item_code) for non-deleted default items so the
-- auto-seed helper can use ON CONFLICT DO NOTHING without worrying
-- about race conditions on handover acceptance.
CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_file_items_project_item_active
  ON safety_file_items(project_id, item_code)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE safety_file_items IS
  'B7: OHSA Safety File items per project. Auto-seeded on PD->PM handover acceptance. Create: any authenticated user. Status change: HSE roles only.';
COMMENT ON COLUMN safety_file_items.item_code IS
  'Machine-readable code. Matches DEFAULT_SAFETY_FILE_SEED in shared/schema/hse.ts for auto-seeded items.';
COMMENT ON COLUMN safety_file_items.compliance_status IS
  'pending | submitted | approved | rejected | expired | not_applicable. Only HSE-approving roles can change this field — see server/departments/safety-file-routes.ts';

COMMIT;
