# Finance Source-of-Truth Runtime Audit

**Type:** Report-only runtime audit (no code / schema / data changed)
**Environment:** LIVE dev DB (`postgres`, host `helium`/`heliumdb` via `DATABASE_URL`) + RUNNING app services
**Date:** 2026-06-09
**Anchor contract:** `server/lib/reconciliation/selected-truth-registry.ts` (the 12-KPI canonical registry)
**Method:** For each KPI / project number we compared three resolutions —
**(a)** raw SQL per the registry formula, **(b)** the value the running app returns (canonical-dashboard service, finance line-level repository, and the admin KPI-traceability aggregator, all invoked in-process against the live DB), and **(c)** the persisted snapshot tables.
All money is ZAR. `amount_ex_vat` is stored as **TEXT** and was cast with a numeric guard (`~ '^-?[0-9]+([.][0-9]+)?$'`).

---

## VERDICT: 🔴 RED — DO NOT TREAT THE SNAPSHOT/ADMIN FINANCE SURFACE AS A FROZEN SOURCE OF TRUTH

The **canonical line-level engine reconciles cleanly** with raw SQL for *revenue total* and *cost total* (the spine is sound). But several declared canonical sources **do not resolve to their data**, and the **`project_revenue_summary` (PRS) snapshot is structurally corrupt** (mis-keyed + orphaned + duplicated), so every KPI and per-project number that flows through the PRS/admin-traceability surface is wrong by material amounts. Gross profit has **three irreconcilable values spanning ~R230M**, and realised cost has **two definitions ~R201M apart**.

