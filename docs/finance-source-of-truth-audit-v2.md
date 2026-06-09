# Finance V2 — Deep Runtime / Cross-Surface Audit

**Type:** Report-only runtime audit (V2). No code / schema / migration / data changed. Only writes attempted were rejected-on-purpose validation probes (bad input → 4xx, zero rows written — proven below).
**Builds on:** `docs/finance-source-of-truth-audit.md` (V1, verdict RED).
**Environment:** LIVE dev DB (`helium`/`heliumdb` via `DATABASE_URL`) + RUNNING app (`npm run dev`, port 5000).
**Auth used:** `/api/auth/dev-login` → `/api/auth/exchange-code` → JWT for user `johannes` (id=1, role **COO_ADMIN**). All endpoint values below are what the app returns to a privileged finance user; React Query renders these exact payloads, so the endpoint value **is** the rendered value.
**Date:** 2026-06-09. All money ZAR.

---

## 1. TOP-LINE VERDICT: 🔴 RED — NOT SAFE TO FREEZE FOR 6 MONTHS

**Single blocking reason:** the `project_revenue_summary` (PRS) snapshot that feeds the admin KPI surface, the GP pages, and the per-project finance-detail page is **mis-keyed, orphaned, and duplicated** — so the *same* finance number differs by up to ~R200M across pages, and the **project-detail endpoint serves a different project's financials** (project id=19 "Mondi" returns a costed summary labelled "Hungry Lion Citrusdal"). Every V1 defect re-tested is still **OPEN**. New cross-surface defects were found (COS realised now resolves to **five** different values across pages; revenue to four).

The only finance sub-system that passed cleanly is **input validation** (PART U-WRITE validation probes all reject correctly).

---

## 2. PART R — V1 DEFECT REGRESSION (all 12 re-tested live)

| # | V1 defect | Runtime check run | Live result | Verdict | Current Δ |
|---|---|---|---|---|---|
| 1 | PRS `project_id` ≠ `project_info.id` | SQL: name-match PRS vs project_info per id; live `/api/v2/projects/19/finance/summary` | id=1 PRS="25 Superior Road" vs PI="261 Bree Street" (whole table shifted); **live endpoint** for id=19 ("Mondi") embeds `costedSummary.projectName="Hungry Lion Citrusdal"` | 🔴 OPEN | wrong attribution on all 42 projects |
| 2 | Gross profit irreconcilable | Compare GP across kpi-traceability, financial-headline, per-line (V1) | −R126,645,678 / +R67,063,066 / +R45,249,978 / +R45,898,230 | 🔴 OPEN | 4 values, ~R194M spread |
| 3 | Realised cost: invoice vs colour-signal | SQL invoice-based; `/api/program/cos`; `/api/cos-control/summary` | R267,107,083 / R120,290,998 / R66,386,861(V1) / R61,128,689 | 🔴 OPEN (worse) | now **5** surfaces (Δ up to R206M) |
| 4 | Admin KPI total inflated by orphan PRS | `/api/admin/kpi-traceability` `revenue_actual` vs canonical | R479,211,341 vs R371,364,217 | 🔴 OPEN | **+R107,847,124** |
| 5 | `revenue_realised` statuses don't exist | SQL distinct status on active revenue lines | only `paid`(252) + `invoiced`(1); registry wants `in_bank`/`realised` | 🔴 OPEN | formula → R0 vs R371.4M |
| 6 | cashflow + monthly tables empty | SQL count `cashflow_points`/`finance_*_monthly`; `/api/admin/kpi-traceability` | 0/0/0 rows; `cashflow_revenue`=0, `cashflow_expenditure`=0 | 🔴 OPEN | served R0 vs ~R21.7M |
| 7 | `tracker_vs_app_drift` source table missing | `select to_regclass('public.manual_overrides')` | NULL (table does not exist) | 🔴 OPEN | KPI unresolvable |
| 8 | `unmatched_cost_invoices` = all (qb links empty) | SQL count `quickbooks_invoice_links` | **0 rows** | 🔴 OPEN | 2,737 unmatched |
| 9 | Registry references non-existent columns | SQL: cost status column is `cost_line_status` (no `approved` value) | `paid`/`invoiced`/`planned` only; no `status`/`approved` | 🔴 OPEN | latent mis-map |
| 10 | Duplicate active rows | SQL dup active PRS by project_id | ids **41** {12 Nourse, Randfontein}, **42** {Maynard Mall Ext, Red Rocket} | 🔴 OPEN | 2 dup groups (different projects share one id) |
| 11 | Soft-delete columns non-uniform | `information_schema.columns` across 10 finance tables | `deleted_at` only on normalized_* + qb_links; PRS/cashflow/monthly/category/tracker have `effective_to` only; qb_links has **no** `effective_to` | 🔴 OPEN | latent |
| 12 | `contract_value=0` on active projects | SQL `is_active AND contract_value=0` | now ids **10** (FY 2026 Adhoc), **19** (Mondi) | 🟠 PARTIAL/DRIFTED | set changed from V1 {19,40} |

