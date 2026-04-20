-- Backfill 05: Approval Lineage
-- Inserts promoted approval rows from public.approvals into documentation.document_approvals
-- Join keys:
--   core.projects cp ON cp.legacy_project_info_id = a.project_id (project_id resolution)
--   documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id
--     AND a.related_entity_type = 'deliverable' (document_id, LEFT JOIN — NULL if not document-scoped)
-- Idempotent via ON CONFLICT (legacy_approval_id) DO NOTHING
-- Must run AFTER: 20260402_approval_type_support.sql, backfill_04 (core.projects must exist)
BEGIN;

INSERT INTO documentation.document_approvals (
  legacy_approval_id,
  document_id,
  approver_user_id,
  status,
  decision_note,
  decided_at,
  created_at,
  approval_type,
  approval_category,
  title,
  project_id,
  related_entity_type,
  related_entity_id,
  requested_by_user_id,
  urgency,
  evidence_links,
  source_table
)
SELECT
  a.id,
  doc.id,
  COALESCE(a.assigned_approver, a.decided_by),
  LOWER(COALESCE(a.status::TEXT, 'pending')),
  a.decision_note,
  a.decided_at,
  a.requested_at,
  a.approval_type,
  a.approval_category,
  a.title,
  cp.id,
  a.related_entity_type,
  a.related_entity_id,
  a.requested_by,
  a.urgency,
  a.evidence_links,
  'public.approvals'
FROM public.approvals a
LEFT JOIN core.projects cp ON cp.legacy_project_info_id = a.project_id
LEFT JOIN documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id
  AND a.related_entity_type = 'deliverable'
WHERE a.deleted_at IS NULL
ON CONFLICT (legacy_approval_id) DO NOTHING;

COMMIT;
