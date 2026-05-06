-- 0028_pending_approvals.sql
--
-- Introduce a single, app-wide "Pending approval" inbox that intercepts every
-- automatic / scheduled / sync-driven row creation and stages it as a pending
-- proposal until a user explicitly releases (approves) or rejects it.
--
-- Writers in scope (initial wiring; remaining writers follow in separate tasks):
--   * Pipedrive sync             -> opportunities, clients
--   * SharePoint pull            -> intake_requests, project_info shells
--   * COS period auto-lock       -> cos_period_locks
--   * EE info-updates seed       -> ee_info_nodes (+ details, metrics)
--
-- Schema is intentionally generic: `kind` identifies the writer, `payload`
-- carries the full insert payload as JSONB, and `target_table` records the
-- destination so the approval inbox can group / route correctly. When a user
-- approves a row, the matching kind handler in
-- `server/services/pending-approvals-service.ts` replays the original write.
--
-- The partial unique index on (kind, source_ref) WHERE status = 'pending'
-- guarantees that re-running a sync before a user has decided does NOT pile
-- up duplicate pending proposals for the same external record.
--
-- Additive only: no existing table is altered, no PK or column type changes.

BEGIN;

CREATE TABLE IF NOT EXISTS pending_approvals (
  id                  SERIAL PRIMARY KEY,
  kind                TEXT NOT NULL,
  target_table        TEXT NOT NULL,
  summary             TEXT NOT NULL,
  payload             JSONB NOT NULL,
  source_label        TEXT NOT NULL,
  source_ref          TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  decided_at          TIMESTAMP,
  decided_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  applied_record_id   TEXT,
  apply_error         TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_approvals_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'failed'))
);

CREATE INDEX IF NOT EXISTS pending_approvals_status_kind_idx
  ON pending_approvals (status, kind);

CREATE INDEX IF NOT EXISTS pending_approvals_created_at_idx
  ON pending_approvals (created_at DESC);

-- Prevent duplicate pending proposals for the same external record. Once
-- decided (approved/rejected/failed) the constraint releases so the same
-- source_ref can be re-proposed if the upstream system changes.
CREATE UNIQUE INDEX IF NOT EXISTS pending_approvals_kind_source_ref_pending_uniq
  ON pending_approvals (kind, source_ref)
  WHERE status = 'pending' AND source_ref IS NOT NULL;

COMMIT;
