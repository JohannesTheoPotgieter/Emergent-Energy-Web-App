# Decisions Log — Trust-Restoration Tracks

**Owner:** Johannes (COO)
**Repo path:** `docs/active/wave-0/decisions-log.md`
**Purpose:** record interactive decisions made during Phase D / Trust-restoration triage that aren't captured anywhere else. Future agents and audits read this to understand *why* the code is shaped the way it is.

Format per entry: date · phase/track · decision · rationale · code reference · revisit trigger.

---

## 2026-05-08 — T1.x Phase 3 (Reporting Trust)

### D-T1.x-1 — Finance KPI vs-target ramp anchor

**Decision:** Sum of expected-payment-dated lines in current FY (window: `expectedPaymentDate ∈ [fyStart, today]`).
**Alternative considered:** linear `months_elapsed/12 × annual_target`.
**Rationale:** anchors against captured forecasts rather than calendar fiction. If forecasts cluster late-FY, scores will look strong early — that's "no plan to compare against yet," not "we're ahead." Honest.
**Caveat:** back-loaded forecasts produce inflated early-FY scores. This is known behaviour, not a bug. Future work: a captured month-by-month FY budget surface would let scores anchor against an explicit plan curve.
**Code:** PR #859 (`6845f56`).
**Revisit trigger:** when an explicit FY budget surface is built. Or if Finance reports back that early-FY scores are systematically misleading.

### D-T1.x-2 — Finance KPI weight blend (Option B)

**Decision:** Cash 30 / Debtors 25 / Revenue 15 / COS 15 / GM 15 = 100. Cash + Debtors collectively 55/100.
**Alternatives considered:** Option A (status quo: Revenue 25 / Cash 20 / COS 20 / GM 20 / Debtors 15), Option C (heavier on GM).
**Rationale:** day-to-day finance signals (cash availability, debtors aging) needed to drive a majority of the score. COS-derived signals dropped from 65/100 to 45/100. COS visibility preserved, just not dominant.
**Code:** PR #860 (`d2a1277`).
**Revisit trigger:** owner approval required for any future re-weighting.

### D-T1.x-3 — Finding D deferred (debtor labelling)

**Decision:** defer indefinitely.
**Reason:** `fin_overdue_debtors` "inverse_count + R unit" labelling is cosmetic. Math is correct. Renaming the normalization type is feature creep with no operational benefit.
**Revisit trigger:** if a user complains about the label specifically.

### D-T1.x-4 — Finding E deferred (programme-reports snapshotting)

**Decision:** defer until time-travel is needed.
**Reason:** programme reports not being snapshotted is semantic, not a bug. Reports compute live each render. If we need historical "show me what this report said on 2026-04-01," we'd need snapshots — but that requirement isn't surfaced today.
**Revisit trigger:** when a user asks for a historical report view, or audit/compliance requires reproducible monthly snapshots.

### D-T1.x-5 — Wave B + C deferred until Phase 5

**Decision:** Wave A (3 zero-coverage pages) ships now. Wave B (3 mid-stakes pages) and Wave C (5 partial pages) deferred until Phase 5 pilot tells us if they're needed.
**Reason:** trust-signal coverage at 39% across 14 pages is a known gap, but 0/4 pages are the only ones where users have *zero* ability to verify numbers. Wave A closes that. Whether 4/4 is the right bar for the other 11 pages is something the pilot will surface — don't over-build before evidence demands it.
**Code:** Plan v3 Step 3.5 (Wave A active), Step 3.7 / 3.8 (Wave B / C deferred).
**Revisit trigger:** Phase 5 pilot retro flags "I can't tell if this number is fresh" friction on dashboard / pm-monthly-report / engineering-monthly-report or any of the 5 partial pages.

---

## 2026-05-08 — Foundation Phase D (Track B)

### D-B.2-1 — Authoriser matrix is the entity registry, not a parallel file

**Decision:** `shared/permissions/authoriser-matrix.ts` is a thin typed *view* of `ENTITY_REGISTRY[entity].override_roles`, not a parallel source.
**Alternatives considered:** (a) standalone matrix duplicating the data per Plan v3 § 2.4 prescription; (b) literal `decisionKey → roles` map at finer grain than entities.
**Rationale:** by the time Plan v3 § 2.4 was scheduled, `ENTITY_REGISTRY` already carried `override_roles` per entity (1,068 backend call sites already depend on this registry). `requireAuthoriserFor(entity)` already reads from it. Creating a parallel matrix would mean two sources, drift risk, and double the maintenance. The thin re-export gives future agents the file path the v3 plan promised, with a pointer to the canonical source.
**Code:** `shared/permissions/authoriser-matrix.ts` (new, derives from ENTITY_REGISTRY at module-evaluation time); `server/middleware/requireAuthoriserFor.ts:47-69` (unchanged — still reads registry directly).
**Revisit trigger:** if a finer-grained `decisionKey` (e.g., `stage.advance.override` distinct from `stage.exception.override`) becomes necessary because two operations on the same entity have different override authorities. Today they don't — entity grain is sufficient.

---

## How to use this log

- **Adding a decision:** append to the relevant track section (T1, T1.x, T2, T3, foundation Phase D, Phase 6).
- **Each entry is permanent.** Don't delete decisions, even if reversed. Add a follow-up entry referencing the original (e.g., "D-T1.x-2-rev1 — re-weighted per CFO request 2026-08-12, supersedes D-T1.x-2").
- **Future agents must read this** before touching code that implements any logged decision. The decisions are encoded in code; the log captures the *why* the code can't.

---

*This log is the source of truth for non-code decisions. The code is the source of truth for the implementation. The playbook is the source of truth for business rules. AGENT_GUARDRAILS.md is the source of truth for technical rules. They reference each other.*