**Orphan PRS quantified (R1):** 27 active orphan rows → **R121,818,221** phantom actual revenue, R119,209,796 planned, **R21,164,836** phantom profit. PRS restricted to real ids = R357,393,120 rev / R45,898,230 profit. PRS all-active = R479,211,341 rev / R67,063,066 profit.

**Net regression result: 11 OPEN, 1 PARTIAL (drifted), 0 FIXED.** The dev DB is unchanged since V1.

---

## 3. PART X — CROSS-SURFACE CONSISTENCY MATRIX (the headline test)

Each row is the same business number as rendered by different pages/endpoints. **Any divergence > R1 = FAIL.**

### Company revenue (total)
| Surface (endpoint) | Rendered | Canonical | Δ | Verdict |
|---|--:|--:|--:|---|
| normalized_revenue_lines / kpi-traceability `inflow_total_value` | R371,364,217 | R371,364,217 | 0 | 🟢 |
| kpi-traceability `revenue_actual` (PRS all-active) | R479,211,341 | R371,364,217 | **+R107,847,124** | 🔴 |
| PRS real-ids only | R357,393,120 | R371,364,217 | −R13,971,097 | 🔴 |
| `/api/financial-headline` `totalRevenue` (FY realised basis) | R67,315,208 | R371,364,217 | −R304M | 🔴 (different basis, unlabelled) |

→ **4 distinct company-revenue values. FAIL.** The same `/api/admin/kpi-traceability` response simultaneously carries the correct number (`inflow_total_value`) and the inflated one (`revenue_actual`).

### Company COS — "realised / paid"
| Surface | Rendered | Verdict |
|---|--:|---|
| invoice-based (registry `cos_realised`, raw SQL) | R267,107,083 | 🔴 |
| `/api/program/cos` `cashPaid` | R202,237,310 | 🔴 |
| `/api/program/cos` `totalCosRealised` | R120,290,998 | 🔴 |
| canonical colour-signal (V1 in-process) | R66,386,861 | 🔴 |
| `/api/cos-control/summary` `totalPaid` | R61,128,689 | 🔴 |

→ **5 distinct "realised/paid COS" values, spread ~R206M. FAIL.**

### Company COS — "budget"
| Surface | Rendered |
|---|--:|
| kpi-traceability `cos_budget` (budget_total) | R276,069,539 |
| `/api/program/cos` `totalBudget` | R274,169,539 |
| canonical cost_total (amount_ex_vat — labelled `cos_actual`) | R350,128,099 |

→ **3 distinct. FAIL** (note program/cos budget is exactly R1,900,000 below the traceability budget).

### Company GP & margin
| Surface | GP | Margin |
|---|--:|--:|
| per-line (canonical V1) | −R126,645,678 | n/a |
| kpi-traceability `gp_actual` (PRS) | +R67,063,066 | 13.99% |
| PRS real-ids only | +R45,898,230 | — |
| `/api/financial-headline` | +R45,249,978 | **67.22%** |

→ **GP: 4 values spanning ~R194M; margin 13.99% vs 67.22%. FAIL.**

### Per-project identity (project id=19)
| Surface | Project name | Actual revenue |
|---|---|--:|
| `project_info.id=19` | **Mondi** | (contract_value = 0) |
| `/api/v2/projects/19/finance` canonical | Mondi-scale | cost.actual R141,664,627 / rev R144,482,290 |
| `/api/v2/projects/19/finance/summary` `costedSummary` | **Hungry Lion Citrusdal** | R1,292,329 (profit R398,069) |

→ **The project-detail summary endpoint mixes Mondi's canonical totals with a different project's costed summary. FAIL.**

### App-vs-tracker delta (reconciliation board, `/api/finance/reconciliation`)
Top deltas, all `status="unlinked"`: Coega Steels Ph2 **−R12,948,906**, De Drift −R5,960,421, Unitrans Brackenfell −R5,338,344, Upper East Side Hotel −R2,914,605. These are real computed deltas (computedAt 2026-06-08) but every project is "unlinked", so the board cannot assert a trusted reconciliation for any project.

