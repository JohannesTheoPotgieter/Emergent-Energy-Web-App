-- Migration: 20260403_f10_backfill_finance_records_change_requests.sql
-- Phase F.10: Backfill change_requests / variation orders into finance.finance_records.
-- Closes the gap where VOs with financial impact were invisible to the unified finance view.
-- Additive only. Idempotent via ON CONFLICT.
BEGIN;

INSERT INTO finance.finance_records (
  legacy_entity_id,
  legacy_entity_table,
  project_instance_id,
  party_id,
  financial_type,
  direction,
  title,
  amount_ex_vat,
  status,
  record_data,
  import_source,
  created_at,
  updated_at
)
SELECT
  cr.id,
  'public.change_requests',
  pi.id,  -- project_instance_id from core.project_instances
  pi.client_party_id,  -- party_id: project's client
  'variation_order',
  CASE
    WHEN cr.cost_impact IS NOT NULL AND cr.cost_impact::numeric < 0 THEN 'inflow'
    ELSE 'outflow'
  END,
  cr.title,
  CASE
    WHEN cr.cost_impact IS NOT NULL AND cr.cost_impact ~ '^-?[0-9]+\.?[0-9]*$'
    THEN cr.cost_impact::numeric
    ELSE NULL
  END,
  cr.status,
  jsonb_build_object(
    'change_type', cr.change_type,
    'cause', cr.cause,
    'client_linked', cr.client_linked,
    'revenue_impact', cr.revenue_impact,
    'cos_impact', cr.cos_impact,
    'margin_impact', cr.margin_impact,
    'impact_summary', cr.impact_summary,
    'evidence_link', cr.evidence_link,
    'backfill_source', 'f10_migration'
  ),
  'backfill_f10',
  cr.created_at,
  COALESCE(cr.updated_at, cr.created_at)
FROM change_requests cr
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = cr.project_id
WHERE cr.deleted_at IS NULL
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE SET
  title = EXCLUDED.title,
  amount_ex_vat = EXCLUDED.amount_ex_vat,
  status = EXCLUDED.status,
  direction = EXCLUDED.direction,
  party_id = COALESCE(EXCLUDED.party_id, finance.finance_records.party_id),
  record_data = EXCLUDED.record_data,
  updated_at = EXCLUDED.updated_at;

-- Create lifecycle events for each backfilled VO
INSERT INTO finance.finance_record_events (
  finance_record_id,
  event_type,
  event_date,
  from_status,
  to_status,
  amount,
  event_data,
  created_at
)
SELECT
  fr.id,
  'backfill_imported',
  COALESCE(cr.updated_at, cr.created_at),
  NULL,
  cr.status,
  fr.amount_ex_vat,
  jsonb_build_object('source', 'f10_backfill', 'change_type', cr.change_type),
  NOW()
FROM finance.finance_records fr
JOIN change_requests cr ON cr.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'public.change_requests'
  AND fr.import_source = 'backfill_f10'
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'backfill_imported'
  );

COMMIT;
