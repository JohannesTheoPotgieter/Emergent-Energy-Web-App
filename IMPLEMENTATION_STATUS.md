# IMPLEMENTATION_STATUS.md — audit fixes (2026-06-02)

Companion to `IMPORTER_AUDIT.md` and `RECON_FINDINGS.md`. Records what was
implemented from those reports, the owner decisions that shaped each, and what
was deliberately deferred (and why).

**Owner decisions (in-session, COO):**
1. **Realised** = colour-gated for **all** months — remove the past-month auto-promote (red = Committed in every month).
2. **"Planned"** column — keep the all-states calculation, **relabel** so it isn't mistaken for a budget.
3. **Blank invoice date** with an amount = **error** — flag as a blocker and force correction; no EOMONTH(payment) inference.
4. **Rollout** — apply directly (no feature flag).

**Validation in this environment:** `npm run check` (full typecheck) clean;
`npm run test` (unit suite) green (7007 passed / 21 skipped); `npm run db:check`
(schema-drift guard) in sync (additive migration `0081_actuals_invoice_colour`).
**No live DB / data snapshot is available here**, so the *numeric* effect on real
figures — and the new MISSING_INVOICE_DATE blocker and per-child colour on real
workbooks — must still be confirmed on the snapshot (run
`qa/audit/importer-canonical-recon.ts` and compare the COS/Revenue trackers
before/after; run one real import to confirm the blocker volume is sane).

---

## ✅ Implemented (this branch)

| Ref | Change | Files |
|---|---|---|
| **C1** | Past-month auto-promote removed; realisation is colour-gated for all months (invoice + BLACK/confirmed). Red stays Committed in closed months. `isPastMonthAutoRealised` neutralised (single chokepoint); `isEffectivelyRealised`/`isEffectivelyCommitted` simplified; both inline copies in the COS tracker fixed; `classifyBucket` fixed. | `server/lib/finance/cos-realisation.ts`, `server/departments/finance-routes.ts`, `server/repositories/finance-line-level-repository.ts` |
| **H2** | Per-line revenue keeps negative col U (credit notes / reversals) with sign instead of dropping to a POC/zero fallback (`> 0` → `!== 0`). | `server/repositories/finance-line-level-repository.ts` |
| **H3** | Realisation behaviour unified — all surfaces route through the single neutralised promote + canonical gate; no surface auto-promotes. (Structural dedup of the local copies left as tidy-up.) | finance-routes, recognition-bucketing, cos-realisation |
| **Root Cause C** (revenue 1:N) | `listAllActiveCostLines` / `mergeLineLevelCostLines` now carry **each actuals child's own** `revenue_recognition_amount`, so multi-invoice lines recognise each invoice's revenue instead of inheriting the parent's col U N times. | `server/repositories/finance-expense-engine-repository.ts` |
| **Root Cause A** (blank invoice date) | Stopped inferring the recognition month from `EOMONTH(finance payment date)`; an amount-bearing line with no INVOICE RAISED DATE is now a **BLOCKER** (parent + 1:N orphan paths). | `server/lib/import/normalizer.ts` |
| **M2** | Excel lock files (`~$*`) and "conflicted copy" duplicates excluded from import discovery. | `server/sharepoint.ts` |
| **M3** | Resolved as a side effect of C1 — the COS tracker no longer derives a UTC current-month key (revenue tracker already uses SAST). | `server/departments/finance-routes.ts` |
| **Planned relabel** | GP "Budget→Planned→Realised" grid: "Planned …" rows renamed to "… — all states" so they read as a running all-states total, not a budget. With C1 fixed, this total no longer collapses onto Realised for closed months. | `client/src/pages/finance-gp-company.tsx` |
| **M1** (per-child invoice colour) | New nullable columns `invoice_date_font_color` / `invoice_date_confirmed` on `normalized_cost_line_actuals` (additive migration `0081`). Captured per actuals child at import; both read paths classify each invoice on its **own** BLACK/RED signal, falling back to the parent for legacy rows. Multi-invoice lines (one black + one red) now classify per-invoice. Fail-safe: colour-only thread, amounts/grain unchanged. | `shared/schema/finance.ts`, `migrations/0081_*.sql`, `server/lib/import/normalizer.ts`, `server/lib/import/commit-executor.ts`, `server/repositories/finance-expense-engine-repository.ts`, `server/repositories/finance-line-level-repository.ts` |
| Test updates | `recognition-bucketing-unit` updated to the new colour-gated behaviour (past-month red → Committed; added a black past-month case); `finance-line-level-cutover` gains a per-child-colour-override case for M1. | `qa/tests/unit/recognition-bucketing-unit.test.ts`, `qa/tests/unit/finance-line-level-cutover.test.ts` |

**Combined effect on the symptoms:** "Planned mirrors Realised for closed months"
is resolved at the root — C1 means Committed is no longer auto-zeroed, so the
all-states total exceeds Realised whenever red/un-invoiced lines exist; the relabel
removes the budget confusion. Revenue 1:N + credit-note sign recover the YTD
revenue/GP that was being dropped. The blank-date blocker forces correction instead
of silent month-drift.

---

## ⏸️ Deferred (need DB validation or are separate decisions) — not done blind

| Ref | Why deferred | What it needs |
|---|---|---|
| **H1** (distinct **Unrealised** state) | Taxonomy change; partially conflicts with the owner decision to keep "Planned" as the all-states total. Needs design (no-invoice + red + future ⇒ Planned; else Unrealised) and colour on no-invoice lines. | Owner sign-off on the 4-state taxonomy + UI columns. |
| **M4** (portfolio cross-period duplicate-invoice scan) | Within-import duplicate detection already exists; a portfolio-wide cross-period scan needs a new query + a place to surface it. | Reporting surface + DB query, validated on the snapshot. |
| **M5** (cash-out amount source) | Marked **UNKNOWN** in the audit; the COS/Revenue trackers use child `actualTotal` via the merge, but the cashflow-out path needs confirmation against data. | Data confirmation that cash-out sums `actual_total`. |
| **L1 / L3 / L4** | Minor (grey-tint classification edge; fuzzy-header confidence floor; VAT gross/net reconciliation note). | Low priority. |
| **L2** (GP% null vs 0 on REV=0) | Left as `null` — renders as "—", which is arguably clearer than a misleading 0%. | No change (defensible as-is). |

---

## Note — unrelated baselines refreshed to keep CI green

The branch already contained substantial prior work (engineering / documents /
quality, ~100 files) before this session. Two repo-hygiene **ratchet** tests were
failing because that prior work *reduced* debt without refreshing the baselines
(neither relates to the finance changes):

* `qa/fixtures/typescript-any-baseline.json` — `max` refreshed 7085 → 6877.
* `qa/fixtures/mutation-feedback-baseline.json` — removed `DrawingRegisterTab.tsx`
  and `ProjectHandoverTab.tsx` (already fixed upstream on the branch).

Both were updated per the tests' own instructions; disclosed here for transparency.
