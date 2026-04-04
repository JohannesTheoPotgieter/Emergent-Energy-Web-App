-- Backfill: 20260403_f05_backfill_finance_records_po_payments.sql
-- Phase F.5: Populate finance.finance_records from:
--   1. purchase_orders → financial_type='purchase_order', direction='outflow'
--   2. payment_requests → financial_type='payment_request', direction='outflow'
--   3. invoice_captures → financial_type='invoice', direction='outflow'
--   4. procurement_items → financial_type='procurement', direction='outflow'
-- Idempotent: ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING.
-- Must run AFTER: 20260403_f01_create_finance_records.sql
BEGIN;

-- -------------------------------------------------------
-- 0. Safety warnings
-- -------------------------------------------------------
DO $$
DECLARE
  _unmatched_po_projects    INTEGER;
  _unmatched_pr_projects    INTEGER;
  _unmatched_ic_projects    INTEGER;
  _unmatched_proc_projects  INTEGER;
  _unmatched_users          INTEGER;
BEGIN
  SELECT COUNT(*) INTO _unmatched_po_projects
  FROM purchase_orders po
  WHERE po.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = po.project_id
    );
  IF _unmatched_po_projects > 0 THEN
    RAISE WARNING '[Phase F.5 backfill] % purchase_order(s) have a project_id not resolvable to project_instances', _unmatched_po_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_pr_projects
  FROM payment_requests pr
  WHERE pr.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = pr.project_id
    );
  IF _unmatched_pr_projects > 0 THEN
    RAISE WARNING '[Phase F.5 backfill] % payment_request(s) have a project_id not resolvable to project_instances', _unmatched_pr_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_ic_projects
  FROM invoice_captures ic
  WHERE ic.project_id IS NOT NULL
    AND ic.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = ic.project_id
    );
  IF _unmatched_ic_projects > 0 THEN
    RAISE WARNING '[Phase F.5 backfill] % invoice_capture(s) have a project_id not resolvable to project_instances', _unmatched_ic_projects;
  END IF;

  SELECT COUNT(*) INTO _unmatched_proc_projects
  FROM procurement_items pi2
  WHERE pi2.project_id IS NOT NULL
    AND pi2.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.projects p
      JOIN core.project_instances pi ON pi.legacy_project_id = p.id
      WHERE p.legacy_project_info_id = pi2.project_id
    );
  IF _unmatched_proc_projects > 0 THEN
    RAISE WARNING '[Phase F.5 backfill] % procurement_item(s) have a project_id not resolvable to project_instances', _unmatched_proc_projects;
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO _unmatched_users
  FROM (
    SELECT po.created_by AS user_id FROM purchase_orders po WHERE po.created_by IS NOT NULL
    UNION ALL
    SELECT pr.submitted_by_user_id FROM payment_requests pr WHERE pr.submitted_by_user_id IS NOT NULL
    UNION ALL
    SELECT ic.captured_by_user_id FROM invoice_captures ic WHERE ic.captured_by_user_id IS NOT NULL
    UNION ALL
    SELECT proc.requested_by_user_id FROM procurement_items proc WHERE proc.requested_by_user_id IS NOT NULL
  ) all_users
  WHERE NOT EXISTS (
    SELECT 1 FROM core.user_accounts ua WHERE ua.legacy_user_id = all_users.user_id
  );
  IF _unmatched_users > 0 THEN
    RAISE WARNING '[Phase F.5 backfill] % distinct user_id(s) not resolvable to user_accounts', _unmatched_users;
  END IF;
END $$;

-- -------------------------------------------------------
-- 1. Purchase orders
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, vat_amount, status,
  record_data, created_at, updated_at
)
SELECT
  po.id,
  'purchase_orders',
  pi.id,
  'purchase_order',
  'outflow',
  'PO ' || COALESCE(po.po_number, po.po_ref, po.id::TEXT),
  po.subtotal,
  po.vat_amount,
  LOWER(COALESCE(po.status, 'draft')),
  jsonb_build_object(
    'po_ref', po.po_ref,
    'po_number', po.po_number,
    'supplier_name', po.supplier_name,
    'supplier_vat', po.supplier_vat,
    'supplier_address', po.supplier_address,
    'supplier_contact', po.supplier_contact,
    'total', po.total,
    'payment_terms', po.payment_terms,
    'delivery_date', po.delivery_date,
    'delivery_address', po.delivery_address,
    'site_contact', po.site_contact,
    'comments', po.comments,
    'project_manager', po.project_manager,
    'sent_at', po.sent_at,
    'line_items', po.line_items
  ),
  po.created_at,
  po.updated_at
FROM purchase_orders po
LEFT JOIN core.projects p ON p.legacy_project_info_id = po.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 2. Payment requests
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, status,
  record_data, created_at, updated_at
)
SELECT
  pr.id,
  'payment_requests',
  pi.id,
  'payment_request',
  'outflow',
  'Payment Request #' || pr.id,
  pr.amount,
  LOWER(COALESCE(pr.status, 'pending')),
  jsonb_build_object(
    'purchase_order_id', pr.purchase_order_id,
    'invoice_capture_id', pr.invoice_capture_id,
    'counterparty_id', pr.counterparty_id,
    'procurement_item_id', pr.procurement_item_id,
    'due_date', pr.due_date,
    'cutoff_date', pr.cutoff_date,
    'evidence_evaluation_id', pr.evidence_evaluation_id,
    'notes', pr.notes
  ),
  pr.created_at,
  pr.updated_at
