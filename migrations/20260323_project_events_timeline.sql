CREATE TABLE IF NOT EXISTS project_events (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility JSONB NOT NULL DEFAULT '{"scope":"project"}'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_events_project_id_idempotency_key_uidx
  ON project_events(project_id, idempotency_key);

CREATE INDEX IF NOT EXISTS project_events_project_id_event_timestamp_idx
  ON project_events(project_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS project_events_project_id_event_type_idx
  ON project_events(project_id, event_type);

INSERT INTO project_events (
  project_id,
  event_type,
  event_timestamp,
  actor_user_id,
  actor_role,
  source_entity_type,
  source_entity_id,
  summary,
  details,
  visibility,
  idempotency_key
)
SELECT
  pph.project_id,
  'project.stage_changed',
  pph.changed_at,
  pph.changed_by_user_id,
  u.role,
  'project_phase_history',
  pph.id::text,
  CONCAT('Stage changed from ', COALESCE(pph.old_phase, 'unknown'), ' to ', COALESCE(pph.new_phase, 'unknown')),
  jsonb_build_object(
    'fromPhase', pph.old_phase,
    'toPhase', pph.new_phase,
    'source', 'backfill',
    'backfilled', true,
    'backfillMethod', 'project_phase_history'
  ),
  '{"scope":"project"}'::jsonb,
  CONCAT('backfill:phase:', pph.id)
FROM project_phase_history pph
LEFT JOIN users u ON u.id = pph.changed_by_user_id
WHERE pph.project_id IS NOT NULL
ON CONFLICT (project_id, idempotency_key) DO NOTHING;

INSERT INTO project_events (
  project_id,
  event_type,
  event_timestamp,
  actor_user_id,
  actor_role,
  source_entity_type,
  source_entity_id,
  summary,
  details,
  visibility,
  idempotency_key
)
SELECT
  egl.project_id,
  CASE
    WHEN egl.new_status = 'ENABLED' THEN 'project.gate_passed'
    WHEN egl.new_status = 'NOT_ELIGIBLE' THEN 'project.gate_failed'
    ELSE 'project.gate_changed'
  END,
  egl.changed_at,
  egl.changed_by_user_id,
  egl.changed_by_role,
  'execution_gate_log',
  egl.id::text,
  CONCAT('Execution gate ', COALESCE(egl.new_status, 'updated')),
  jsonb_build_object(
    'previousStatus', egl.previous_status,
    'newStatus', egl.new_status,
    'action', egl.action,
    'reason', egl.reason,
    'source', 'backfill',
    'backfilled', true,
    'backfillMethod', 'execution_gate_log'
  ),
  '{"scope":"project"}'::jsonb,
  CONCAT('backfill:gate:', egl.id)
FROM execution_gate_log egl
WHERE egl.project_id IS NOT NULL
ON CONFLICT (project_id, idempotency_key) DO NOTHING;