### Cash available this week
`/api/admin/kpi-traceability` `cashflow_revenue`/`cashflow_expenditure` = **0/0**; `/api/cashflow-tracker` returns weeks with **epoch-zero dates** (`1899-12-25`, `2022-10-17`) and near-zero inflows. → cashflow KPI tiles render zeros, not real data. **FAIL.**

---

## 4. PART P — PER-PAGE COVERAGE (endpoint-level)

> **Method limitation (stated honestly):** the app uses MSAL + a JWT held in browser `localStorage`. The screenshot/browser tool available here loads an **unauthenticated** context (confirmed: `/finance` renders the Microsoft sign-in screen, `/api/auth/me` → 401 — see screenshot below), and there is no supported way to inject the JWT into that context. Browser-rendered per-control screenshots and click-through were therefore **not executable** in this environment. Coverage below is at the **data layer the pages consume** (the faithful proxy). Items requiring genuine DOM interaction are marked **NOT EXECUTED (blocked: no authenticated browser)**.

**Screenshot evidence captured:** 1 — `/finance` unauthenticated → MS login screen (proves the auth wall; no further page render possible).

| Page (route) | Primary endpoint(s) | Data-layer result | UI-interaction (click/tab/filter/export) |
|---|---|---|---|
| `/finance` Home | `/api/financial-headline`, `/api/program-dashboard`, `/api/finance/reconciliation` | headline rev R67.3M / GP 67.2% **disagrees** with every other surface | NOT EXECUTED (blocked) |
| `/cos` | `/api/cos-control/summary`, `/api/cos-tracker` | summary paid R61.1M; tracker Sep realisedCOS **−R2,825,916** | NOT EXECUTED |
| `/cashflow` | `/api/cashflow-tracker`, `/api/cashflow-2026` | epoch-zero week dates, zeros | NOT EXECUTED |
| `/revenue-tracker` | `/api/revenue-tracker` | Sep realisedRevenue **−R19,598** (negative); lists "Randfontein" (dup id) | NOT EXECUTED |
| `/finance/gp` + `/gp/company` | `/api/admin/kpi-traceability`, `/api/finance/lines` | GP R67.06M (PRS-based, inflated) | NOT EXECUTED |
| `/finance/reconciliation` | `/api/finance/reconciliation` | all 42 "unlinked"; deltas up to −R12.9M | NOT EXECUTED |
| `/finance/qb-reconciliation` | `/api/finance/qb-recon/summary` | qb_links table **empty** → nothing to reconcile | NOT EXECUTED |
| `/projects/:id/finance` | `/api/v2/projects/:id/finance(/summary)` | wrong-project costedSummary (see X) | NOT EXECUTED |
| `/program/cos` (Program Finance) | `/api/program/cos` | realised R120.3M / cashPaid R202.2M / budget R274.2M | NOT EXECUTED |
| `/payment-request-board` | `/api/payment-requests` | 0 rows | validation tested (PART U) |
| Remaining FINANCE routes (`/finance/close`, `/cos/analysis`, `/cashflow/analysis`, `/fye-revenue-tracking`, `/finance/audit-prep`, `/finance/quickbooks*`, `/invoice-patterns`, `/counterparties`, `/subcontractor-dashboard`, `/po-approval-board`, `/payment-batch-manager`, `/projects/:id/revenue-tracking`, `/expenditure-breakdown`, `/manual-overrides`, `/excel-vs-app`) | various | endpoints exist & auth-gated (`requirePermission`) | NOT EXECUTED (blocked: no authenticated browser) |

---

## 5. PART S — UX STATE COVERAGE

NOT EXECUTED in-browser (same auth-wall blocker). Data-layer observations relevant to states:
- **EMPTY mis-rendered as real R0 (risk):** cashflow tiles return `0` (not an explicit empty state) despite the feeding tables being empty — exactly the "flash of zeros presented as real data" the spec warns about. Needs DOM confirmation.
- **Negative "realised":** revenue-tracker and cos-tracker emit negative realised values for Sep 2025 — a realised measure should never be negative; likely an order-of-operations bug in the monthly bucket.
- **STALE/TRUST badges, LOADING skeletons, ERROR boundaries, LOCKED period cells:** NOT EXECUTED (blocked).

---

## 6. PART RBAC — ROLE-BY-ROLE

