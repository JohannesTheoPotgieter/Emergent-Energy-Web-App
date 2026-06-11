# Emergent OS Functional Additions — Prioritised Build Plan (2026-04-14)

## Scope and safety posture
- This plan is based on current repository state verification, not prior assumptions.
- No production data mutation is proposed in this document.
- All recommended future implementation is additive, idempotent, and reversible by feature flag / route gating where possible.

## Baseline verification (what exists today)

### Confirmed strengths already present
- Pipedrive integration exists as **read-only sync** with admin-triggered/manual operation and optional token configuration. There is no hard commercial gate that blocks project creation or release on missing/invalid CRM state.
- Stage lifecycle and gate framework exists, but the current direction is explicitly **non-blocking** (audit-first), with admin override posture and soft transitions.
- PD→PM handover workflow exists (including V2 feature flag scaffolding), with PM review and handover control surfaces.
- Procurement and construction surfaces exist, but construction explicitly declares missing contract fields rather than faking them.
- Commissioning dashboard exists and is workbook-driven; it also includes runtime schema self-heal patterns for missing commissioning tables.
- O&M / Matriarch handover tracking exists, but explicitly excludes deep external Matriarch integration and related richer acceptance controls.
- Exception and approvals surfaces exist (including unified approvals queue and inbox pages), but they are fragmented between pages and contexts.

### Drift / compatibility observations (dev vs prod risk hypotheses)
Because this repository snapshot does not include live prod DB credentials here, this is a **code-level drift risk scan** rather than a direct environment diff:
1. **Schema migration vs runtime auto-create drift risk**
   - Commissioning tables are both migration-backed and runtime-created (`CREATE TABLE IF NOT EXISTS` in route boot path).
   - Risk: prod/dev can both work while still drifting on exact column/index shape if migrations are skipped.
2. **Route registration split risk**
   - Mixed route registration conventions (legacy shell + domain routers + orchestrator) can hide path ownership drift between environments.
3. **Feature-flag drift risk**
   - PD→PM handover V2 is behind a feature flag default-off; behavior can diverge materially by environment.
4. **Permission override drift risk**
   - RBAC model permits override layers; environment-specific role JSON/user overrides can produce process variance.
5. **Environment assumption drift**
   - Pipedrive / SharePoint are optional by configuration; operational workflow behavior varies sharply when tokens/config are absent.

---

## Prioritised additions worth building (operating-system value only)

## A. Safe tonight (high value, low blast radius)

### 1) One domain-based approvals inbox (unified action queue)
- **Business problem solved:** Approval requests are distributed across My Work, PM approvals, and workflow-specific contexts; approvers lose cycle time switching contexts.
- **Department impact:** PM, Finance, Quality, Procurement, COO.
- **Quick win or deeper build:** **Quick win** (aggregate existing approval sources first).
- **Classification:** **Process + tools**.
- **Risk if not implemented:** SLA misses, hidden blockers, late approvals causing execution delays.
- **Risk if implemented badly:** Duplicate or conflicting actions on the same approval entity.
- **Dependencies:** existing approvals APIs, permission checks, notification model.
- **Recommended sequencing:** **#1**.

### 2) Override and exception governance workflow
- **Business problem solved:** Exceptions and overrides exist, but governance consistency (reason quality, expiry, compensating controls, closure evidence) is uneven.
- **Department impact:** COO/EXCO, PM, Finance, Quality, HSE.
- **Quick win or deeper build:** **Quick-to-medium** (start with policy envelope + mandatory metadata).
- **Classification:** **Governance**.
- **Risk if not implemented:** Silent policy erosion, weak auditability, recurring “temporary” exceptions.
- **Risk if implemented badly:** Excessive bureaucracy that slows critical recovery decisions.
- **Dependencies:** stage exceptions, approvals, audit log/event model.
- **Recommended sequencing:** **#2**.

### 3) Report and source-of-truth trust surfaces
- **Business problem solved:** Users can see values but not always confidence lineage (source, freshness, override presence, last reconciliation).
- **Department impact:** All departments, especially Finance and COO.
- **Quick win or deeper build:** **Quick win** for confidence badges + “why this number” drilldown.
- **Classification:** **Tools + governance**.
- **Risk if not implemented:** Confidence decay and spreadsheet reversion.
- **Risk if implemented badly:** False confidence indicators that mask unresolved drift.
- **Dependencies:** import metadata, override metadata, integration health signals.
- **Recommended sequencing:** **#3**.

### 4) Role-specific daily workspace for Construction Manager
- **Business problem solved:** Construction view is strong at portfolio oversight but lacks a role-tuned daily operating cockpit tied to missing-field guardrails and immediate actions.
- **Department impact:** Construction management, PMO, Quality.
- **Quick win or deeper build:** **Quick-to-medium** (compose from existing cards/actions).
- **Classification:** **People + tools**.
- **Risk if not implemented:** Construction manager works from generic dashboards and side channels.
- **Risk if implemented badly:** Another dashboard layer without action closure.
- **Dependencies:** execution dashboard data, tasks, approvals, exceptions.
- **Recommended sequencing:** **#4**.

## B. Needs approval (cross-domain process hardening)

