# Trust Sprint Status Report — 2026-04-30

## Executive summary (COO)
Overall trust posture is **mixed but improving**. Two areas are currently **Trusted** with explicit automated proof (Finance analysis controls and Smart Import v2/tracker replica contracts). Three areas are **Conditional** because controls exist but unresolved limitations or integration dependencies remain (Engineering/Quality route shadowing, Handover Health Score completeness, and Role-based UX consistency). Two areas are **Unsafe** for executive reliance without caveats (cashflow source-of-truth and Document Management v2), because current evidence shows known governance/synchronisation gaps that can mislead decision-making if treated as fully canonical.

No manual staging/UAT claims are included in this report; statuses below only use repository evidence (tests, route inventory, and active docs).

## Status board

| Area | Status | Evidence | Limitation / risk | Next action | Owner role |
|---|---|---|---|---|---|
| Finance analysis | **Trusted** | `qa/tests/unit/finance-analysis-hardening.test.ts` verifies route registration, role-gated endpoints, tolerance write restrictions, and snapshot `effectiveTo` null guards. | None observed in this sprint evidence set. | Keep guard test mandatory in CI and expand to API response contract test for tolerance updates. | Finance Engineering Lead |
| Smart Import v2 + tracker replica | **Trusted** | `qa/tests/unit/tracker-replica-integration.test.ts` pins merge+hasher+conflict-policy seams and route exposure; `docs/smart-import-v2-progress.md` records planner/route implementation details. | Known operational limitations remain outside core trust contract. | Continue parity checks between conflict engines until consolidation decision is implemented. | Data Platform Lead |
| Engineering/Quality route shadowing | **Conditional** | `docs/qa/app-route-inventory.md` is generated route proof (169 paths); trust-relevant recent commits include engineering/quality stabilisation and handover/quality fixes. | Route inventory proves registration, not end-to-end permission/runtime behavior for every shadow/alias path. | Run targeted route smoke on engineering + quality alias endpoints and attach output artifact in next sprint report. | QA Lead |
| Handover Health Score | **Conditional** | `qa/tests/unit/handover-health-score-surface.test.ts` proves missing-data state, explainability fields, scoped permissions, and control-page alias endpoint usage. | Surface is proven, but score confidence still depends on upstream handover data completeness at runtime. | Add periodic data completeness metric (missing inputs by phase) to handover admin dashboard and alert threshold. | PM Operations Lead |
| Cashflow source-of-truth risk | **Unsafe** | `qa/tests/unit/cashflow-helpers.effective-date.test.ts` proves payment/effective-date precedence logic; `docs/ops-library/finance-report-trust-guide.md` states the BLACK/RED date-colour rule for inflows/outflows (receipt-date for cash inflow, actual-payment-date for cash outflow) per AGENT_GUARDRAILS § 3.4 / § 3.7; historical lineage docs still describe legacy table dependence for cashflow views. | Canonical logic is guarded, but data-path split/legacy dependencies can still produce trust drift if interpreted as single-source canonical everywhere. | Publish explicit “cashflow canonical scope” note in finance pages and complete source-of-truth reconciliation checklist before Trusted status. | Finance Systems Owner |
| Document Management v2 | **Unsafe** | Source-of-truth policy and import docs define governance model (`docs/data-import-and-source-of-truth.md`, `qa/tests/unit/source-of-truth-policy.test.ts`), but no current runbook/test bundle in this sprint proves SharePoint sync-health + document governance closure for v2. | Missing sprint evidence for end-to-end document trust (ingest, sync, permission, and exception handling). | Produce Document Management v2 trust matrix (routes + permissions + sync health + failure modes) with automated checks. | Document Control Lead |
| Role-based UX consistency | **Conditional** | `qa/tests/unit/quality-ui-consistency.test.ts` proves terminology consistency for quality surfaces; role guidance exists in `docs/ops-library/role-guides.md`; route permission surfaces are enumerated in route inventory. | Consistency proof is currently domain-specific (quality), not full role-journey coverage across all trust surfaces. | Add cross-role journey smoke set (COO, PM, Finance, Engineering) for key trust pages and record pass/fail deltas weekly. | Product + QA |

## Evidence ledger used for this sprint

### Tests
- `qa/tests/unit/finance-analysis-hardening.test.ts`
- `qa/tests/unit/tracker-replica-integration.test.ts`
- `qa/tests/unit/handover-health-score-surface.test.ts`
- `qa/tests/unit/cashflow-helpers.effective-date.test.ts`
- `qa/tests/unit/source-of-truth-policy.test.ts`
- `qa/tests/unit/quality-ui-consistency.test.ts`

### Route proof / inventory
- `docs/qa/app-route-inventory.md` (generated 2026-04-30)

### Current docs / QA references
- `docs/smart-import-v2-progress.md`
- `docs/smart-import-v2-known-limitations.md`
- `docs/smart-import-v2-engine-consolidation-assessment.md`
- `docs/ops-library/finance-report-trust-guide.md`
- `docs/data-import-and-source-of-truth.md`
- `docs/ops-library/lifecycle-handover-sops.md`

### Recent trust-related PR/commit review (for context only)
- `a368233` Finance Analysis bootstrap + QA hardening
- `ada040d` Tracker replica + 3-way merge import
- `2c40600` Smart-import/tracker-replica regression proofs
- `87b585a` Handover health score completeness/explainability
- `aa4db49` Cashflow inflow effective-date resolution guards

## Developer checklist (remaining fixes)
- [ ] Engineering/Quality: run route-smoke artifact specifically for alias/shadow endpoints and attach to next trust report.
- [ ] Handover: ship missing-inputs telemetry card and define escalation threshold.
- [ ] Cashflow: document canonical-vs-legacy boundary directly in finance UX and run reconciliation sign-off.
- [ ] Document Management v2: create dedicated trust matrix and automate sync-failure detection checks.
- [ ] Role UX: add weekly cross-role trust-surface smoke script and baseline diff output.

## Status legend
- **Trusted**: Automated evidence exists for controls and no material unresolved trust caveat in scope.
- **Conditional**: Partial proof exists, but unresolved caveat needs tracked action before executive reliance.
- **Unsafe**: Known trust-risk or missing core proof; use only with explicit caution and remediation owner.
- **Not reviewed**: No current-sprint evidence.