**Privileged path (COO_ADMIN):** verified — all finance endpoints return data; admin-only endpoints (`/api/admin/kpi-traceability`, `/api/data-quality/scan`) respond.
**Low-privilege path:** **NOT EXECUTED.** `dev-login` mints a session only for the seeded admin (`johannes`/COO_ADMIN); there is no supported way to obtain a low-privilege session token in this environment, and the screenshot tool is unauthenticated. Live role-by-role rendering (read-only vs edit, 403/redirect) could not be driven.
**Static evidence collected:** every finance route is wrapped in `requireAuth` + `requirePermission(entity, action)` / `requireAdmin`; page-registry assigns `permissionEntity` per route (e.g. `financials`, `cashflow`, `cos`, `revenue_tracker`, `procurement`, `excel_vs_app`). COS override (`/api/cos-status-override`) is gated `requirePermission("cos","override")`; overrides/uploads are `requireAdmin`. Enforcement is present in code, but **runtime role-rendering was not proven**.

---

## 7. PART U-WRITE — VALIDATION (safe subset executed) + mutation (not executed)

**Decision:** on a shared dev DB, a full create-and-revert of a throwaway project across the temporal/snapshot tables (PRS, normalized_*, category_revenue_allocations, derived_project_kpis) cannot be guaranteed perfectly reversible, and this is a verification-only pass. Per the spec's "if a write cannot be reverted, STOP and report", **successful mutations + revert were NOT executed.** The **validation** layer (bad-input rejection — which does not write) was fully exercised, with row-count guards proving zero writes.

| Endpoint | Bad input | HTTP | Message | DB effect |
|---|---|--:|---|---|
| `POST /api/cashflow-2026/opening-balance` | `{"balance":"not-a-number"}` | 400 | `weekStartDate: Required; openingBalance: Invalid input` | none |
| `POST /api/cashflow-2026/opening-balance` | `{}` | 400 | same | none |
| `POST /api/payment-requests` | `{}` | 400 | `projectId and amount are required` | `payment_requests` 0→0 |
| `POST /api/cos-status-override` | `{}` | 400 | `Missing required fields: expenseId, projectName, overrideStatus, reason` | none |
| `POST /api/revenue-tracking/overrides` | `{"overrides":[]}` | 400 | `overrides: Array must contain at least 1 element; overrideCategory/overrideComment: Required` | none |
| `POST /api/expenditure/overrides` | `{}` | 400 | `overrides/overrideCategory/overrideComment: Required` | none |
| `POST /api/cashflow-2026/available-payment` | `{"amount":"xyz"}` | **404** | `No API route matches POST /api/cashflow-2026/available-payment` | **endpoint path absent** |

→ **Validation = 🟢 GREEN** (rejects correctly with clear messages, no writes). **Note:** the spec-referenced `available-payment` POST path does not exist as named (404) — either renamed or removed; the UI control mapping to it would be dead.
**NOT EXECUTED:** successful inline budget edits, opening-balance create/delete, payment-planner Apply/Discard, COS line review actions, period lock/unlock + audit-log assertion, reconciliation refresh/ignore, PR/PO board actions, and the revert proof. These need either a sanctioned throwaway environment or an authenticated browser.

---

## 8. PART D — CALCULATION RE-DERIVATION (raw vs surfaced, ±R1)

| Calc | Surfaced | Re-derived (canonical) | Δ | Verdict |
|---|--:|--:|--:|---|
| Company revenue (canonical) | R371,364,217 (`inflow_total_value`) | Σ amount_ex_vat active rev lines = R371,364,217 | 0 | 🟢 |
| Company cost total | R350,128,099 (`cos_actual`) | Σ amount_ex_vat active cost lines = R350,128,099 | 0 | 🟢 |
| Cost paid (status) | — | Σ where cost_line_status='paid' = R349,658,124 | — | reference |
| Realised cost (invoice) | R267,107,083 | Σ where invoice_number & invoice_date set = R267,107,083 | 0 | 🟢 self / 🔴 vs other surfaces |
| Per-line GP (company) | −R126,645,678 (V1) | Σ(perLineRev) R223,312,159 − Σcost = −R126.6M | ≈0 | 🟢 internal / 🔴 vs PRS GP |
| GP margin (kpi-traceability) | 13.99% | 67,063,066 / 479,211,341 = 13.99% | 0 | 🟢 internal (but wrong rev base) |
| GP margin (financial-headline) | 67.22% | 45,249,978 / 67,315,208 = 67.22% | 0 | 🟢 internal (different base) |
| Orphan-driven revenue inflation | R479,211,341 | true + orphans 121,818,221 − non-orphan offset = R479,211,341 | 0 | 🔴 confirms inflation |
| Cashflow net | R0 (tiles) | rev paid − cost paid ≈ R21,706,093 | −R21.7M | 🔴 |

