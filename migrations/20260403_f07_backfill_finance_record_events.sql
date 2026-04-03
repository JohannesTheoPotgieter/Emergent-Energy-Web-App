-- Backfill: 20260403_f07_backfill_finance_record_events.sql
-- Phase F.7: Build lifecycle audit trail from existing timestamps.
-- Reconstructs events from:
--   - cost_lines: invoice/approved/paid dates
--   - revenue_lines: invoice/expected_payment/paid dates
--   - purchase_orders: created/sent dates
--   - payment_requests: created/due dates
--   - invoice_captures: invoice_date/created
--   - procurement_items: rfq/quote/delivery dates
-- Idempotent: WHERE NOT EXISTS guards.
-- Must run AFTER: f03, f04, f05 backfills.
BEGIN;

-- -------------------------------------------------------
-- 1. Cost line events: invoice_received, approved, payment_made
-- -------------------------------------------------------

-- Invoice received
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'invoice_received',
  cl.invoice_date_typed,
  jsonb_build_object('invoice_number', cl.invoice_number)
FROM finance.finance_records fr
JOIN finance.cost_lines cl ON cl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'cost_lines'
  AND cl.invoice_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'invoice_received'
  );

-- Approved
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'approved',
  cl.approved_date_typed,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN finance.cost_lines cl ON cl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'cost_lines'
  AND cl.approved_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'approved'
  );

-- Payment made
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'payment_made',
  cl.paid_date_typed,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN finance.cost_lines cl ON cl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'cost_lines'
  AND cl.paid_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'payment_made'
  );

-- -------------------------------------------------------
-- 2. Revenue line events: invoice_raised, payment_expected, payment_received
-- -------------------------------------------------------

-- Invoice raised
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'invoice_raised',
  rl.invoice_date_typed,
  jsonb_build_object('invoice_number', rl.invoice_number)
FROM finance.finance_records fr
JOIN finance.revenue_lines rl ON rl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'revenue_lines'
  AND rl.invoice_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'invoice_raised'
  );

-- Payment expected
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'payment_expected',
  rl.expected_payment_date_typed,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN finance.revenue_lines rl ON rl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'revenue_lines'
  AND rl.expected_payment_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'payment_expected'
  );

-- Payment received
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'payment_received',
  rl.paid_date_typed,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN finance.revenue_lines rl ON rl.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'revenue_lines'
  AND rl.paid_date_typed IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'payment_received'
  );

-- -------------------------------------------------------
-- 3. Purchase order events: po_raised, po_sent
-- -------------------------------------------------------

-- PO raised
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date,
  amount, event_data
)
SELECT
  fr.id,
  'po_raised',
  po.created_at,
  po.total,
  jsonb_build_object('po_number', po.po_number, 'po_ref', po.po_ref)
FROM finance.finance_records fr
JOIN purchase_orders po ON po.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'purchase_orders'
  AND po.created_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'po_raised'
  );

-- PO sent
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'po_sent',
  po.sent_at,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN purchase_orders po ON po.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'purchase_orders'
  AND po.sent_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'po_sent'
  );

-- -------------------------------------------------------
-- 4. Payment request events: payment_requested
-- -------------------------------------------------------
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date,
  amount, event_data
)
SELECT
  fr.id,
  'payment_requested',
  pr.created_at,
  pr.amount,
  jsonb_build_object('due_date', pr.due_date, 'cutoff_date', pr.cutoff_date)
FROM finance.finance_records fr
JOIN payment_requests pr ON pr.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'payment_requests'
  AND pr.created_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'payment_requested'
  );

-- -------------------------------------------------------
-- 5. Invoice capture events: invoice_captured
-- -------------------------------------------------------
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date,
  amount, event_data
)
SELECT
  fr.id,
  'invoice_captured',
  COALESCE(ic.invoice_date, ic.created_at),
  ic.amount,
  jsonb_build_object('invoice_number', ic.invoice_number)
FROM finance.finance_records fr
JOIN invoice_captures ic ON ic.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'invoice_captures'
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'invoice_captured'
  );

-- -------------------------------------------------------
-- 6. Procurement events: rfq_sent, quote_received, delivery_expected, delivery_actual
-- -------------------------------------------------------

-- RFQ sent
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'rfq_sent',
  proc.rfq_sent_date,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN procurement_items proc ON proc.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'procurement_items'
  AND proc.rfq_sent_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'rfq_sent'
  );

-- Quote received
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date,
  amount, event_data
)
SELECT
  fr.id,
  'quote_received',
  proc.quote_received_date,
  proc.quote_amount,
  '{}'::jsonb
FROM finance.finance_records fr
JOIN procurement_items proc ON proc.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'procurement_items'
  AND proc.quote_received_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'quote_received'
  );

-- Delivery received
INSERT INTO finance.finance_record_events (
  finance_record_id, event_type, event_date, event_data
)
SELECT
  fr.id,
  'delivery_received',
  proc.delivery_actual_date,
  jsonb_build_object('delivery_status', proc.delivery_status)
FROM finance.finance_records fr
JOIN procurement_items proc ON proc.id = fr.legacy_entity_id
WHERE fr.legacy_entity_table = 'procurement_items'
  AND proc.delivery_actual_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.finance_record_events fre
    WHERE fre.finance_record_id = fr.id AND fre.event_type = 'delivery_received'
  );

COMMIT;
