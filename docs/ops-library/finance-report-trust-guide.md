# Finance and Report Trust Guide (Active)

## Non-negotiable finance rules
- COS is only realized when an invoice is captured under actuals.
- An invoice without a PO is a red flag and must be visible in reporting.
- Payment receipt date drives revenue realization where defined.

## Reporting trust model
- Reports must show data provenance and refresh timestamp.
- Derived metrics must be traceable to base transactional records.
- Exceptions must be surfaced (missing PO, stale sync, unmatched invoice/payment).

## Reconciliation controls
1. PO ↔ invoice linkage completeness.
2. Invoice actuals capture status.
3. Payment receipt date integrity.
4. Period lock and restatement audit trail.

## Operator actions on trust breaks
- Do not hide invalid data to pass report checks.
- Raise discrepancy ticket with root-cause owner (finance ops vs integration vs data model).
- Annotate uncertainty in reports until corrected at source.
