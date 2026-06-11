# Finance Source-of-Truth Audit — V2 (Fresh Runtime Re-Run)

> **SUPERSEDED — historical evidence only.** The single canonical source of finance rules is
> `docs/finance-source-of-truth-audit.md` (Part I = locked rules; Part II = consolidated audit
> evidence which folds in this V2). Do not treat this file as a source of finance rules or current
> state; read the canonical doc instead.

**Date:** 2026-06-09 · **Auditor role:** COO_ADMIN (johannes, user id=1) · **Build:** v1.5.0 / Build 260608
**Scope:** Deep UX/UI + runtime audit of the finance surface re-run **fresh** against current live data.
**Prior report:** `docs/finance-source-of-truth-audit.md` (V1, verdict 🔴 RED). This document is **standalone** — every
value is re-measured this pass unless **explicitly labelled "(V1)"**. The single carried-over figure is the in-engine
colour-signal COS reading (flagged inline); it could not be reproduced from raw columns this pass (see §10).
**Constraint honoured:** No code, schema, or migration was changed. The only writes attempted were
**validation-only** U-WRITE probes with deliberately invalid payloads (guaranteed non-persisting); see §8.

---

## VERDICT: 🔴 RED — the finance surface is NOT a trustworthy single source of truth

The same business quantities still render as **multiple irreconcilable values** across pages and endpoints.
Fresh evidence reproduces **11 of 12** V1 defects from live data this pass (the dev DB is unchanged since V1; prod
shows the same defects at larger scale). Every numeric value below is freshly measured **except** the one inline-tagged
"(V1)" colour-signal COS reading. Two surfaces have **changed since V1** — both are noted explicitly below and
neither clears the verdict:

- 🟢 **Improvement:** the reconciliation page now renders without the `ReconStatusChip` crash, and the board is
  **partially linked** (5 green / 2 amber) rather than 100% unlinked — but **31 of 42 still unlinked + 4 unknown**,
  so it remains unusable as a reconciliation source.
- 🔴 **New anomaly:** `/finance/revenue` returns **"Access Denied" even for COO_ADMIN** (the highest role).

**Headline contradictions (all measured live this pass):**
- Company **revenue** renders as **4 different numbers**: R371,364,217 / R479,211,341 / R357,393,120 / R67,315,208.
- Company **realised/​paid COS** renders as **5 different numbers** spanning ~R206M.
- Company **GP margin** renders as **13.99%** on one surface and **67.22%** on another.
- Project **id=19** is **Mondi** in the canonical tables but its finance summary is stamped **"Hungry Lion Citrusdal"**.

---

## 1. METHOD & AUTH (reproducible)

| Step | Result |
|---|---|
| Auth harness | `dev-login → exchange-code → JWT` saved at `.local/.audit_jwt`; `/api/auth/me` Bearer = **200** (johannes, COO_ADMIN). |
| **Auth-contract defect** | Cookie-only request to `/api/auth/me` = **401**; browser app preview redirects to the **login page** (screenshot captured). Authenticated UX requires an injected `Authorization: Bearer` header. 🔴 Critical, blocks all default browser UX. |
| SQL battery | Run on **dev** (`DATABASE_URL`, `public.*`) and **prod** (`CLAUDE_RO_DATABASE_URL`, `claude_views.v_*`). Outputs in `.local/audit-v2/out.dev.txt` / `out.prod.txt`. |
| API battery | 11 finance endpoints called with Bearer, all **HTTP 200**, saved to `.local/audit-v2/api/*.json`. |
| Browser pass | Playwright, Bearer-injected, per-route watchdog; screenshots in `.local/audit-v2/shots/`. |
| Numeric guard | `amount_ex_vat` / `revenue_recognition_amount` are TEXT; all sums use a numeric-regex guard. Active row = `effective_to IS NULL`. |

---

## 2. DEV vs PRODUCTION (prod = larger scale, same defects)

| Metric | DEV (fresh) | PROD (fresh) |
|---|--:|--:|
| Projects total / active | 42 / 42 | 91 / 90 |
| `contract_value = 0` on active | ids {10, 19} | **20** active projects |
| Canonical revenue (Σ active `amount_ex_vat`) | R371,364,217 | R438,676,273 |
| Canonical cost total (Σ active `amount_ex_vat`) | R350,128,099 | R382,538,099 |
| Realised cost (invoice basis) | R267,107,083 | R318,303,576 |
| PRS active rows | 69 | 69 |
| PRS `actual_revenue` (all active) | R479,211,341 | R462,254,854 |
| PRS orphan rows / phantom revenue | 27 / R121,818,221 | **50 / R416,252,384 (~90%)** |
| PRS real-ids revenue | R357,393,120 | R46,002,470 |
| Duplicate active PRS groups | 2 | 1 |
| `cashflow_points` / `finance_revenue_monthly` / `finance_cos_monthly` | 0 / 0 / 0 | 0 / 0 / 0 |