FROM payment_requests pr
LEFT JOIN core.projects p ON p.legacy_project_info_id = pr.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 3. Invoice captures
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, vat_amount, status,
  record_data, created_at, updated_at
)
SELECT
  ic.id,
  'invoice_captures',
  pi.id,
  'invoice',
  'outflow',
  'Invoice ' || COALESCE(ic.invoice_number, ic.id::TEXT),
  ic.amount,
  ic.vat_amount,
  LOWER(COALESCE(ic.status, 'pending')),
  jsonb_build_object(
    'invoice_number', ic.invoice_number,
    'invoice_date', ic.invoice_date,
    'linked_po_id', ic.linked_po_id,
    'linked_procurement_item_id', ic.linked_procurement_item_id,
    'document_path', ic.document_path,
    'document_drive_id', ic.document_drive_id,
    'document_item_id', ic.document_item_id,
    'qb_sync_status', ic.qb_sync_status,
    'notes', ic.notes
  ),
  ic.created_at,
  ic.updated_at
FROM invoice_captures ic
LEFT JOIN core.projects p ON p.legacy_project_info_id = ic.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE ic.deleted_at IS NULL
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 4. Procurement items
-- -------------------------------------------------------
INSERT INTO finance.finance_records (
  legacy_entity_id, legacy_entity_table,
  project_instance_id, financial_type, direction,
  title, amount_ex_vat, status,
  record_data, created_at, updated_at
)
SELECT
  proc.id,
  'procurement_items',
  pi.id,
  'procurement',
  'outflow',
  proc.title,
  COALESCE(proc.actual_cost, proc.expected_cost),
  LOWER(COALESCE(proc.status, 'pending')),
  jsonb_build_object(
    'description', proc.description,
    'category', proc.category,
    'quantity', proc.quantity,
    'unit', proc.unit,
    'expected_cost', proc.expected_cost,
    'actual_cost', proc.actual_cost,
    'po_id', proc.po_id,
    'invoice_ref', proc.invoice_ref,
    'linked_invoice_capture_id', proc.linked_invoice_capture_id,
    'budget_line', proc.budget_line,
    'linked_deliverable_id', proc.linked_deliverable_id,
    'linked_milestone', proc.linked_milestone,
    'progress_percent', proc.progress_percent,
    'receipt_ref', proc.receipt_ref,
    'payment_status', proc.payment_status,
    'requisition_status', proc.requisition_status,
    'rfq_sent_date', proc.rfq_sent_date,
    'quote_received_date', proc.quote_received_date,
    'quote_amount', proc.quote_amount,
    'boq_reference', proc.boq_reference,
    'delivery_expected_date', proc.delivery_expected_date,
    'delivery_actual_date', proc.delivery_actual_date,
    'delivery_status', proc.delivery_status,
    'is_long_lead', proc.is_long_lead,
    'notes', proc.notes
  ),
  proc.created_at,
  proc.updated_at
FROM procurement_items proc
LEFT JOIN core.projects p ON p.legacy_project_info_id = proc.project_id
LEFT JOIN core.project_instances pi ON pi.legacy_project_id = p.id
WHERE proc.deleted_at IS NULL
ON CONFLICT (legacy_entity_table, legacy_entity_id) DO NOTHING;

-- -------------------------------------------------------
-- 5. Resolve party_id for POs (supplier_name → parties)
-- -------------------------------------------------------
UPDATE finance.finance_records fr
SET party_id = pa.id
FROM purchase_orders po
JOIN core.parties pa ON LOWER(pa.name_canonical) = LOWER(po.supplier_name)
  AND pa.source_table = 'counterparties'
WHERE fr.legacy_entity_table = 'purchase_orders'
  AND fr.legacy_entity_id = po.id
  AND po.supplier_name IS NOT NULL
  AND fr.party_id IS NULL;

-- -------------------------------------------------------
-- 6. Resolve party_id for payment requests (counterparty_id → parties)
-- -------------------------------------------------------
UPDATE finance.finance_records fr
SET party_id = pa.id
FROM payment_requests pr
JOIN core.parties pa ON pa.legacy_counterparty_id = pr.counterparty_id
WHERE fr.legacy_entity_table = 'payment_requests'
  AND fr.legacy_entity_id = pr.id
  AND pr.counterparty_id IS NOT NULL
  AND fr.party_id IS NULL;

-- -------------------------------------------------------
-- 7. Resolve party_id for invoice captures (supplier_id → parties)
-- -------------------------------------------------------
UPDATE finance.finance_records fr
SET party_id = pa.id
FROM invoice_captures ic
JOIN core.parties pa ON pa.legacy_counterparty_id = ic.supplier_id
WHERE fr.legacy_entity_table = 'invoice_captures'
  AND fr.legacy_entity_id = ic.id
  AND ic.supplier_id IS NOT NULL
  AND fr.party_id IS NULL;

-- -------------------------------------------------------
-- 8. Resolve party_id for procurement (supplier_id → parties)
-- -------------------------------------------------------
UPDATE finance.finance_records fr
SET party_id = pa.id
FROM procurement_items proc
JOIN core.parties pa ON pa.legacy_counterparty_id = proc.supplier_id
WHERE fr.legacy_entity_table = 'procurement_items'
  AND fr.legacy_entity_id = proc.id
  AND proc.supplier_id IS NOT NULL
  AND fr.party_id IS NULL;

COMMIT;
