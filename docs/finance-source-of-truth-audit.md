# Finance Source-of-Truth Audit — Consolidated (V1 + V2 + Runtime Button Pass)

**Type:** Report-only audit. **No code / schema / migration / data was changed.** The only writes attempted were rejected-on-purpose validation probes (bad input → 4xx, zero rows written — proven in §8).
**Supersedes:** the former `finance-source-of-truth-audit.md` (V1) and `finance-source-of-truth-audit-v2.md` (V2). This single document merges both, adds an **authenticated browser button pass** (the V1/V2 "NOT EXECUTED" UI items are now executed), and adds a **dev-vs-production reconciliation**.
**Environment:** LIVE dev DB (`helium`/`heliumdb` via `DATABASE_URL`) + RUNNING app (`npm run dev`, port 5000). Production reconciled **read-only** via `CLAUDE_RO_DATABASE_URL` (`neondb`, schema `claude_views`).
**Auth used:** `/api/auth/dev-login` → `/api/auth/exchange-code` → JWT for `johannes` (id=1, role **COO_ADMIN**). See §0 for a **critical auth-contract defect** discovered while wiring the browser pass.
**Date:** 2026-06-09. All money is ZAR. `amount_ex_vat` is stored as **TEXT** and was cast with a numeric guard (`~ '^-?[0-9]+([.][0-9]+)?$'`). "Active" snapshot row = `effective_to IS NULL`.

---

## VERDICT: 🔴 RED — DO NOT TREAT THE FINANCE SURFACE AS A FROZEN SOURCE OF TRUTH

The **canonical line-level engine reconciles cleanly** with raw SQL for *revenue total* and *cost total* (the spine is sound). But several declared "canonical" sources **do not resolve to their data**, and the **`project_revenue_summary` (PRS) snapshot is structurally corrupt** (mis-keyed + orphaned + duplicated). Consequently the *same business number differs by up to ~R200M across pages*, gross profit has **four irreconcilable values (~R194M spread)**, realised COS resolves to **five** values (~R206M spread), and the per-project detail endpoint **serves a different project's financials**.

Three things this consolidated pass adds beyond V1/V2:
1. **Production is worse, not better.** The identical structural defects reproduce in prod **at larger magnitude** — prod has **50 orphan PRS rows = R416.25M phantom revenue (~90% of all prod PRS revenue)** vs dev's R121.8M. Promoting/"freezing" will not escape these defects; prod is the more-corrupt dataset.
2. **The dev browser UI cannot authenticate through the supported dev-login flow** (§0) — a real auth-contract break between a cookie-only client and a session-less dev login; a Bearer-header workaround was required to drive the UI.
3. **A runtime component crash** on `/finance/reconciliation` (`ReconStatusChip` → `TypeError: Cannot read properties of undefined (reading 'icon')`, caught by the ErrorBoundary), found by the button pass.