Prod is materially **more orphan-dominated** than dev: ~90% of its PRS-reported revenue comes from rows whose
`project_id` does not match any `project_info.id`.

---

## 3. PART R — V1 DEFECT REGRESSION (all 12 re-tested live)

| # | V1 defect | Fresh live result (2026-06-09) | Verdict |
|---|---|---|---|
| 1 | PRS `project_id` ≠ `project_info.id` | `project_info.id=19` = **Mondi**; `/api/v2/projects/19/finance/summary` `costedSummary.projectName` = **"Hungry Lion Citrusdal"** (R1,292,329) while canonical lines are Mondi-scale (rev R144,482,291). | 🔴 OPEN |
| 2 | Gross profit irreconcilable | +R67,063,066 @13.99% (kpi PRS) / +R45,249,978 @67.22% (headline) / +R45,898,230 (PRS real-ids) / +R22,173,174 (recognition − cost). | 🔴 OPEN |
| 3 | Realised cost: invoice vs colour-signal | **4 live surfaces + 1 historical:** R267,107,083 (invoice) / R202,237,310 (`program/cos cashPaid`) / R120,290,998 (`program/cos totalCosRealised`) / R61,128,689 (`cos-control totalPaid`); plus colour-signal engine reading R66,386,861 **(V1, not re-derived this pass)**. | 🔴 OPEN |
| 4 | Admin KPI inflated by orphan PRS | `revenue_actual` R479,211,341 vs canonical R371,364,217 → **+R107,847,124**. | 🔴 OPEN |
| 5 | `revenue_realised` statuses don't exist | revenue statuses present: only `paid` (252) + `invoiced` (1); registry expects `in_bank`/`realised`. | 🔴 OPEN |
| 6 | cashflow + monthly tables empty | `cashflow_points` / monthly tables = 0 rows (dev **and** prod); kpi `cashflow_revenue`=0, `cashflow_expenditure`=0. | 🔴 OPEN |
| 7 | `tracker_vs_app_drift` source missing | `to_regclass('public.manual_overrides')` = NULL. | 🔴 OPEN |
| 8 | `unmatched_cost_invoices` = all (qb links empty) | `quickbooks_invoice_links` = 0 rows. | 🔴 OPEN |
| 9 | Registry references non-existent columns | cost status col is `cost_line_status`; no `approved` / `status` column. | 🔴 OPEN |
| 10 | Duplicate active PRS rows | id 41 {12 Nourse, Randfontein}, id 42 {Maynard Mall Extension, Red Rocket} — two *different* projects share one PRS id. | 🔴 OPEN |
| 11 | Soft-delete columns non-uniform | `deleted_at` only on normalized_* + qb_links; PRS / cashflow / monthly use `effective_to` only. | 🔴 OPEN |
| 12 | `contract_value=0` on active projects | dev ids {10, 19}; prod **20** active projects. | 🟠 DRIFTED |

**Net: 11 OPEN, 1 DRIFTED, 0 FIXED at the data layer.** Two *UI/runtime* behaviours improved (recon crash gone,
recon partially linked — see §6) but the underlying data defects remain.

---

## 4. PART X — CROSS-SURFACE CONSISTENCY MATRIX (any divergence > R1 = FAIL)

**Company revenue (total):**
| Surface | Rendered | Canonical | Δ | Verdict |
|---|--:|--:|--:|---|
| kpi-traceability `inflow_total_value` (normalized rev lines) | R371,364,217 | R371,364,217 | 0 | 🟢 |
| kpi-traceability `revenue_actual` (PRS all-active) | R479,211,341 | R371,364,217 | **+R107,847,124** | 🔴 |
| PRS real-ids only | R357,393,120 | R371,364,217 | −R13,971,097 | 🔴 |
| `/api/financial-headline` `totalRevenue` (FY-realised, unlabelled) | R67,315,208 | R371,364,217 | −R304M | 🔴 |

→ **4 distinct values.** The *same* kpi-traceability response carries both the correct (`inflow_total_value`)
and the inflated (`revenue_actual`) figure.

**Company COS — "realised / paid":** R267,107,083 (invoice) · R202,237,310 (`program/cos cashPaid`) ·
R120,290,998 (`program/cos totalCosRealised`) · R61,128,689 (`cos-control totalPaid`) → **4 live values, ~R206M
spread** (R267.1M − R61.1M); the in-engine colour-signal reading R66,386,861 **(V1, not re-derived this pass)**
would add a 5th. **FAIL.**

**Company COS — "budget":** R276,069,539 (kpi `cos_budget`) · R274,169,539 (`program/cos totalBudget`) ·
R350,128,099 (canonical cost_total, labelled `cos_actual`) → **3 values.** `program/cos` budget is exactly
**R1,900,000** below kpi-traceability. **FAIL.**

