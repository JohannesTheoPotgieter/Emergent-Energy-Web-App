# Finance and Report Trust Guide (Active)

## Non-negotiable finance rules
*Canonical source: `docs/AGENT_GUARDRAILS.md` §§ 3.2 / 3.3 / 3.4 / 3.7. The summary below mirrors those rules — if anything drifts, the guardrails win.*

- **COS realisation** requires BOTH (a) an invoice captured against the line AND (b) the invoice-date cell colour is BLACK. RED invoice-date = projected, not realised. Capture alone is not enough. (§ 3.2)
- **Revenue realisation** is derived from realised COS via cost-to-cost ratio: per line, `revenueRealised = (actualCOS / totalCOScosted_project) × totalRevenueCosted_project`. Never triggered by receipt date, invoice date, contract date, or milestone. (§ 3.3)
- **Inflows (cash in)** read the revenue-line payment-receipt-date with colour: BLACK = received (realised), RED = expected (forecast). (§ 3.4)
- **Outflows (cash out)** read the cost-line actual-payment-date with colour: BLACK = paid (realised), RED = unpaid (forecast). (§ 3.4)
- **Cash ≠ revenue.** Inflow (receipt date) and revenue (COS-ratio) are different surfaces and must not be conflated in any KPI tile.
- An invoice without a PO is a red flag and must be visible in reporting.

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
1. **Payment-date completeness**: all realised inflow/outflow rows carry the BLACK-colour payment date (receipt date for inflows, actual-payment date for outflows) per AGENT_GUARDRAILS § 3.4 / § 3.7. RED-coloured dates are forecast and must not be counted as realised.
2. **Date precedence integrity**: effective-date hierarchy is unchanged (admin override → payment date → approved tracker overrides/tasks → computed forecast → planned-payment fallback).
3. **Planned-payment fallback exposure**: quantify rows still using planned-payment fallback and publish that count with the report period.
4. **Revenue/COS alignment**: COS realisation follows the § 3.2 rule (invoice captured + invoice-date BLACK); revenue realisation follows the § 3.3 cost-to-cost COS-ratio formula and is never triggered independently by receipt date or invoice date.
5. **Forecast communication**: every cashflow-facing page states that forecast values remain planning-only until reconciled.
6. **Exception closure**: unresolved date exceptions (missing payment date, no-PO invoice flags, unmatched invoice/payment links) are assigned owners and due dates.