**Conclusion:** every surface is **internally** arithmetically consistent, but they are built on **different revenue/GP/COS bases** that are never reconciled → the cross-surface numbers cannot all be right.

---

## 9. PRIORITISED DEFECT REGISTER v2

| # | Sev | Defect | Tag | File / evidence | Δ (R1) |
|---|---|---|---|---|---|
| 1 | 🔴 | PRS mis-keyed → project-detail endpoint serves wrong project's costed summary | CARRIED-OVER (live-confirmed) | `server/api/v2/.../finance` summary; `project-v2-repository.ts:248`, `financial-review-service.ts:58` | id=19 shows "Hungry Lion Citrusdal" |
| 2 | 🔴 | Realised/paid COS resolves to 5 different values across pages | NEW (extends V1#3) | cos-control vs program/cos vs invoice vs colour-signal | spread ~R206M |
| 3 | 🔴 | Company revenue resolves to 4 different values | CARRIED-OVER (extends V1#4) | `kpi-traceability-routes.ts` (`revenue_actual` vs `inflow_total_value`) | +R107,847,124 |
| 4 | 🔴 | GP irreconcilable across 4 surfaces; margin 13.99% vs 67.22% | CARRIED-OVER (V1#2) | kpi-traceability / financial-headline / per-line | ~R194M spread |
| 5 | 🔴 | COS budget resolves to 3 values | NEW | kpi-traceability R276.07M vs program/cos R274.17M vs canonical R350.13M | Δ up to R76M |
| 6 | 🔴 | financial-headline uses an unlabelled FY-realised basis that matches no other finance page | NEW | `/api/financial-headline` rev R67.3M, margin 67.2% | — |
| 7 | 🔴 | Negative "realised" revenue & COS in monthly trackers | NEW | `/api/revenue-tracker` (−R19,598), `/api/cos-tracker` (−R2,825,916) | sign error |
| 8 | 🔴 | cashflow_points + finance_*_monthly empty → cashflow tiles render R0 | CARRIED-OVER (V1#6) | tables 0 rows; kpi cashflow_*=0 | served R0 vs ~R21.7M |
| 9 | 🔴 | 27 orphan + 2 duplicate active PRS rows | CARRIED-OVER (V1#1/#10) | SQL on `project_revenue_summary` | R121.8M phantom |
| 10 | 🟠 | `manual_overrides` table missing → `tracker_vs_app_drift` unresolvable | CARRIED-OVER (V1#7) | `to_regclass` NULL | KPI dead |
| 11 | 🟠 | quickbooks_invoice_links empty → all 2,737 cost invoices unmatched; QB recon page empty | CARRIED-OVER (V1#8) | SQL 0 rows | — |
| 12 | 🟠 | Reconciliation board shows every project "unlinked" | NEW (surfacing of V1) | `/api/finance/reconciliation` | no trusted recon |
| 13 | 🟡 | cashflow-tracker epoch-zero week dates (1899-12-25) | NEW | `/api/cashflow-tracker` | data-quality |
| 14 | 🟡 | `/api/cashflow-2026/available-payment` POST path 404 (dead control mapping) | NEW | validation probe | — |
| 15 | 🟡 | Non-uniform soft-delete columns; registry column drift; contract_value=0 (ids 10,19) | CARRIED-OVER (V1#9/#11/#12) | information_schema | latent |

**Positive (🟢):** canonical revenue & cost totals re-derive exactly; input validation rejects bad data with clear messages and zero writes; auth/permission middleware is present on every finance route.

---

## 10. What was NOT possible in this environment (no fabrication)
- **Authenticated browser rendering / screenshots / click-through** (PART P interactions, PART S states, PART RBAC role rendering): blocked — MSAL+localStorage JWT cannot be injected into the available unauthenticated browser tool. Only the login screen was capturable.
- **Successful write mutations + revert** (PART U-WRITE write paths): not executed on the shared dev DB; validation (non-writing) layer fully tested instead.
These are environment limitations, not findings; they are listed so the report is not mistaken for full browser coverage. The substantive finance defects all reproduce at the endpoint/data layer the pages consume.
