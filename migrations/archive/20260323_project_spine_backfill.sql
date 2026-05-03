BEGIN;

CREATE TABLE IF NOT EXISTS project_linkage_review_queue (
  id serial PRIMARY KEY,
  table_name text NOT NULL,
  record_id integer NOT NULL,
  reason text NOT NULL,
  context_json jsonb,
  resolved_at timestamp,
  resolved_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT project_linkage_review_queue_table_record_unique UNIQUE (table_name, record_id)
);

ALTER TABLE qc_item_evidence
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES project_info(id) ON DELETE CASCADE;

-- Deterministic backfill: direct project name link
UPDATE deliverables d
SET project_id = p.id
FROM project_info p
WHERE d.project_id IS NULL
  AND d.project_name = p.project_name;

UPDATE qc_checklist c
SET project_id = p.id
FROM project_info p
WHERE c.project_id IS NULL
  AND c.project_name = p.project_name;

UPDATE normalized_cost_lines c
SET project_id = p.id
FROM project_info p
WHERE c.project_id IS NULL
  AND c.project_name = p.project_name;

UPDATE normalized_revenue_lines r
SET project_id = p.id
FROM project_info p
WHERE r.project_id IS NULL
  AND r.project_name = p.project_name;

UPDATE normalized_execution_phases ep
SET project_id = p.id
FROM project_info p
WHERE ep.project_id IS NULL
  AND ep.project_name = p.project_name;

-- Deterministic backfill: approvals linked entity lookup
UPDATE approvals a
SET project_id = wi.project_id
FROM work_items wi
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'work_item'
  AND a.related_entity_id = wi.id
  AND wi.project_id IS NOT NULL;

UPDATE approvals a
SET project_id = ci.project_id
FROM commissioning_items ci
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'commissioning_item'
  AND a.related_entity_id = ci.id;

UPDATE approvals a
SET project_id = cr.project_id
FROM change_requests cr
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'change_request'
  AND a.related_entity_id = cr.id;

UPDATE approvals a
SET project_id = pi.project_id
FROM procurement_items pi
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'procurement_item'
  AND a.related_entity_id = pi.id;

UPDATE approvals a
SET project_id = ic.project_id
FROM invoice_captures ic
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'invoice_capture'
  AND a.related_entity_id = ic.id;

UPDATE approvals a
SET project_id = d.project_id
FROM deliverables d
WHERE a.project_id IS NULL
  AND a.related_entity_type = 'deliverable'
  AND a.related_entity_id = d.id
  AND d.project_id IS NOT NULL;

-- Deterministic backfill: evidence inherits project from checklist
UPDATE qc_item_evidence e
SET project_id = c.project_id
FROM qc_item_instance i
JOIN qc_checklist c ON c.id = i.checklist_id
WHERE e.project_id IS NULL
  AND e.item_instance_id = i.id
  AND c.project_id IS NOT NULL;

-- Queue unresolved rows for manual admin review (idempotent upsert)
INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'work_items', w.id, 'Unable to infer project_id deterministically',
       jsonb_build_object('title', w.title, 'legacy_table', w.legacy_table, 'legacy_id', w.legacy_id)
FROM work_items w
WHERE w.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'approvals', a.id, 'Unable to infer project_id from related entity',
       jsonb_build_object('related_entity_type', a.related_entity_type, 'related_entity_id', a.related_entity_id, 'title', a.title)
FROM approvals a
WHERE a.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'deliverables', d.id, 'Unable to infer project_id from project_name',
       jsonb_build_object('project_name', d.project_name, 'title', d.title)
FROM deliverables d
WHERE d.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'qc_checklist', c.id, 'Unable to infer project_id from project_name',
       jsonb_build_object('project_name', c.project_name)
FROM qc_checklist c
WHERE c.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'qc_item_evidence', e.id, 'Unable to infer project_id via checklist chain',
       jsonb_build_object('item_instance_id', e.item_instance_id)
FROM qc_item_evidence e
WHERE e.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'normalized_cost_lines', c.id, 'Unable to infer project_id from project_name',
       jsonb_build_object('project_name', c.project_name, 'description', c.description)
FROM normalized_cost_lines c
WHERE c.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'normalized_revenue_lines', r.id, 'Unable to infer project_id from project_name',
       jsonb_build_object('project_name', r.project_name, 'milestone_name', r.milestone_name)
FROM normalized_revenue_lines r
WHERE r.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

INSERT INTO project_linkage_review_queue (table_name, record_id, reason, context_json)
SELECT 'normalized_execution_phases', ep.id, 'Unable to infer project_id from project_name',
       jsonb_build_object('project_name', ep.project_name, 'phase_name', ep.phase_name)
FROM normalized_execution_phases ep
WHERE ep.project_id IS NULL
ON CONFLICT (table_name, record_id) DO UPDATE
SET reason = EXCLUDED.reason,
    context_json = EXCLUDED.context_json,
    resolved_at = NULL,
    resolved_by_user_id = NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items (project_id);
CREATE INDEX IF NOT EXISTS idx_approvals_project_id ON approvals (project_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_project_id ON deliverables (project_id);
CREATE INDEX IF NOT EXISTS idx_qc_checklist_project_id ON qc_checklist (project_id);
CREATE INDEX IF NOT EXISTS idx_qc_item_evidence_project_id ON qc_item_evidence (project_id);
CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project_id ON normalized_cost_lines (project_id);
CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_project_id ON normalized_revenue_lines (project_id);
CREATE INDEX IF NOT EXISTS idx_normalized_execution_phases_project_id ON normalized_execution_phases (project_id);
CREATE INDEX IF NOT EXISTS idx_project_linkage_review_queue_table_record ON project_linkage_review_queue (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_project_linkage_review_queue_resolved_at ON project_linkage_review_queue (resolved_at);

DO $$
DECLARE
  unresolved_count integer;
BEGIN
  SELECT COUNT(*) INTO unresolved_count FROM work_items WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE work_items ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM approvals WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE approvals ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM deliverables WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE deliverables ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM qc_checklist WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE qc_checklist ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM qc_item_evidence WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE qc_item_evidence ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM normalized_cost_lines WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE normalized_cost_lines ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM normalized_revenue_lines WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE normalized_revenue_lines ALTER COLUMN project_id SET NOT NULL;
  END IF;

  SELECT COUNT(*) INTO unresolved_count FROM normalized_execution_phases WHERE project_id IS NULL;
  IF unresolved_count = 0 THEN
    ALTER TABLE normalized_execution_phases ALTER COLUMN project_id SET NOT NULL;
  END IF;
END
$$;

COMMIT;
