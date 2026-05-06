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


## Cashflow full-trust reconciliation checklist
Before marking a cashflow view as fully trusted, confirm all of the following:
1. **Payment-date completeness**: all realised inflow/outflow rows have captured payment received/paid dates where funds have actually cleared.
2. **Date precedence integrity**: effective-date hierarchy is unchanged (admin override → payment date → approved tracker overrides/tasks → computed forecast → planned-payment fallback).
3. **Planned-payment fallback exposure**: quantify rows still using planned-payment fallback and publish that count with the report period.
4. **Revenue/COS alignment**: revenue and COS reporting still follow approved tracker logic, including COS realised only when invoice is captured under actuals.
5. **Forecast communication**: every cashflow-facing page states that forecast values remain planning-only until reconciled.
6. **Exception closure**: unresolved date exceptions (missing payment date, no-PO invoice flags, unmatched invoice/payment links) are assigned owners and due dates.