**Company GP & margin:** +R67,063,066 @ **13.99%** (kpi PRS) · +R45,249,978 @ **67.22%** (financial-headline) ·
+R45,898,230 (PRS real-ids) · +R22,173,174 (recognition − cost) → **GP 4 values; margin 13.99% vs 67.22%. FAIL.**

**Per-project identity (id=19):** `project_info.id=19` = **Mondi**; `/api/v2/projects/19/finance` canonical =
Mondi-scale (cost.actual R141,664,627 / rev R144,482,291); `/api/v2/projects/19/finance/summary` `costedSummary`
= **"Hungry Lion Citrusdal"** R1,292,329 → endpoint **mixes two projects. FAIL.**

**App-vs-tracker (`/api/finance/reconciliation`):** real computed deltas (e.g. Coega Steels Ph2
`appVsTrackerDelta` −R12,948,906) but board status = **31 unlinked / 4 unknown / 2 amber / 5 green** (of 42).
Majority unlinked → still not a trusted reconciliation. **FAIL** (improved from "all unlinked" in V1).

**Cash available:** kpi `cashflow_revenue`/`cashflow_expenditure` = **0/0** (cashflow_points empty), yet
`/api/cashflow-tracker` computes `cashflow` = **R21,915,816** (confirmedInflows R371,364,217, confirmedOutflows
R68,914,807) over 174 weeks — and still emits **epoch-zero week dates** (`1899-12-25`, `2022-10-17`).
→ KPI tiles render **0** while the tracker computes ~R21.9M from the same data. **FAIL.**

---

## 5. PART D — CALCULATION RE-DERIVATION (±R1)

| Calc | Surfaced | Re-derived (canonical) | Δ | Verdict |
|---|--:|--:|--:|---|
| Company revenue | R371,364,217 (`inflow_total_value`) | Σ active rev `amount_ex_vat` = R371,364,217 | 0 | 🟢 self |
| Company cost total | R350,128,099 (`cos_actual`) | Σ active cost `amount_ex_vat` = R350,128,099 | 0 | 🟢 self |
| Realised cost (invoice) | R267,107,083 | Σ where `invoice_number` & `invoice_date` set | 0 | 🟢 self / 🔴 vs others |
| Recognition revenue | — | Σ active `revenue_recognition_amount` = R372,301,273 | — | basis for GP below |
| GP (recognition basis) | — | R372,301,273 − R350,128,099 = +R22,173,174 | — | 🔴 vs PRS/headline |
| GP margin (kpi PRS) | 13.99% | 67,063,066 / 479,211,341 | 0 | 🟢 self (inflated rev base) |
| GP margin (headline) | 67.22% | 45,249,978 / 67,315,208 | 0 | 🟢 self (FY-realised base) |
| Cashflow net | R0 (KPI tiles) | rev paid R371,364,217 − cost paid R349,658,124 = R21,706,093 | −R21.7M | 🔴 |

**Conclusion:** every surface is **internally** arithmetically consistent but is built on a **different
revenue / GP / COS base that is never reconciled** → the cross-surface numbers cannot all be correct.
*(Transparency: V1's per-line engine GP of −R126,645,678 derives from an in-process line engine; this pass it
could not be reproduced from raw columns — recognition-basis GP of +R22,173,174 is reported instead.)*

---

## 6. PART P/S — BROWSER EVIDENCE (Bearer-injected; screenshots in `.local/audit-v2/shots/`)

| Route | Renders authenticated? | App console errors | Note |
|---|---|---|---|
| `/finance` | ✅ yes | none (only Vite HMR websocket noise) | renders |
| `/finance/reconciliation` | ✅ yes | none | **`ReconStatusChip` crash from V1 NO LONGER reproduces** 🟢 |
| `/cashflow` | ✅ yes | none | renders |
| `/cos-control` | ✅ yes | none | renders |
| `/finance/revenue` | ❌ **Access Denied** | none | **"You don't have permission to view this page" — for COO_ADMIN** 🔴 new |
| `/finance` (no Bearer / cookie-only) | ❌ login redirect | `/api/auth/me` 401 | auth-contract defect (§1) |

The only console errors observed were `vite-hmr` websocket connection failures — an artifact of the headless
audit harness, **not** application defects. No client-side crashes were seen on the four finance pages that
rendered.

---

## 7. PART RBAC

| Check | Result |
|---|---|
| Positive path (COO_ADMIN) | `GET /api/financial-headline`, `/api/admin/kpi-traceability`, `/api/cos-control/summary` → **200** |
| Unauthenticated | same endpoints with no token → **401** |
| In-UI gate anomaly | `/finance/revenue` returns **Access Denied for COO_ADMIN** (highest role) — permission gate misconfigured or route↔permission mismatch. 🔴 |
| Low-privilege negative path | **Not testable this pass** — only a COO_ADMIN credential is available; provisioning a low-priv user would require a write (disallowed). The `/finance/revenue` denial is, however, direct evidence the permission layer is actively (and here, wrongly) gating even the top role. |