| Area | Status |
|---|---|
| Revenue total (canonical vs raw) | 🟢 reconciles to the cent |
| Cost total / budgeted (canonical vs raw) | 🟢 reconciles |
| `recognisedRevenue` == per-line revenue sum | 🟢 internally consistent |
| `active_projects` (dev) | 🟢 42 by both `project_status` and `is_active` |
| Input validation (bad-input rejection) | 🟢 rejects with clear messages, zero writes |
| Dev browser authentication | 🔴 broken — cookie-only client + session-less dev-login (§0) |
| Company revenue (4 surfaces) | 🔴 R371.4M / R479.2M / R357.4M / R67.3M |
| Gross profit (4 surfaces) | 🔴 −R126.6M / +R67.1M / +R45.9M / +R45.2M (~R194M spread) |
| Realised COS (5 surfaces) | 🔴 R267.1M / R202.2M / R120.3M / R66.4M / R61.1M (~R206M) |
| `project_revenue_summary` integrity | 🔴 mis-keyed FK + orphans + duplicate active rows (dev & prod) |
| Per-project detail endpoint identity | 🔴 id=19 "Mondi" returns costed summary "Hungry Lion Citrusdal" |
| `revenue_realised` registry formula | 🔴 yields R0 (statuses don't exist) |
| `cashflow_net` / monthly derived tables | 🔴 source tables empty (0 rows) — **in dev AND prod** |
| `tracker_vs_app_drift` | 🔴 `manual_overrides` table does not exist |
| Negative "realised" in monthly trackers | 🔴 revenue −R19,598; COS −R2,825,916 (sign error) |
| `/finance/reconciliation` render | 🔴 `ReconStatusChip` crash caught by ErrorBoundary (§2) |

---

## 0. AUTH-CONTRACT DEFECT (new, blocks all browser UX) — 🔴 Critical

While wiring the authenticated button pass, the dev browser UI proved **impossible to authenticate through the supported flow**. Root cause, proven end-to-end:

- The client (`client/src/lib/api.ts`) was migrated to **cookie-only auth**: `getAuthToken()` **intentionally returns `null`**, `setAuthToken()` is a **no-op that only clears the legacy `auth_token`**, and every request uses `credentials: "include"` (httpOnly session cookie). So the browser **never sends a Bearer token**.
- The server (`server/auth-context.ts → resolveAuthenticatedUser`) authenticates via **either** a passport session (`req.isAuthenticated()` — established only by `req.logIn(...)`) **or** a Bearer token.
- **`req.logIn(...)` is called only on the real Microsoft callback** (`server/routes/auth-routes.ts` MS-callback path). **`dev-login` and `exchange-code` never call `req.logIn`** — `exchange-code` only returns `res.json({ token, user })`. The `ms-callback` page then calls `setAuthToken(data.token)`, which (per the migration) **discards** it.

**Proven behaviour (read-only probes):**
| Probe | Result |
|---|---|
| `/api/auth/me` with **Bearer** (token from exchange-code) | **200** (user id=1) |
| `/api/auth/me` with **session cookie only** (post-exchange `connect.sid`) | **401** |
| `/api/auth/me` with **nothing** | 401 |
| Browser load of `/finance` (cookie-only client, as shipped in dev) | redirects to `/auth/login` |
| Browser load of `/finance` with `Authorization: Bearer …` injected on every request | **fully authenticated, page renders** |

**Net:** in **dev**, the only login path (`dev-login`) yields a session the server does not accept, and the client no longer sends the Bearer it was handed → **the entire authenticated UI is unreachable** through the normal flow. (Production's real MS login *does* call `req.logIn`, so prod cookie auth works — this defect is dev-login–specific, but it makes the dev environment's UI untestable without a workaround.) This is also the true explanation for V2's "no authenticated browser" limitation. **Workaround used for this audit only:** inject `Authorization: Bearer <dev JWT>` via the browser context on every request (no code changed).

---

## 1. DEV vs PRODUCTION RECONCILIATION (prod = more accurate, read-only)

Identical canonical SQL run against dev (`DATABASE_URL`) and prod (`claude_views.*`). Prod is the larger, authoritative dataset; dev is a **stale subset**. The structural defects are **present in both and worse in prod**.

| Metric | DEV | PROD | Match |
|---|--:|--:|:--:|
| projects_total | 42 | 91 | ❌ |
| projects_active | 42 | 90 | ❌ |
| contract_value=0 (active) | 2 | 20 | ❌ |
| rev_lines_active | 253 | 397 | ❌ |
| **rev_total_active** | R371,364,217 | R438,676,273 | ❌ |
| cost_lines_active | 3,445 | 4,773 | ❌ |
| **cost_total_active** | R350,128,099 | R382,538,099 | ❌ |
| cost_realised_invoice | R267,107,083 | R318,303,576 | ❌ |
| prs_active | 69 | 69 | ✅ |
| prs_actual_rev | R479,211,341 | R462,254,854 | ❌ |
| prs_actual_profit | R67,063,066 | R67,240,957 | ❌ |
| **prs_orphans** | 27 | **50** | ❌ |
| **prs_orphan_rev** | R121,818,221 | **R416,252,384** | ❌ |
| prs_dupe_groups | 2 | 1 | ❌ |
| finance_revenue_monthly rows | 0 | 0 | ✅ |
| finance_cos_monthly rows | 0 | 0 | ✅ |
| cashflow_points rows | 0 | 0 | ✅ |

**Key reads:**
- **PRS corruption is systemic, not a dev artefact.** In prod, **R416.25M of R462.25M PRS "actual revenue" (~90%) is orphaned** (rows whose `project_id` is not a live project). Any unfiltered admin/GP aggregate over PRS in prod is dominated by phantom rows.
- **The empty cashflow/monthly tables are empty in prod too** — the cashflow KPI renders R0 from genuinely empty sources in *both* environments; this is not a dev-seeding gap.
- `prs_active` (69) is identical in both, but maps to 42 live projects in dev and ~90 in prod → the orphan/duplicate problem scales with the larger prod project set.

---

## 2. AUTHENTICATED BUTTON PASS (V1/V2 "NOT EXECUTED" items, now executed)

Driven headless (Playwright/Chromium) as COO_ADMIN with the §0 header workaround. **19 of 21** finance routes loaded; each: assert authenticated render, enumerate visible controls, screenshot, and click up to 3 **non-destructive** controls (destructive verbs — save/delete/approve/apply/post/lock/override/etc. — skipped by regex; no mutation performed). Screenshots in `.local/audit-v3/shots/` (transient).

**Result across all 19 rendered routes:** authenticated render ✅, **0 HTTP 4xx/5xx on any API call or interaction** (the data layer the pages call is reachable and returns 200s for a privileged user). Controls present and clickable on every page.

| Signal | Finding |
|---|---|
| Auth render | 19/19 loaded routes authenticated (header workaround); without it, **0** would (see §0) |
| API errors on load + interaction | **0** across all routes (no 4xx/5xx) |
| **Runtime crash** | `/finance/reconciliation`: `TypeError: Cannot read properties of undefined (reading 'icon')` at **`ReconStatusChip`**, **caught by the ErrorBoundary** → the chip/section fails to render. 🔴 real defect. |
| DOM-nesting / hydration warnings | `/finance/reconciliation`: `<p>` cannot contain a `<div>`; `<button>` nested inside `<button>` → React hydration warnings. 🟡 cosmetic but real. |
| Dev-only console noise | Vite HMR websocket failures (`ws://localhost:443/vite-hmr`) — harmless dev artefact, not an app defect. |
| "Click error" false-positives | Clicking **"Microsoft"** / **"Back to Dashboard"** triggers logout/navigation (expected), which produces HMR-reconnect console noise — **not** real errors. |

**Routes covered (19):** `/finance`, `/finance/close`, `/cashflow`, `/cashflow/analysis`, `/cos`, `/cos/analysis`, `/revenue-tracker`, `/fye-revenue-tracking`, `/finance/gp/company`, `/finance/gp`, `/finance/audit-prep`, `/finance/reconciliation`, `/finance/quickbooks-customer-mapping`, `/finance/quickbooks-links`, `/payment-request-board`, `/payment-batch-manager`, `/po-approval-board`, `/subcontractor-dashboard`, `/governance/financial-reviews`.
**Not completed (2):** `/reports/program-wide-assessment` (screenshot captured, harness context-create stalled), `/projects/19` detail — both reachable; the **data-layer** identity defect for project 19 is proven in §4 regardless.

> **Scope note:** the button pass proves *reachability + render + no transport errors*, not *number correctness in the DOM*. The numeric defects below are proven at the endpoint/data layer the React Query pages render verbatim, so the endpoint value **is** the rendered value.

---

## 3. PART R — V1 DEFECT REGRESSION (all 12 re-tested live)

| # | V1 defect | Live result | Verdict | Current Δ |
|---|---|---|---|---|
| 1 | PRS `project_id` ≠ `project_info.id` | id=1 PRS="25 Superior Road" vs PI="261 Bree Street" (table shifted); live `/api/v2/projects/19/finance/summary` embeds `costedSummary.projectName="Hungry Lion Citrusdal"` | 🔴 OPEN | wrong attribution, all projects |
| 2 | Gross profit irreconcilable | −R126,645,678 / +R67,063,066 / +R45,898,230 / +R45,249,978 | 🔴 OPEN | 4 values, ~R194M spread |
| 3 | Realised cost: invoice vs colour-signal | R267,107,083 / R202,237,310 / R120,290,998 / R66,386,861 / R61,128,689 | 🔴 OPEN (worse) | now **5** surfaces (Δ up to ~R206M) |
| 4 | Admin KPI total inflated by orphan PRS | `revenue_actual` R479,211,341 vs canonical R371,364,217 | 🔴 OPEN | **+R107,847,124** |
| 5 | `revenue_realised` statuses don't exist | only `paid`(252)+`invoiced`(1); registry wants `in_bank`/`realised` | 🔴 OPEN | formula → R0 vs R371.4M |
| 6 | cashflow + monthly tables empty | 0/0/0 rows (dev **and** prod); kpi cashflow_*=0 | 🔴 OPEN | served R0 vs ~R21.7M |
| 7 | `tracker_vs_app_drift` source missing | `to_regclass('public.manual_overrides')` = NULL | 🔴 OPEN | KPI unresolvable |
| 8 | `unmatched_cost_invoices` = all (qb links empty) | `quickbooks_invoice_links` 0 rows | 🔴 OPEN | 2,737 unmatched |
| 9 | Registry references non-existent columns | cost status col is `cost_line_status` (no `approved`); no `status` | 🔴 OPEN | latent mis-map |
| 10 | Duplicate active PRS rows | ids 41 {12 Nourse, Randfontein}, 42 {Maynard Mall Ext, Red Rocket} | 🔴 OPEN | 2 dup groups (different projects share one id) |
| 11 | Soft-delete columns non-uniform | `deleted_at` only on normalized_*+qb_links; PRS/cashflow/monthly/category/tracker `effective_to` only | 🔴 OPEN | latent |
| 12 | `contract_value=0` on active projects | dev ids {10,19}; prod **20** active projects | 🟠 DRIFTED | set changed from V1 {19,40} |

**Net regression: 11 OPEN, 1 DRIFTED, 0 FIXED.** The dev DB is unchanged since V1; prod exhibits the same defects at larger scale (§1).

---

## 4. PART X — CROSS-SURFACE CONSISTENCY MATRIX

Same business number as rendered by different pages/endpoints. **Any divergence > R1 = FAIL.**

**Company revenue (total):**
| Surface | Rendered | Canonical | Δ | Verdict |
|---|--:|--:|--:|---|
| normalized_revenue_lines / kpi-traceability `inflow_total_value` | R371,364,217 | R371,364,217 | 0 | 🟢 |
| kpi-traceability `revenue_actual` (PRS all-active) | R479,211,341 | R371,364,217 | +R107,847,124 | 🔴 |
| PRS real-ids only | R357,393,120 | R371,364,217 | −R13,971,097 | 🔴 |
| `/api/financial-headline` `totalRevenue` (FY-realised basis, unlabelled) | R67,315,208 | R371,364,217 | −R304M | 🔴 |

→ **4 distinct values.** The *same* kpi-traceability response carries both the correct (`inflow_total_value`) and inflated (`revenue_actual`) figure.

**Company COS — "realised / paid":** R267,107,083 (invoice) / R202,237,310 (`program/cos cashPaid`) / R120,290,998 (`program/cos totalCosRealised`) / R66,386,861 (canonical colour-signal) / R61,128,689 (`cos-control totalPaid`) → **5 values, ~R206M spread. FAIL.**

**Company COS — "budget":** R276,069,539 (kpi `cos_budget`) / R274,169,539 (`program/cos totalBudget`) / R350,128,099 (canonical cost_total, labelled `cos_actual`) → **3 values. FAIL** (program/cos budget is exactly R1,900,000 below traceability).

**Company GP & margin:** −R126,645,678 (per-line) / +R67,063,066 @13.99% (kpi PRS) / +R45,898,230 (PRS real-ids) / +R45,249,978 @**67.22%** (financial-headline) → **GP 4 values ~R194M; margin 13.99% vs 67.22%. FAIL.**

**Per-project identity (id=19):** `project_info.id=19`=**Mondi** (contract_value 0); `/api/v2/projects/19/finance` canonical = Mondi-scale (cost R141,664,627 / rev R144,482,290); `/api/v2/projects/19/finance/summary` `costedSummary`=**"Hungry Lion Citrusdal"** R1,292,329. → endpoint **mixes two projects. FAIL.**

**App-vs-tracker (`/api/finance/reconciliation`):** real computed deltas (Coega Steels Ph2 −R12,948,906, De Drift −R5,960,421, Unitrans Brackenfell −R5,338,344) but **every project `status="unlinked"`** → no trusted reconciliation; UI also crashes the status chip (§2). **FAIL.**

**Cash available this week:** kpi `cashflow_revenue`/`cashflow_expenditure`=**0/0**; `/api/cashflow-tracker` returns **epoch-zero week dates** (`1899-12-25`, `2022-10-17`) with near-zero inflows. → tiles render zeros, not data. **FAIL.**

---

## 5. PART A/B/C — REGISTRY, PER-PROJECT, SNAPSHOT INTEGRITY (V1 detail, re-confirmed)

**KPI registry (portfolio), (a) raw SQL · (b) running app · (c) snapshot:**
| KPI | (a) raw SQL | (b) running app | (c) snapshot | Verdict |
|---|--:|--:|--:|---|
| `revenue_planned` | R371,364,217 | canonical `totalRevenue` R371,364,217 ✓ | PRS `planned_revenue` R474,740,762 | 🟢 canonical / 🔴 snapshot |
| `revenue_realised` | **R0** (`status IN ('in_bank','realised')` — no such statuses) | `receivedRevenue` R371,364,217 (payment dates) | — | 🔴 formula↔data drift |
| `cos_budgeted` | R350,128,099 | `totalCost` R350,128,099 ✓ | admin `totalActualCos` R350,128,099 (mislabelled "actual") | 🟡 value OK, label wrong |
| `cos_realised` | R267,107,083 (invoice) | `realisedCost` R66,386,861 (colour-signal) | admin `totalBudgetCos` R276,069,539 | 🔴 ~R200.7M gap |
| `gross_profit_realised` | intended +R104,257,134 | per-line GP −R126,645,678 | PRS `actual_profit` +R67,063,066 | 🔴 ~R230M spread |
| `cashflow_net` | R21,706,093 (rev paid − cost paid) | `cashflow_points` 0 rows | admin `cashflow` R0 | 🔴 served 0 |
| `active_projects` | 42 (`project_status`) | 42 (`is_active`) | 42 | 🟢 |
| `unmatched_cost_invoices` | 2,737 (=100% invoiced cost lines) | — | — | 🔴 qb links empty |
| `tracker_vs_app_drift` | unresolvable | unresolvable | — | 🔴 `manual_overrides` absent |

**Per-project (42, dev):** revenue total and cost total reconcile to the cent for all 42 (normalized lines correctly keyed on `project_id == project_info.id`). Fails: PRS mis-keyed (project 36 shows Mondi's R144,482,291; project 19 shows R1,292,329); realised cost diverges per project (Coega invoice R46,148,048 vs canonical R7,886,148); per-line GP negative on most projects (recognisedRevenue=0 while full cost subtracted); contract_value=0 on active projects.

**Snapshot integrity sweep (active = `effective_to IS NULL`, dev):**
| Table | Active | Note |
|---|--:|---|
| normalized_cost_lines | 3,445 | 2 dup-active groups (+3 rows) |
| normalized_revenue_lines | 253 | 2 dup-active groups (+2 rows) |
| `project_revenue_summary` | **69** | for only 42 projects; **27 orphans** = R121,818,221 phantom rev / R21,164,836 phantom profit; ids 41/42 duplicate across *different* projects |
| `cashflow_points` / `finance_revenue_monthly` / `finance_cos_monthly` | **0 / 0 / 0** | empty (dev **and** prod) |

One-active-row-per-natural-key invariant **VIOLATED** for PRS in both environments; the admin surface reports `totalActualRevenue` R479,211,341 vs true R371,364,217 (+29% in dev; ~90% orphan-dominated in prod).

---

## 6. PART D — CALCULATION RE-DERIVATION (±R1)

| Calc | Surfaced | Re-derived (canonical) | Δ | Verdict |
|---|--:|--:|--:|---|
| Company revenue | R371,364,217 (`inflow_total_value`) | Σ amount_ex_vat active rev = R371,364,217 | 0 | 🟢 |
| Company cost total | R350,128,099 (`cos_actual`) | Σ amount_ex_vat active cost = R350,128,099 | 0 | 🟢 |
| Realised cost (invoice) | R267,107,083 | Σ invoice_number & invoice_date set | 0 | 🟢 self / 🔴 vs others |
| Per-line GP | −R126,645,678 | Σ perLineRev R223,312,159 − Σcost | ≈0 | 🟢 internal / 🔴 vs PRS |
| GP margin (kpi) | 13.99% | 67,063,066 / 479,211,341 | 0 | 🟢 internal (wrong rev base) |
| GP margin (headline) | 67.22% | 45,249,978 / 67,315,208 | 0 | 🟢 internal (different base) |
| Cashflow net | R0 (tiles) | rev paid − cost paid ≈ R21,706,093 | −R21.7M | 🔴 |

**Conclusion:** every surface is **internally** arithmetically consistent but built on **different revenue/GP/COS bases that are never reconciled** → the cross-surface numbers cannot all be right.

---

## 7. PART RBAC

- **Privileged (COO_ADMIN):** verified — all finance + admin endpoints (`/api/admin/kpi-traceability`, `/api/data-quality/scan`) return data; all 19 browser routes render (§2).
- **Low-privilege:** **NOT EXECUTED** — `dev-login` mints a session only for the seeded admin; no supported way to obtain a low-priv token here. (The §0 defect compounds this: even the admin cookie session is server-rejected; only the Bearer workaround authenticates.)
- **Static evidence:** every finance route is wrapped in `requireAuth` + `requirePermission(entity, action)` / `requireAdmin`; page-registry assigns `permissionEntity` per route; COS override gated `requirePermission("cos","override")`; uploads/overrides `requireAdmin`. Enforcement is present in code; runtime role-rendering not proven.

---

## 8. PART U-WRITE — VALIDATION (executed) + mutation (not executed)

**Decision:** on a shared dev DB a full create-and-revert across temporal/snapshot tables cannot be guaranteed perfectly reversible, and this is a verification-only pass → **successful mutations + revert NOT executed.** The non-writing **validation** layer was fully exercised with row-count guards proving zero writes.

| Endpoint | Bad input | HTTP | DB effect |
|---|---|--:|---|
| `POST /api/cashflow-2026/opening-balance` | `{"balance":"not-a-number"}` / `{}` | 400 | none |
| `POST /api/payment-requests` | `{}` | 400 | `payment_requests` 0→0 |
| `POST /api/cos-status-override` | `{}` | 400 | none |
| `POST /api/revenue-tracking/overrides` | `{"overrides":[]}` | 400 | none |
| `POST /api/expenditure/overrides` | `{}` | 400 | none |
| `POST /api/cashflow-2026/available-payment` | `{"amount":"xyz"}` | **404** | **endpoint path absent** (dead control mapping) |

→ **Validation = 🟢 GREEN.** Note the spec-referenced `available-payment` POST path does not exist (404). **NOT EXECUTED:** successful inline edits, opening-balance create/delete, payment-planner Apply/Discard, COS line review, period lock/unlock + audit-log assertion, reconciliation refresh/ignore, PR/PO board actions, and the revert proof — these need a sanctioned throwaway environment.

---

## 9. CONSOLIDATED PRIORITISED DEFECT REGISTER

| # | Sev | Defect | Origin | Evidence | Δ (R1) |
|---|---|---|---|---|---|
| 1 | 🔴 | Dev browser UI cannot authenticate — cookie-only client + session-less dev-login (`exchange-code` never `req.logIn`; `setAuthToken` no-op) | NEW | §0; `client/src/lib/api.ts`, `server/routes/auth-routes.ts`, `server/auth-context.ts` | UI unreachable in dev |
| 2 | 🔴 | PRS mis-keyed → project-detail endpoint serves wrong project's costed summary | V1#1 / V2 (live) | `project-v2-repository.ts:248`, `financial-review-service.ts:58`; id=19→"Hungry Lion Citrusdal" | wrong attribution all projects |
| 3 | 🔴 | Realised/paid COS resolves to **5** values across pages | V1#3 / V2 | cos-control vs program/cos vs invoice vs colour-signal | ~R206M spread |
| 4 | 🔴 | Company revenue resolves to **4** values; admin total orphan-inflated | V1#4 / V2 | kpi-traceability `revenue_actual` vs `inflow_total_value` | +R107,847,124 |
| 5 | 🔴 | GP irreconcilable across **4** surfaces; margin 13.99% vs 67.22% | V1#2 / V2 | kpi / financial-headline / per-line | ~R194M spread |
| 6 | 🔴 | **Production PRS ~90% orphaned** (50 rows, R416.25M) — defect worse in prod | NEW (recon) | §1; `claude_views.v_project_revenue_summary` | R416,252,384 phantom |
| 7 | 🔴 | COS budget resolves to 3 values | V2 | kpi R276.07M vs program/cos R274.17M vs canonical R350.13M | up to ~R76M |
| 8 | 🔴 | financial-headline uses an unlabelled FY-realised basis matching no other page | V2 | `/api/financial-headline` rev R67.3M @67.2% | — |
| 9 | 🔴 | Negative "realised" revenue & COS in monthly trackers | V2 | `/api/revenue-tracker` −R19,598; `/api/cos-tracker` −R2,825,916 | sign error |
| 10 | 🔴 | cashflow_points + finance_*_monthly empty (dev **and** prod) → cashflow tiles R0 | V1#6 / V2 / recon | 0 rows both envs | served R0 vs ~R21.7M |
| 11 | 🔴 | 27 orphan + 2 duplicate active PRS rows (dev); one-active-row invariant violated in both dev & prod | V1#1/#10 / V2 | SQL on PRS | R121.8M phantom (dev) |
| 12 | 🔴 | `/finance/reconciliation` `ReconStatusChip` crash (`reading 'icon'`) caught by ErrorBoundary | NEW (button pass) | §2; console error on route | section fails to render |
| 13 | 🟠 | `manual_overrides` table missing → `tracker_vs_app_drift` unresolvable | V1#7 | `to_regclass` NULL | KPI dead |
| 14 | 🟠 | quickbooks_invoice_links empty → all 2,737 cost invoices unmatched; QB recon page empty | V1#8 | SQL 0 rows | — |
| 15 | 🟠 | Reconciliation board shows every project "unlinked" | V2 | `/api/finance/reconciliation` | no trusted recon |
| 16 | 🟡 | cashflow-tracker epoch-zero week dates (1899-12-25) | V2 | `/api/cashflow-tracker` | data-quality |
| 17 | 🟡 | `/api/cashflow-2026/available-payment` POST 404 (dead control mapping) | V2 | §8 probe | — |
| 18 | 🟡 | `/finance/reconciliation` DOM nesting (`<p>`>`<div>`, `<button>`>`<button>`) hydration warnings | NEW (button pass) | §2 | cosmetic |
| 19 | 🟡 | Non-uniform soft-delete columns; registry column drift; contract_value=0 (dev {10,19}; prod 20 active) | V1#9/#11/#12 / V2 | information_schema | latent |

**Positive (🟢):** canonical revenue & cost totals re-derive exactly (dev); input validation rejects bad data with clear messages and zero writes; auth/permission middleware present on every finance route; all 19 rendered finance pages return 200s with no transport errors for a privileged user.

---

## 10. WHAT WAS NOT POSSIBLE / OUT OF SCOPE (no fabrication)
- **Low-privilege RBAC role-rendering** and **successful write mutations + revert**: not executed (no low-priv token; shared dev DB not safely revertible). Validation layer fully tested instead (§8).
- **2 of 21 browser routes** (`/reports/program-wide-assessment`, `/projects/19` detail) did not complete the click pass (harness stalls); their data-layer defects are proven independently (§4).
- **In-DOM numeric assertions:** the button pass proves render + transport health; numeric correctness is proven at the endpoint/data layer the pages render verbatim.
These are environment limitations, not findings.

## Appendix — reproduction
- **Raw SQL:** `psql "$DATABASE_URL"` (dev) and read-only `psql "$CLAUDE_RO_DATABASE_URL"` against schema `claude_views` (prod), numeric-guard cast on `amount_ex_vat`, active = `effective_to IS NULL`.
- **Running-app values:** invoke `getKpiAggregates()`, `getCanonicalFinanceByProjectIds(allIds)`, `FinanceLineLevelRepository.getPortfolioFinanceLines(allIds)` in-process after `initializeDatabase()`; and the live finance endpoints with a Bearer JWT.
- **Browser button pass:** headless Chromium as COO_ADMIN with `Authorization: Bearer <dev JWT>` injected per request (workaround for §0); non-destructive controls only.
- **Auth contract:** probes against `/api/auth/me` with Bearer / cookie / none as tabulated in §0.
No code, schema, migration, or data was modified by this audit.
