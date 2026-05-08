-- Migration 0057 — transition history tables for self-auditing entities.
--
-- Plan v3 § 2.3 / D.5 (β): four entities (om_handovers,
-- project_stage_exceptions, pending_approvals, qb_link_proposed_cascades)
-- previously self-audited via columns on the entity itself
-- (decidedAt, decidedByUserId, resolutionNote, etc.). The latest state
-- is preserved but transitions are not — if a row is approved → reopened
-- → rejected, only the final rejection survives on the entity.
--
-- Per the COO C.11 decision (canonical, no audit_events dual-write),
-- this migration adds a domain-specific transition history table per
-- entity. The service layer writes a row inside the same transaction
-- as the entity update. Backwards compatible: existing entity reads
-- and writes are unchanged; the history is additive and starts empty
-- (no backfill — going forward only).
--
-- All four tables share the same shape:
--   id              serial PK
--   <entity>_id     integer FK CASCADE → parent
--   from_status     text NULL (initial inserts may not have a prior state)
--   to_status       text NOT NULL
--   changed_by_user_id  integer FK SET NULL → users.id
--   changed_by_role     text
--   changed_at      timestamp NOT NULL DEFAULT now()
--   reason          text NULL (rejection reason / resolution note / similar)
--   details_json    jsonb NULL (per-domain payload)
--
-- Each table has an index on <entity>_id + changed_at DESC for
-- chronological queries on a single entity's history.

-- 1. om_handover_history
CREATE TABLE IF NOT EXISTS om_handover_history (
  id                  serial PRIMARY KEY,
  om_handover_id      integer NOT NULL REFERENCES om_handovers(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text NOT NULL,
  changed_by_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  changed_by_role     text,
  changed_at          timestamp NOT NULL DEFAULT now(),
  reason              text,
  details_json        jsonb
);
CREATE INDEX IF NOT EXISTS om_handover_history_om_handover_id_idx
  ON om_handover_history (om_handover_id, changed_at DESC);

-- 2. project_stage_exception_history
CREATE TABLE IF NOT EXISTS project_stage_exception_history (
  id                  serial PRIMARY KEY,
  exception_id        integer NOT NULL REFERENCES project_stage_exceptions(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text NOT NULL,
  changed_by_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  changed_by_role     text,
  changed_at          timestamp NOT NULL DEFAULT now(),
  reason              text,
  details_json        jsonb
);
CREATE INDEX IF NOT EXISTS pseh_exception_id_idx
  ON project_stage_exception_history (exception_id, changed_at DESC);

-- 3. pending_approval_history
CREATE TABLE IF NOT EXISTS pending_approval_history (
  id                    serial PRIMARY KEY,
  pending_approval_id   integer NOT NULL REFERENCES pending_approvals(id) ON DELETE CASCADE,
  from_status           text,
  to_status             text NOT NULL,
  changed_by_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  changed_by_role       text,
  changed_at            timestamp NOT NULL DEFAULT now(),
  reason                text,
  details_json          jsonb
);
CREATE INDEX IF NOT EXISTS pah_pending_approval_id_idx
  ON pending_approval_history (pending_approval_id, changed_at DESC);

-- 4. qb_link_proposed_cascade_history
CREATE TABLE IF NOT EXISTS qb_link_proposed_cascade_history (
  id                  serial PRIMARY KEY,
  cascade_id          integer NOT NULL REFERENCES qb_link_proposed_cascades(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text NOT NULL,
  changed_by_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  changed_by_role     text,
  changed_at          timestamp NOT NULL DEFAULT now(),
  reason              text,
  details_json        jsonb
);
CREATE INDEX IF NOT EXISTS qlpch_cascade_id_idx
  ON qb_link_proposed_cascade_history (cascade_id, changed_at DESC);
