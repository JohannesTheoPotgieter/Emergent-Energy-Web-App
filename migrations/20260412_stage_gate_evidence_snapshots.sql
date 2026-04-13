-- B1 (audit closeout) — Stage Gate Evidence Snapshots
--
-- Per direction from the breakdown discussion:
--   "We dont want the stage gates to block anything we want it to track if
--    we did not capture everything to show why things fail if they do"
--
-- This table is the audit trail for every stage transition. Stage gates
-- never block a transition — they only record what evidence was captured
-- at the moment of transition, so post-mortems can explain WHY something
-- went wrong six months later.
--
-- Companion changes in server/services/stage-lifecycle-service.ts:
--   1. transitionStageStatus() no longer throws when blockers are unmet.
--      Instead it writes a row here and proceeds with the transition.
--   2. advanceToStage() writes one row per stage bulk-advanced, so the
--      "admin skipped to X" path is also captured.
--
-- Rollback: 20260412_stage_gate_evidence_snapshots_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS stage_gate_evidence_snapshots (
  id                     serial PRIMARY KEY,
  project_id             integer NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  from_stage_code        text NOT NULL,
  to_stage_code          text NOT NULL,
  transition_type        text NOT NULL,
  advanced_by_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  advanced_at            timestamptz NOT NULL DEFAULT now(),
  readiness_score        integer NOT NULL,
  gates_total            integer NOT NULL,
  gates_passed           integer NOT NULL,
  gates_missing          integer NOT NULL,
  blockers_satisfied     boolean NOT NULL,
  traffic_light          text NOT NULL,
  requirements_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason                 text,
  notes                  text,

  CONSTRAINT chk_sges_readiness_bounds
    CHECK (readiness_score BETWEEN 0 AND 100),
  CONSTRAINT chk_sges_traffic_light
    CHECK (traffic_light IN ('green', 'amber', 'red')),
  CONSTRAINT chk_sges_transition_type
    CHECK (transition_type IN ('gate_approved', 'gate_progressed', 'admin_advance', 'gate_fail_audit')),
  CONSTRAINT chk_sges_gate_math
    CHECK (gates_passed + gates_missing = gates_total)
);

CREATE INDEX IF NOT EXISTS sges_project_id_idx
  ON stage_gate_evidence_snapshots(project_id);
CREATE INDEX IF NOT EXISTS sges_advanced_at_idx
  ON stage_gate_evidence_snapshots(advanced_at DESC);
CREATE INDEX IF NOT EXISTS sges_from_stage_idx
  ON stage_gate_evidence_snapshots(from_stage_code);
CREATE INDEX IF NOT EXISTS sges_traffic_light_idx
  ON stage_gate_evidence_snapshots(traffic_light);

COMMENT ON TABLE stage_gate_evidence_snapshots IS
  'B1 audit closeout: per-transition snapshot of gate evidence. Audit-only; transitions are never blocked by missing evidence.';
COMMENT ON COLUMN stage_gate_evidence_snapshots.traffic_light IS
  '''green'' when readiness_score=100, ''amber'' when 80..99, ''red'' when <80';

COMMIT;
