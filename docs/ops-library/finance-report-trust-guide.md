# Finance and Report Trust Guide (Active)

## Non-negotiable finance rules
*Canonical source: `docs/finance-source-of-truth-audit.md` Part I + `docs/AGENT_GUARDRAILS.md` §§ 3.2 / 3.3 / 3.4 / 3.7 / 3B (SETTLED). The summary below mirrors those rules — if anything drifts, the canonical doc and guardrails win. These rules are locked; do not propose changes.*

- **COS realisation** requires BOTH (a) an invoice captured against the line AND (b) the invoice-date cell colour is BLACK. RED invoice-date = projected, not realised. Capture alone is not enough. (§ 3.2)
- **Revenue recognition** is the category-scoped per-line POC: per cost-actuals line, `perLineRevenue = (Q ÷ X_category) × J_category` (Q = col Q line actual cost; X_category = col X category total; J_category = col J category revenue allocation), summed per line, never pooled across projects. **Recognised on the invoice-raised date (col T)** — the same bucket date as COS. **Never** triggered by receipt/payment date (col W = cashflow only), contract date, or milestone. (§ 3.3)
- **Inflows (cash in)** read the revenue-line payment-receipt-date (col W) with colour: BLACK = received (realised), RED = expected (forecast). (§ 3.4)
- **Outflows (cash out)** read the cost-line actual-payment-date with colour: BLACK = paid (realised), RED = unpaid (forecast). (§ 3.4)
- **Cash ≠ revenue.** Inflow (receipt date, col W) and revenue (per-line POC on invoice-raised date, col T) are different surfaces and must not be conflated in any KPI tile.
- **No-PO flag is RETIRED** (owner direction 2026-05-07): an invoice without a PO is **not** a red flag — do not surface or report it. (§ 3B S2)

## Reporting trust model
- Reports must show data provenance and refresh timestamp.
- Derived metrics must be traceable to base transactional records.
- Exceptions must be surfaced (stale sync, unmatched invoice/payment). *(No-PO is no longer an exception — retired 2026-05-07.)*

## Reconciliation controls
The canonical reconciliation is **tracker-vs-QuickBooks** (Definition of Done GP3): REV & COS at
**invoice level**, GP at **month level**, matched on **invoice number + ex-VAT amount**; QB recon is
**company-level**, with per-project QB only via the invoice+ex-VAT auto-matcher showing match coverage.
1. Tracker-vs-QB invoice/amount match coverage (company-level).
2. Invoice actuals capture status.
3. Payment receipt date integrity.
4. Period lock and restatement audit trail.

*PO ↔ invoice linkage is part of procure-to-pay, which is **parked / out of scope** for finance Done
(§ 3B S4); it is not a finance-trust reconciliation control.*

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
6. **Exception closure**: unresolved date exceptions (missing payment date, unmatched invoice/payment links) are assigned owners and due dates. *(No-PO invoice flags retired 2026-05-07 — not an exception.)*