---

## 8. PART U-WRITE — VALIDATION-ONLY (no mutation persisted)

All probes used deliberately invalid/empty payloads so **nothing could be written**; every endpoint rejected
the request at the validation/lookup boundary:

| Method | Endpoint | Payload | Result |
|---|---|---|---|
| POST | `/api/finance/cost-lines` | `{}` | **400** Validation error |
| POST | `/api/finance/revenue-lines` | `{"bogus":true}` | **400** Validation error |
| PATCH | `/api/finance/cost-lines/999999` | `{"amountExVat":"NOT_A_NUMBER"}` | **404** Cost line not found |
| PATCH | `/api/finance/revenue-lines/999999` | `{}` | **404** Revenue line not found |
| POST | `/api/cos-status-override` | `{}` | **400** Missing required fields |
| POST | `/api/finance/revenue-lines/999999/write-off` | `{}` | **400** Validation error |

**Conclusion:** finance write endpoints enforce validation and existence checks before persisting; no audited
mutation was performed. Full reversible mutation on a throwaway project was **not** executed (no safely
revertible test project could be created without a persisting write).

---

## 9. PRIORITISED DEFECT REGISTER v2

| Pri | ID | Defect | Evidence | Status vs V1 |
|---|---|---|---|---|
| P0 | D-IDENTITY | PRS / project-finance summary attributes the wrong project (id=19 Mondi → "Hungry Lion Citrusdal") | §3.1, §4 | OPEN |
| P0 | D-REVENUE | Company revenue renders as 4 values; admin KPI inflated +R107.8M by 27 orphan PRS rows (prod ~90%) | §2, §4 | OPEN |
| P0 | D-GP | GP/margin irreconcilable (13.99% vs 67.22%; 4 GP values) | §4, §5 | OPEN |
| P0 | D-COS | "Realised/paid" COS renders as 5 values, ~R206M spread | §4 | OPEN |
| P0 | D-AUTH | Default (cookie) browser session is unauthenticated → 401 / login redirect | §1, §6 | OPEN |
| P1 | D-CASHFLOW | KPI cashflow tiles = 0 while tracker computes R21.9M; cashflow_points/monthly tables empty; epoch-zero week dates | §4, §3.6 | OPEN |
| P1 | D-RBAC | `/finance/revenue` Access Denied for COO_ADMIN | §6, §7 | NEW |
| P1 | D-RECON | Reconciliation board majority unlinked (31/42) despite real deltas | §4 | IMPROVED (crash fixed, partial links) |
| P1 | D-DUPES | Duplicate active PRS rows; two different projects share one PRS id (41, 42) | §3.10 | OPEN |
| P2 | D-REGISTRY | KPI registry references non-existent statuses/columns/tables (`in_bank`, `realised`, `approved`, `manual_overrides`) | §3.5/7/9 | OPEN |
| P2 | D-QBLINKS | `quickbooks_invoice_links` empty → all cost invoices unmatched | §3.8 | OPEN |
| P2 | D-BUDGET | `program/cos` budget exactly R1.9M below kpi-traceability | §4 | OPEN |
| P2 | D-DQ | `/api/data-quality/scan`: 788 errors / 1,105 warnings / 5,051 total issues | endpoint | OPEN |
| P3 | D-SOFTDELETE | Soft-delete columns non-uniform across finance tables | §3.11 | OPEN |
| P3 | D-CONTRACT0 | `contract_value=0` on active projects (dev 2, prod 20) | §3.12 | DRIFTED |

---

## 10. WHAT WAS NOT POSSIBLE / OUT OF SCOPE (no fabrication)

- **Low-privilege RBAC negative path** — only a COO_ADMIN credential exists; minting a lower role needs a write.
- **Reversible U-WRITE mutation** — no throwaway project could be created without a persisting write; reduced to
  validation-only probes (§8) per the audit's default-to-validation rule.
- **In-engine per-line GP (−R126,645,678)** — produced by an in-process line engine, not reproducible from raw
  columns this pass; recognition-basis GP (+R22,173,174) reported instead.
- **No code, schema, or migration was modified.**

---

## Appendix — reproduction artifacts

- SQL battery template + outputs: `.local/audit-v2/battery.sql.tmpl`, `out.dev.txt`, `out.prod.txt`
- API responses (11, HTTP 200): `.local/audit-v2/api/*.json`
- Browser pass harness + results: `.local/audit-v2/browser-pass.mjs`, `browser-pass.json`, `shots/*.png`
- Auth token (local only): `.local/.audit_jwt`