### 5) Hard commercial release gate from Pipedrive
- **Business problem solved:** Projects can be created/released without guaranteed commercial truth alignment to CRM opportunity state.
- **Department impact:** Commercial, PD, PMO, Finance.
- **Quick win or deeper build:** **Deeper build** (policy + fallbacks + outage handling).
- **Classification:** **Governance + process**.
- **Risk if not implemented:** Pipeline-to-delivery misalignment, ghost/duplicate projects, revenue attribution confusion.
- **Risk if implemented badly:** Production stoppage during CRM outages or token misconfiguration.
- **Dependencies:** pipedrive sync health, opportunity linkage, resilient grace policy, explicit override path.
- **Recommended sequencing:** **#5** after unified approvals/exceptions governance exists.

### 6) Hard PD → PM → Execution release chain
- **Business problem solved:** Existing chain is operationally present but still soft in places; release to execution can proceed under partial readiness.
- **Department impact:** PD, PM, Engineering, Finance, Quality, HSE.
- **Quick win or deeper build:** **Deeper build** (must preserve emergency override with full traceability).
- **Classification:** **Process + governance**.
- **Risk if not implemented:** Premature mobilization, rework, cross-functional disputes over readiness.
- **Risk if implemented badly:** Deadlock and project latency from rigid gating with no controlled exception path.
- **Dependencies:** stage readiness model, handover V2, exception governance workflow.
- **Recommended sequencing:** **#6**.

### 7) Commissioning readiness workflow (not just dashboarding)
- **Business problem solved:** Commissioning data exists but readiness-to-go-live is not yet enforced as a formal, auditable release workflow.
- **Department impact:** Quality, Engineering, PM, O&M stakeholders.
- **Quick win or deeper build:** **Deeper build**.
- **Classification:** **Process + tools + governance**.
- **Risk if not implemented:** Energisation/readiness decisions remain opaque and person-dependent.
- **Risk if implemented badly:** Checklist theater without evidence quality checks.
- **Dependencies:** commissioning snapshots, quality status, approval chain, evidence links.
- **Recommended sequencing:** **#7**.

### 8) Matriarch acceptance workflow (formal acceptance with reservations handling)
- **Business problem solved:** Matriarch handover tracking exists, but formal acceptance/reservations/rejection loops and SLA escalation are not fully modeled as a first-class workflow.
- **Department impact:** O&M (Matriarch), PM, Quality, Compliance.
- **Quick win or deeper build:** **Deeper build**.
- **Classification:** **Process + governance**.
- **Risk if not implemented:** Ambiguous handover completion, unclear liability and unresolved defects post-transfer.
- **Risk if implemented badly:** Premature “accepted” status without closed reservations.
- **Dependencies:** om_handover records, checklist evidence, exception governance, approval inbox integration.
- **Recommended sequencing:** **#8**.

### 9) Procurement control workspace (true control, not monitoring-only)
> **PARKED / SUPERSEDED (2026-05-07).** Procure-to-pay (PR→PO→delivery→invoice, payment, proof,
> subcontractor) is **deferred / out of scope for finance Done** — see
> `docs/finance-source-of-truth-audit.md` Part I § D and `docs/AGENT_GUARDRAILS.md` § 3B S4. The
> **no-PO red flag is RETIRED** (do not re-add); the line below is kept for historical context only.
- **Business problem solved:** Current procurement surfaces are informative; stronger controls are needed around PR→PO→delivery→invoice linkage and no-PO red-flag enforcement.
- **Department impact:** Procurement, Finance, PM, Commercial.
- **Quick win or deeper build:** **Deeper build** (phased).
- **Classification:** **Process + tools + governance**.
- **Risk if not implemented:** Off-contract spend, invoice leakage, weak audit traceability.
- **Risk if implemented badly:** Workflow friction that pushes users back to off-system handling.
- **Dependencies:** procurement items, PO approvals, invoice capture, COS rules.
- **Recommended sequencing:** **#9**.

### 10) Construction control workspace (execution command layer)
- **Business problem solved:** Existing construction page signals constraints but lacks full field-complete, accountable daily control loop (constraints → actions → closure).
- **Department impact:** Construction, PM, Engineering, Quality, HSE.
- **Quick win or deeper build:** **Deeper build**.
- **Classification:** **People + process + tools**.
- **Risk if not implemented:** Persistent blind spots in site execution and handoff readiness.
- **Risk if implemented badly:** Data burden on field teams with low action value.
- **Dependencies:** richer construction contract fields, stage data, approvals/exception hooks.
- **Recommended sequencing:** **#10** (after role-specific daily workspace and trust surfaces).

## C. Later structural cleanup (after above value delivery)
- Consolidate route ownership and registration map to reduce environment drift risk.
- Remove runtime schema self-heal DDL from request paths once migration discipline is proven across dev/prod.
- Normalize approval and exception entity contracts so inbox/action APIs are domain-agnostic.
- Tighten stage-gate semantics to configurable hard/soft by transition type, not globally soft.

---

## Sequencing summary (recommended order)
1. One domain-based approvals inbox
2. Override and exception governance workflow
3. Report/source-of-truth trust surfaces
4. Role-specific daily workspace for Construction Manager
5. Hard commercial release gate from Pipedrive
6. Hard PD→PM→Execution release chain
7. Commissioning readiness workflow
8. Matriarch acceptance workflow
9. Procurement control workspace
10. Construction control workspace

## What deliberately not proposed
- No cosmetic-only dashboards.
- No duplicate workspace that can be composed from existing pages without new control value.
- No destructive schema changes or hard deletes.
- No role-boundary changes that conflict with current business rules.
