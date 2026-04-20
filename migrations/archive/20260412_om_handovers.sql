-- B8 (audit closeout) — O&M handover tracker + "close to handover" dashboard
--
-- Per direction from the breakdown discussion:
--   "B8. Please just build out the functionality to track a successful
--    handover and a dashboards close to handover to track progress."
--
-- Scope is deliberately narrow: a tracker + a dashboard. The full O&M
-- module (asset register, Matriarch integration, warranty matrix,
-- monitoring credential vault) is tracked separately and will land in
-- later commits.
--
-- Follow-up directions:
--   - Dashboard window = 30 days
--   - Readiness checklist = 7 items from stage8DataSchema (shared/
--     schema/stage-data.ts) — the existing Stage 8 workspace already
--     uses these exact field names so the two surfaces stay in sync
--   - Mark-complete gated to COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER,
--     CONSTRUCTION_MANAGER
--
-- Rollback: 20260412_om_handovers_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS om_handovers (
  id                              serial PRIMARY KEY,
  project_id                      integer NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  status                          text NOT NULL DEFAULT 'not_scheduled',
  planned_handover_date           date,
  actual_handover_date            date,

  -- Readiness checklist — matches stage8DataSchema.
  as_builts_uploaded              boolean NOT NULL DEFAULT false,
  warranties_uploaded             boolean NOT NULL DEFAULT false,
  om_manual_uploaded              boolean NOT NULL DEFAULT false,
  serial_numbers_uploaded         boolean NOT NULL DEFAULT false,
  targets_confirmed               boolean NOT NULL DEFAULT false,
  monitoring_access_confirmed     boolean NOT NULL DEFAULT false,
  training_complete               boolean NOT NULL DEFAULT false,

  -- Ceremonial hand-off fields
  handed_over_by_user_id          integer REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_user_id             integer REFERENCES users(id) ON DELETE SET NULL,
  accepted_at                     timestamptz,
  handover_pack_link              text,
  notes                           text,

  -- Mark-complete audit
  marked_complete_by_user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  marked_complete_by_role         text,
  marked_complete_at              timestamptz,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  deleted_at                      timestamptz,

  CONSTRAINT chk_om_handovers_status
    CHECK (status IN ('not_scheduled', 'scheduled', 'in_progress', 'completed', 'on_hold'))
);

-- One active O&M handover per project (soft-delete aware).
CREATE UNIQUE INDEX IF NOT EXISTS uq_om_handovers_project_active
  ON om_handovers(project_id)
  WHERE deleted_at IS NULL;

-- Close-to-handover dashboard index: planned-date range + not completed.
CREATE INDEX IF NOT EXISTS idx_om_handovers_planned_date
  ON om_handovers(planned_handover_date)
  WHERE deleted_at IS NULL AND status != 'completed';

CREATE INDEX IF NOT EXISTS idx_om_handovers_status
  ON om_handovers(status)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE om_handovers IS
  'B8: O&M handover tracker. One row per project. Status flows: not_scheduled -> scheduled -> in_progress -> completed | on_hold.';
COMMENT ON COLUMN om_handovers.status IS
  'not_scheduled | scheduled | in_progress | completed | on_hold';
COMMENT ON COLUMN om_handovers.marked_complete_by_user_id IS
  'B8: set by POST /api/om-handovers/:id/mark-complete. Gated to COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER, CONSTRUCTION_MANAGER.';

COMMIT;