| Area | Status |
|---|---|
| Revenue total (canonical vs raw) | 🟢 reconciles to the cent |
| Cost total / budgeted (canonical vs raw) | 🟢 reconciles |
| `recognisedRevenue` == per-line revenue sum | 🟢 internally consistent |
| `active_projects` | 🟢 42 by both `project_status` and `is_active` |
| Gross profit (3 surfaces) | 🔴 −R126.6M / +R67.1M / +R104.3M |
| Realised cost (2 definitions) | 🔴 R267.1M (invoice) vs R66.4M (colour signal) |
| `project_revenue_summary` integrity | 🔴 mis-keyed FK + 27 orphans + duplicate active rows |
| Admin KPI-traceability revenue | 🔴 R479.2M vs true R371.4M (+R107.8M) |
| `revenue_realised` registry formula | 🔴 yields R0 (statuses don't exist) |
| `cashflow_net` / monthly derived tables | 🔴 source tables empty (0 rows) |
| `tracker_vs_app_drift` | 🔴 `resolvedField` table `manual_overrides` does not exist |
| Registry column references | 🔴 schema drift (`status` columns don't exist) |

---

## Part A — KPI registry reconciliation (portfolio)

(a) = raw SQL per registry formula · (b) = running app · (c) = snapshot. Deltas vs the **canonical** value.

| KPI (registry key) | (a) raw SQL per formula | (b) running app | (c) snapshot | Verdict |
|---|--:|--:|--:|---|
| `revenue_planned` | R371,364,217 (all active rev lines) | canonical `totalRevenue` **R371,364,217** ✓ | PRS `planned_revenue` **R474,740,762** | 🟢 canonical / 🔴 snapshot+admin (+R103.4M) |
| `revenue_invoiced` | R371,364,217 (253 lines) | R371,364,217 | — | 🟢 |
| `revenue_realised` | **R0** — `status IN ('in_bank','realised')` (no such statuses exist) | canonical `receivedRevenue` R371,364,217 (uses payment dates) | — | 🔴 formula vs data drift (R371.4M) |
| `cos_budgeted` | R350,128,099 (3,445 lines) | canonical `totalCost` **R350,128,099** ✓ | admin `cos.totalActualCos` R350,128,099 (mislabelled "actual") | 🟡 value OK, label wrong |
| `cos_committed` | R349,934,629 (`cost_line_status IN ('invoiced','approved','paid')`; `approved`=0 rows) | — | — | 🟡 maps to a non-registry column (see D) |
| `cos_realised` | **R267,107,083** (invoice_number + invoice_date, 2,737 lines) | canonical `realisedCost` **R66,386,861** | admin `totalBudgetCos` R276,069,539 (budget_total col) | 🔴 R200.7M gap between two "realised" defs |
| `gross_profit_realised` | registry formula `rev_realised − cos_realised` → intended **+R104,257,134** | per-line GP sum **−R126,645,678** | PRS `actual_profit` **+R67,063,066** | 🔴 three answers, ~R230M spread |
| `cashflow_net` | R21,706,093 (rev paid R371,364,217 − cost paid R349,658,124) | canonical paidCost R349,658,124 ✓; `cashflow_points` table **0 rows** | admin `cashflow` **R0 / 0 projects** | 🔴 served value is 0 |
| `active_projects` | 42 (`project_status='active'`) | 42 (`is_active=true`) | 42 | 🟢 |
| `invoice_without_po` | 1,110 (invoice_number set, po_number null) | — | — | 🟢 measurable |
| `unmatched_cost_invoices` | 2,737 (= 100% of invoiced cost lines) | — | — | 🔴 `quickbooks_invoice_links` empty → everything unmatched |
| `tracker_vs_app_drift` | unresolvable | unresolvable | — | 🔴 `resolvedField` table `manual_overrides` does not exist |

**Soft-delete guard:** adding `deleted_at IS NULL` changes **no** Part-A figure today (no soft-deleted *active* rows currently) — so the missing guards are a **latent** risk, not active drift. See Part D.

---

## Part B — per-project reconciliation (42 projects)

**What reconciles (🟢):** per-project **revenue total** = canonical `totalRevenue` to the cent for all 42 projects; **cost total** = canonical `totalCost`. The normalized line tables are correctly keyed on `project_id == project_info.id`.

**What fails (🔴):**

1. **`project_revenue_summary` is mis-keyed.** PRS `project_id` does **not** correspond to `project_info.id`. PRS carries its own `project_name` which proves it: PRS row `project_id=1` has `project_name="25 Superior Road"` while `project_info.id=1` is "261 Bree Street". Every per-project consumer that joins PRS **by `projectId`** therefore attributes the **wrong project's** revenue/profit/margin. Examples: project 36 (Trident Steel PE, contract R3.9M) shows PRS `actual_revenue` = **R144,482,291** (that is Mondi's number); project 19 (Mondi) shows PRS `actual_revenue` = R1,292,329.
   - Affected runtime consumers (join on `projectRevenueSummary.projectId`): `server/api/v2/repositories/project-v2-repository.ts:248`, `server/services/financial-review-service.ts:58`.
   - Correctly keyed consumer (joins on `projectName`): `server/repositories/finance-temporal-repository.ts:123`.

2. **Realised cost diverges per project.** Canonical `realisedCost` (colour-signal predicate) is far below invoice-based realised on almost every project, e.g. project 8 Coega: invoice R46,148,048 vs canonical R7,886,148; project 19 Mondi: R89,358,941 vs R37,880,702.

3. **Per-line GP negative on most projects** because `recognisedRevenue` is 0 for many (no cost-actual rows pass the invoice-date recognition gate) while the full cost is still subtracted — e.g. projects 1, 7, 8, 11, 12, 22, 23, 26, 30, 33, 35, 37, 39, 40 each return GP = −(full cost).

4. **Contract-value gaps:** project 19 (Mondi) and project 40 (MEGA PARK P2) have `contract_value = 0` in `project_info` despite >R140M and >R18M of activity respectively.

**Portfolio roll-ups (per-project sums):**

| Measure | Value |
|---|--:|
| Revenue total (raw = canonical) | R371,364,217 |
| Cost total / budgeted (raw = canonical) | R350,128,099 |
| Realised cost — invoice-based (raw) | R267,107,083 |
| Realised cost — canonical colour signal | R66,386,861 |
| Per-line revenue (= `recognisedRevenue`) | R223,312,159 |
| Per-line GP | **−R126,645,678** |
| PRS `actual_revenue` summed by matching `project_id` (42 projects) | R357,393,120 |
| PRS `actual_revenue` — all active rows (admin surface) | R479,211,341 |

*(Full 42-row per-project table — id, name, contractValue, revenue, cost total, realised cost raw vs canonical, per-line revenue/GP, PRS actuals — is reproducible from the queries in the Appendix.)*

---

## Part C — snapshot integrity sweep

**Row counts (active = `effective_to IS NULL`):**

| Snapshot table | Active | Historical | Note |
|---|--:|--:|---|
| `normalized_cost_lines` | 3,445 | 10,035 | 2 duplicate-active groups (+3 extra rows) |
| `normalized_revenue_lines` | 253 | 252 | 2 duplicate-active groups (+2 extra rows) |
| `normalized_cost_line_actuals` | 49 | 82 | sparse — backfilled at runtime by `synthesizeActualsForParents` |
| `category_revenue_allocations` | 590 | 5,203 | |
| `project_revenue_summary` | **69** | 0 | **for only 42 projects** — see below |
| `tracker_revenue_summary` | 42 | 369 | |
| `cashflow_points` | **0** | 0 | **empty** |
| `finance_revenue_monthly` | **0** | 0 | **empty** |
| `finance_cos_monthly` | **0** | 0 | **empty** |

**One-active-row-per-natural-key invariant — VIOLATED for `project_revenue_summary`:**
- 69 active rows for 42 live projects.
- **27 active rows are orphans** (their `project_id` is not in `project_info`), contributing **R121,818,221 actual revenue / R119,209,796 planned revenue / R21,164,836 profit** of phantom value into any unfiltered `SUM`.
- **2 projects have duplicate active rows** where the two rows belong to *different* projects sharing one `project_id`: id 41 = {"12 Nourse", "Randfontein"}; id 42 = {"Maynard Mall Extension", "Red Rocket"}.
- This is exactly why the admin KPI-traceability surface reports `totalActualRevenue` **R479,211,341** vs the true canonical R371,364,217 (**+R107,847,124**, ~29% over-statement).

**Snapshot guard unit test:** `qa/tests/unit/finance-snapshot-guards.test.ts` — **11/11 pass**, but it runs on fixtures, **not** live data; it does not assert the PRS `project_id` ↔ `project_info.id` integrity that the live DB violates.

**Guard coverage grep (server/):** the canonical aggregate paths (`canonical-dashboard-kpi-service.ts:90-91,156-157,179,307`, `finance-line-level-repository.ts:291-296,334-339,354-358`, `portfolio-routes.ts:406-407,659-660`, `storage.ts:541,549,591,599`, `smart-import-routes.ts`, `deliverable-capture-routes.ts`) **do** apply `effective_to IS NULL` + `deleted_at IS NULL`. The gap is on the **snapshot tables that lack a `deleted_at` column** (PRS, `cashflow_points`, `category_revenue_allocations`, `finance_*_monthly`, `tracker_revenue_summary`) — they are filtered on `effective_to` only.

---

## Part D — known soft spots

1. **`cashflow_net` cannot be served from the snapshot.** `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` are all **0 rows**, so the admin cashflow KPI returns **R0 / 0 projects** and the "derived" fallback declared in the registry has no data. The number is only reconstructable on the fly from `normalized_*` payment dates (R21,706,093).

2. **`unmatched_cost_invoices` = 2,737 (every invoiced cost line)** because `quickbooks_invoice_links` is **empty (0 rows)**. The matching surface is non-functional, not "all unmatched by coincidence".

3. **Soft-delete inconsistency.** `deleted_at` exists on `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_cost_line_actuals`, `quickbooks_invoice_links` — but is **absent** on `cashflow_points`, `category_revenue_allocations`, `finance_revenue_monthly`, `finance_cos_monthly`, `project_revenue_summary`, `tracker_revenue_summary` (these use `effective_to` only). `derived_project_kpis` / `project_execution_state` use `deleted_at` + `is_active` (no `effective_to`); `budget_baselines` has neither. No active impact today, but the model is not uniform.

4. **PG vs SQLite parity (`canonical-dashboard-kpi-service.ts`).** Both branches apply `effective_to IS NULL` + `deleted_at IS NULL` (lines 90-91 PG / 156-157, 273, 307). Parity on guards is **OK**. The realised-cost predicate (colour-signal / `cosRealised` / `cosStatusOverride`) is the source of the R201M divergence from the invoice-based registry formula — a **definitional** mismatch, not a guard bug.

---

## Prioritised discrepancies

| # | Severity | Finding | Evidence | Rand impact |
|---|---|---|---|---|
| 1 | 🔴 Critical | `project_revenue_summary.project_id` is mis-keyed; per-project consumers serve the wrong project's finances | `project-v2-repository.ts:248`, `financial-review-service.ts:58` (join by `projectId`); live: PRS id=1 → "25 Superior Road" | wrong attribution on all 42 projects |
| 2 | 🔴 Critical | Gross profit irreconcilable across 3 surfaces | per-line repo `finance-line-level-repository.ts:~710`; PRS `actual_profit`; registry `gross_profit_realised` | −R126.6M / +R67.1M / +R104.3M (~R230M spread) |
| 3 | 🔴 Critical | Realised cost: invoice-based vs canonical colour-signal | `selected-truth-registry.ts` `cos_realised` vs `canonical-dashboard-kpi-service.ts:~270-310` | R267.1M vs R66.4M (Δ R200.7M) |
| 4 | 🔴 Critical | Admin KPI-traceability revenue over-stated by orphan + duplicate PRS rows | `kpi-traceability-repository.ts` `getKpiAggregates` SUM of all active PRS | +R107.8M (R479.2M vs R371.4M); orphans alone R121.8M |
| 5 | 🔴 High | `revenue_realised` registry formula matches no data | `selected-truth-registry.ts` (`status IN ('in_bank','realised')`); data only has `invoiced`/`paid` | formula → R0 vs intended R371.4M |
| 6 | 🔴 High | `cashflow_net` + monthly derived tables empty | `cashflow_points`/`finance_revenue_monthly`/`finance_cos_monthly` = 0 rows | served R0 vs true R21.7M |
| 7 | 🔴 High | `tracker_vs_app_drift` unresolvable | `selected-truth-registry.ts:232` `resolvedField:"manual_overrides"`; table absent | KPI cannot compute |
| 8 | 🟠 Medium | `unmatched_cost_invoices` = 2,737 (all) | `quickbooks_invoice_links` 0 rows | matching surface non-functional |
| 9 | 🟠 Medium | Registry references columns that don't exist | `project_info.status` (actual `project_status` enum + `is_active`); `normalized_cost_lines.status` (actual `cost_line_status`, no `approved` value); `cos_committed` uses these | committed maps to R349.9M via real column |
| 10 | 🟡 Low | Duplicate active rows in normalized tables | 2 groups each in cost (+3 rows) and revenue (+2 rows) | small double-count risk |
| 11 | 🟡 Low | Non-uniform soft-delete columns across finance snapshots | see Part D §3 | latent |
| 12 | 🟡 Low | Contract value = 0 on active projects 19, 40 | `project_info.contract_value` | margin baselines distort |

## Appendix — what reconciles cleanly (the trustworthy spine)

- **Revenue total** raw SQL = canonical `totalRevenue` = **R371,364,217** (per project and portfolio).
- **Cost total / budgeted** raw SQL = canonical `totalCost` = **R350,128,099**.
- **`recognisedRevenue`** (R223,312,159) = sum of the per-line revenue formula — internally consistent between `canonical-dashboard-kpi-service` and `finance-line-level-repository`.
- **paid cost** canonical (R349,658,124) = the cashflow cost-out leg.
- **`active_projects`** = 42 by both `project_status='active'` and `is_active=true`.
- All canonical aggregate code paths apply `effective_to IS NULL` + `deleted_at IS NULL`; PG/SQLite branches are at parity on guards.

**Reproduction:** raw SQL via `psql "$DATABASE_URL"` with the numeric-guard cast on `amount_ex_vat`; running-app values by invoking `getKpiAggregates()`, `getCanonicalFinanceByProjectIds(allIds)`, and `FinanceLineLevelRepository.getPortfolioFinanceLines(allIds)` in-process after `initializeDatabase()`. No code, schema, or data was modified by this audit.
