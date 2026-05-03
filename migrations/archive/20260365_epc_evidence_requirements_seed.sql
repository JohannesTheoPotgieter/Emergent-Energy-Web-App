-- EPC Workflow Phase 1: Seed evidence requirement definitions
-- These define what evidence is required before workflow actions can proceed.

-- ===================== PO SUBMISSION EVIDENCE =====================

INSERT INTO evidence_requirement_definitions
  (completion_type, source_type, requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent, active)
VALUES
  ('po_submission', 'purchase_order', 'quote_document', 'Supplier Quote Document', 'document', true, 1, 1, NULL, true),
  ('po_submission', 'purchase_order', 'boq_reference', 'BOQ Line Reference', 'linked_record', true, 1, 1, NULL, true),
  ('po_submission', 'purchase_order', 'supplier_details', 'Supplier Details Verified', 'structured_field', true, 1, 1, NULL, true)
ON CONFLICT DO NOTHING;

-- ===================== INVOICE VALIDATION EVIDENCE =====================

INSERT INTO evidence_requirement_definitions
  (completion_type, source_type, requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent, active)
VALUES
  ('invoice_validation', 'invoice_capture', 'approved_po', 'Approved Purchase Order', 'linked_record', true, 1, 1, NULL, true),
  ('invoice_validation', 'invoice_capture', 'delivery_evidence', 'Delivery Note / GRN', 'document', true, 1, 1, NULL, true),
  ('invoice_validation', 'invoice_capture', 'amount_match', 'Amount Matches PO', 'structured_field', true, 1, 1, NULL, true)
ON CONFLICT DO NOTHING;

-- ===================== PAYMENT REQUEST EVIDENCE =====================

INSERT INTO evidence_requirement_definitions
  (completion_type, source_type, requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent, active)
VALUES
  ('payment_request', 'payment_request', 'approved_po', 'Approved Purchase Order', 'linked_record', true, 1, 1, NULL, true),
  ('payment_request', 'payment_request', 'approved_invoice', 'Approved/Verified Invoice', 'linked_record', true, 1, 1, NULL, true),
  ('payment_request', 'payment_request', 'delivery_confirmation', 'Delivery Confirmation', 'document', false, 0.5, 1, NULL, true)
ON CONFLICT DO NOTHING;

-- ===================== PAYMENT CONFIRMATION EVIDENCE =====================

INSERT INTO evidence_requirement_definitions
  (completion_type, source_type, requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent, active)
VALUES
  ('payment_confirmed', 'payment_batch', 'proof_of_payment', 'Proof of Payment Document', 'document', true, 1, 1, NULL, true),
  ('payment_confirmed', 'payment_batch', 'bank_reference', 'Bank Transaction Reference', 'structured_field', true, 1, 1, NULL, true)
ON CONFLICT DO NOTHING;
