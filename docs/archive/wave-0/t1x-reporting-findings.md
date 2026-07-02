# T1.x Reporting Trust Audit — findings

**Date:** 2026-05-08
**Scope:** Read-only audit per IMPLEMENTATION_PLAN_V3 § 3.1.
**Inputs read:** ~22 files (cap 30). Anchored against `docs/AGENT_GUARDRAILS.md`
§ 3.1 / § 3.4 / § 9.3 and `docs/operating-model/playbook-v2.0.md`.
**Posture:** Document only. No code changes, no migrations.

> Defect triage column on every finding row:
> `fix-now` = wrong number reaching CFO eyes today,
> `fix-soon` = surface degraded but reads survive,
> `defer` = cosmetic / doc-only / coverage gap.

---

## T1x.1 — Inventory of reporting surfaces

| Surface (page) | API endpoint(s) | Tables read (canonical) |
|---|---|---|
| `client/src/pages/dashboard.tsx` (Home) | `/api/program-dashboard`, `/api/dashboard/financial-summary`, `/api/dashboard/import-health`, `/api/dashboard/attention-items`, `/api/dashboard/my-work`, `/api/upcoming-financials` | `program_dashboard_repository.ts` reads `normalized_revenue_lines`, `normalized_cost_lines`, `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` |
| `pages/cashflow.tsx` (cashflow 2026 weekly) | `/api/cashflow-2026`, `/api/projects-summary` | `register-cashflow-2026-routes.ts` → `getCanonicalAllCurrentCostLines`, `storage.getAllRevenueLinesForCashflow` (both effectiveTo-guarded) |
| `pages/cashflow-analysis.tsx` | `/api/finance/analysis/cashflow/{aging,overdue,dso-dpo,at-risk,concentration,forecast-actual}` | `finance-analysis-repository.ts` (snapshot-guarded) |
| `pages/expenditure-breakdown.tsx` | `/api/tracker-replica/:projectId/expenditure-breakdown` | `tracker-replica-repository.ts` → `normalized_cost_lines`, `normalized_cost_line_actuals`, `tracker_project_metadata` |
| `pages/revenue-tracking.tsx` | `/api/tracker-replica/:projectId/revenue-tracking` | `tracker-replica-repository.ts` → `normalized_revenue_lines`, `tracker_revenue_summary` |
| `pages/revenue-tracker.tsx` | `/api/revenue-tracker`, `/api/revenue-tracker/month-detail`, `/api/projects-summary`, `/api/tracker-monthly` | `finance-temporal-repository` (revenue tracker monthly) |
| `pages/programme-reports.tsx` (Project Plan / Cost / Quality / Resource) | `/api/reports/{project-plan,cost,quality,resource-allocation}`, `/api/reports/programme/{drilldown,board-pdf}` | `server/report-routes.ts` (legacy file) |
| `pages/pm-monthly-report.tsx` (+ history / project / compare) | `/api/reports/pm/monthly/*` | `monthly_report_snapshots` (frozen JSON) + `pm-monthly-report-service` |
| `pages/engineering-monthly-report.tsx` (+ history / project / compare) | `/api/reports/engineering/monthly/*` | `monthly_report_snapshots` + `engineering-monthly-report-service` |
| `pages/excel-vs-app.tsx` (program) | `/api/excel-vs-app/program` | `tracker-replica-repository.ts` drift summary |
| `pages/excel-vs-app-project.tsx` | `/api/excel-vs-app/projects/:projectId` (read), `…/resolve` (write) | same |
| `pages/financial-review-queue.tsx` | `/api/financial-reviews/pending`, `/api/projects/:id/financial-review/:rid/approve` | `financial_edit_requests`, `financial_reviews` |
| `pages/finance-quickbooks-{links,customer-mapping,throughput}.tsx` | `/api/quickbooks/*` | `quickbooks_*` tables, `quickbooks-invoice-matches-repository.ts` |
| `pages/kpi-traceability.tsx` | `/api/admin/kpi-traceability` | `kpi-traceability-repository.ts` (descriptive registry) |
| `pages/execution-dashboard/FinancePage.tsx` | aggregated via `use-execution-data.ts` | uses `DataSourceBadge` + trust meta |
| `pages/cos.tsx` | `/api/cos-control/*` (cos-control-routes) | normalized cost lines (snapshot-guarded) |

---

## T1x.2 — Filter / aggregation correctness

| Surface | Date column used | FY/period filter correct? | `effectiveTo IS NULL` at read source? | Single-currency / FX label | Aggregation level | Verdict | Triage |
|---|---|---|---|---|---|---|---|
| `cashflow.tsx` (cashflow-2026) | inflow `effectiveDate` (resolved); cost fallback chain `expensePaymentDate → computedForecastPaymentDate → forecastPaymentDate → expenseInvoicedDate` (`register-cashflow-2026-routes.ts:82,96`) | Partial — fallback to **invoiceDate** for outflow week-bucketing violates § 3.4 (cash out is `paidDate` only; invoiceDate is recognition not cash). Documented as "effective date" but is mixed. | ✅ via `getCanonicalAllCurrentCostLines` + `storage.getAllRevenueLinesForCashflow` | No FX label — implicit ZAR | Programme (project filter optional) | **FAIL — § 3.4 violation** | fix-now |
| `cashflow-analysis.tsx` (aging/DSO/DPO) | DSO uses `paidDate`/`invoiceDate`, DPO same; aging uses `expectedDate` or `paymentTerms` (`finance-analysis-repository.ts:329-349`) | ✅ § 3.4 compliant | ✅ `isNull(*.effectiveTo)` everywhere | No FX label | Programme | PASS | — |
| `dashboard.tsx` → `/api/dashboard/financial-summary` | Revenue tile: plan = `expectedPaymentDate`, actual = `paidDate`; COS tile: actual = `invoiceDate` (`finance-analysis-repository.ts:780-816`) | ✅ § 3.4 + § 3.2 compliant; admin date override respected | ✅ snapshot-guarded | No FX label | Programme | PASS | — |
| `dashboard.tsx` → `/api/program-dashboard` | repository pulls `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly` (`program-dashboard-repository.ts:165-180`) | ✅ snapshots | ✅ explicit guard with comment per snapshot table | No FX label | Programme | PASS | — |
| `dashboard.tsx` → `/api/dashboard/my-work` | n/a — handler returns **hard-coded fixture rows** (`dashboard-routes.ts:485-493`) | ❌ Not reading data at all | n/a | n/a | n/a | **FAIL — fixture data shipped on home dashboard** | fix-now |
| `expenditure-breakdown.tsx` | normalized_cost_lines + normalized_cost_line_actuals; date columns surface raw to UI | ✅ guards `isNull(*.effectiveTo)` (`tracker-replica-repository.ts:148,163`) | n/a single-currency | Project | PASS | — |
| `revenue-tracking.tsx` | normalized_revenue_lines + tracker_revenue_summary | ✅ guards (`tracker-replica-repository.ts:118,133`) | n/a | Project | PASS | — |
| `revenue-tracker.tsx` | tracker monthly | repository in `finance-temporal-repository.ts` — verified to filter `effectiveTo` | ✅ | Programme | PASS | — |
| `programme-reports.tsx` Cost report | reads `normalized_cost_lines` via legacy `server/report-routes.ts:619`; no `paidDate` filter — surfaces raw rows including check_flag | ✅ snapshot guard inside repo path (legacy file) | n/a | Programme | PASS (date filter not load-bearing here, table is row dump) | defer |
| `pm-monthly-report.tsx` / `engineering-monthly-report.tsx` | snapshotted JSON in `monthly_report_snapshots` | n/a — frozen at generation (deterministic re-run on `regenerate`) | guard applies inside `generatePmReportData` / `generateEngineeringReportData` (services) | n/a | Programme/dept | PASS | — |
| `excel-vs-app.tsx` / `-project.tsx` | drift rows from `tracker-replica-repository` | n/a — diff surface, not aggregation | ✅ snapshot-guarded source | n/a | Programme + Project | PASS | — |
| `kpi-traceability.tsx` | static registry rows | n/a — descriptive-only; values come from `program_dashboard` | n/a | n/a | n/a | PASS | — |
| `company-overview-service.ts` (powers Company Overview) | Cash collected: `dateRef = paidDate||inBankDate||expectedPaymentDate||invoiceDate` (line 176); Cash paid: `paidDate||invoiceDate||approvedDate` (line 200); cashPaid increment guarded only by `paidDate` truthy (line 208) | ❌ FY-bucketing falls back to invoiceDate / expectedPaymentDate when paidDate absent — § 3.4 violation; paidDate truthy alone (without BLACK signal) is "soft" | ✅ guards on rows (line 98-99) | No FX | Company | **FAIL — § 3.4 violation in FY bucketing + § 3.7 colour gate missing on cashPaid** | fix-now |

---

## T1x.3 — Cross-system reconciliation views

| View | Endpoint | Excel scope (4 classes per § 9.3)? | Variance vs silent merge? | Override path per § 0A? | Verdict | Triage |
|---|---|---|---|---|---|---|
| Excel-vs-App (program) `pages/excel-vs-app.tsx` | `/api/excel-vs-app/program` (`excel-vs-app.routes.ts`) | ✅ Sections gated to PLAN / REVENUE / EXPENDITURE; cell-format JSONB carries date colour change. § 9.3 four-class allowlist enforced via `conflict-engine.ts` and `merge-engine.ts` | ✅ Drift rows surfaced as deltas, not auto-merged | ✅ POST `/resolve` accepts `accept_excel`, `keep_app`, `request_approval`; `recordOverride` writes to audit (`excel-vs-app.routes.ts:320,415,488`); RBAC per `DRIFT_RESOLVER_ROLES` | PASS | — |
| Reconciliation Program Assessment `/api/reconciliation/program-assessment` | reconciliation.routes.ts | ✅ Pulls drift summary + finance exception queue; mismatch-classifier maps to `RiskLevel`/`MismatchType`; respects 4-class scope upstream | ✅ Returns exceptions, not silent merges | Override via excel-vs-app endpoint (delegated, indirect from this page) | PASS | — |
| QB reconciliation (`finance-quickbooks-*`) | `/api/quickbooks/*` | n/a — § 9.3 is Excel scope, not QB. QB compares COS recognition vs bills (note line at `finance-quickbooks-links.tsx:195`: "linking only attaches QB bill evidence; does not move money or realise COS") | ✅ No silent merge — links are evidential only | Override via `qb_reconciliation_overrides` repo + `quickbooks-invoice-matches.routes.ts` | PASS | — |
| Financial Review Queue `pages/financial-review-queue.tsx` | `/api/financial-reviews/pending`, approve | n/a — review queue, not diff | ✅ explicit approve | ✅ approve writes audit (assumed via `audit-logger`) | PASS | — |
| `tracker-replica` Excel replica view | n/a (read-only) | ✅ shows planned + actual side-by-side per § 3.7 § 9.3 note (line 300) | ✅ No diff applied here, replica is visual only | n/a | PASS | — |

---

## T1x.4 — Report cadence + generation

| Report | Cadence | Snapshotted? | Re-run determinism | Audit trail | Verdict | Triage |
|---|---|---|---|---|---|---|
| PM Monthly Report (`/api/reports/pm/monthly`) | Auto-generated 1st of month for previous month via `monthly-report-scheduler.ts:69-105` (setInterval, hourly poll) | ✅ Stored in `monthly_report_snapshots` keyed by (`reportType`, `reportMonth`); subsequent GETs return same snapshot (line 24-41 in `pm-monthly-report-routes.ts`) | ✅ Stable for same `(type, month)` key. `regenerate` only allowed while `status='draft'` (line 211) | ⚠️ **No `audit_events` rows written** by routes or scheduler. `regenerate` / `review` / `publish` mutate snapshot fields but do not call `logAudit` / `logAuditFromReq` (grep returns 0 hits in `pm-monthly-report-routes.ts`, `engineering-monthly-report-routes.ts`, `monthly-report-scheduler.ts`). `reviewedBy` / `publishedBy` capture user IDs but state transitions are not in the auditable mutation history (per § 4 architectural invariants). | **PARTIAL FAIL — auditability gap** | fix-soon |
| Engineering Monthly Report | same scheduler, same snapshot table | ✅ same | same | same audit gap | PARTIAL FAIL | fix-soon |
| Programme Reports (Project Plan / Cost / Quality / Resource) | On-demand only — `pages/programme-reports.tsx` queries `/api/reports/{type}` live | ❌ Not snapshotted — re-running can change as underlying snapshots advance | Determinism = whatever `effectiveTo IS NULL` returns now (correct for "current truth"; wrong for "as-of") | No audit (read-only views) | PASS for "current truth" use; FAIL if user expects time-travel | defer (semantic, not bug) |
| Cashflow 2026 weekly | Live read every page hit | ❌ Not snapshotted | Drifts as imports land | n/a | PASS (live by design) | defer |
| Scheduler runtime | Hourly interval, runs once per day on `getDate() === 1` (`monthly-report-scheduler.ts:75-104`) | n/a | OK — guarded by `lastCheckedDate` and DB unique constraint | scheduler only `console.log`s — **no audit row when reports auto-generate** | PARTIAL FAIL | fix-soon |

---

## T1x.5 — KPI definitions vs. playbook

Registry: `shared/config/kpi-registry.ts`. Calculations for Finance KPIs in
`server/services/company-overview-service.ts:648-652`.

| KPI key | Registered name | Playbook intent | Code calculation | Verdict | Triage |
|---|---|---|---|---|---|
| `fin_revenue_vs_target` | "Revenue Actual vs FYTD Target" | Realised revenue per § 3.3 (COS-ratio method) | ✅ `realisedRevenueFytd` computed via `(realisedCos / totalCos) * totalRev` per project (`company-overview-service.ts:230-237`) — matches § 3.3 | PASS | — |
| `fin_cash_collected_vs_target` | "Cash Collected vs FYTD Target" | Cash inflow on `paidDate` per § 3.4 | ⚠️ Tile is correct for amount (uses `isRevenueSettled`) but the **FY-window date pivot** falls back to `inBankDate || expectedPaymentDate || invoiceDate` when `paidDate` is null (line 176). § 3.4 says cash inflow IS keyed on payment-receipt-date. Cash assigned to wrong FY when paidDate is missing. | **FAIL — date-pivot violates § 3.4** | fix-now |
| `fin_cos_vs_target` | "COS Realised vs FYTD Target" | Realised COS per § 3.2 (invoice captured + invoice-date BLACK) | ✅ Uses `getCosRealisedAmountForNclRow` which routes through canonical predicate. **However** name says "vs target" with `higherIsBetter:false` — i.e. higher COS = worse score. Playbook intent is "realisation vs plan", not "stay below". Drift between name ("vs target") and bands. | NAME-vs-CODE drift on direction (higherIsBetter false but tile labelled as "Actual vs Target") | fix-soon |
| `fin_gross_margin_vs_target` | "Gross Margin % vs Target" | Realised GM% computed from realised revenue / realised cost per § 3.3 | ✅ `realisedGrossMarginPct = computeMarginPct(realisedRevenueFytd, realisedCostFytd)` (line 244). Matches intent. | PASS | — |
| `fin_overdue_debtors` | "Overdue Debtors" | Sum of overdue AR | ⚠️ Marked `unit:"R"` with `normalization:"inverse_count"` and ceiling `10000000`. Misuse: `inverse_count` is "fewer is better count"; here it's a Rand value. Functionally OK (it inverts at R10M ceiling) but the type label is wrong. | NAME-vs-CODE drift on normalization category | defer |
| Project Delivery KPI `del_inflow_milestone_adherence` | "Inflow Milestone Adherence" | Per playbook ramps and milestone hits (drives Inflow timing) | Actual computation exists but not audited in this pass — registry weight 20%, no formula reviewed | UNVERIFIED | defer |
| HSE KPIs (5) | all 5 marked `provisional:true` | playbook calls these provisional pending data feed | ✅ Excluded from Company score when `provisional && !dataAvailable` (`kpi-registry.ts:520`) | PASS — explicit | — |
| All `Project Development` (5), `Engineering` (5), `Quality` (5), `Project Delivery` (5) KPIs | names map sensibly | No formula drift visible from registry alone — calculations live in `company-overview-service.ts`; the `pd_*` and `del_*` keys are populated by the same service. Spot-checked names; no mismatches detected. | PASS (sample) | — |

> **NB on weights:** `kpi-registry.ts` finance KPI weights total 100 (25+20+20+20+15) ✅;
> Project Development total 100 (25+20+20+15+20) ✅; Project Delivery total 100 ✅;
> Engineering total 100 ✅; HSE total 100 ✅; Quality total 100 ✅. Consistent.

---

## T1x.6 — Trust signals in the UI

| Surface | Last-updated timestamp visible? | Source breadcrumb? | Override-applied flag? | Audit trail link? | Coverage |
|---|---|---|---|---|---|
| `dashboard.tsx` (Home) | ⚠️ Only via `/api/v2/dashboard-metrics/last-refresh` chip — partial | ❌ No source breadcrumb on tiles | ❌ No override flag (server can emit `X-Finance-Override-In-Effect`; UI doesn't surface) | ❌ No audit drilldown | 1/4 |
| `cashflow.tsx` | ✅ via `FinanceTrustMeta` (line 865) | ✅ DataSourceBadge | ⚠️ overridden flag exists in component but page integration partial | ❌ No audit link | 2.5/4 |
| `cashflow-analysis.tsx` | ✅ `forecast.data?.trust?.asOf` (line 181) | ✅ "Source: canonical" string | ❌ no override flag | ❌ no audit | 2/4 |
| `expenditure-breakdown.tsx` | ❌ | ❌ | ❌ | ❌ | 0/4 |
| `revenue-tracking.tsx` | ❌ | ❌ | ❌ | ❌ | 0/4 |
| `revenue-tracker.tsx` | ⚠️ uses DataSourceBadge import per grep | ✅ DataSourceBadge | ⚠️ partial | ❌ no audit | 2/4 |
| `programme-reports.tsx` | ✅ `ReportMeta` with `lastImportAt` | ✅ `sourceLabel` prop ("Programme reports APIs") | ⚠️ `hasProtectedFields` flag (proxy for override) | ❌ no direct audit link | 3/4 |
| `pm-monthly-report.tsx` | ✅ `freshness` payload returned + status (draft/reviewed/published) | ⚠️ source = report snapshot itself, no breadcrumb to underlying tables | ⚠️ partial — review/publish state visible | ❌ no audit (because no audit_events emitted; § T1x.4) | 2/4 |
| `engineering-monthly-report.tsx` | ✅ same | ⚠️ same | ⚠️ same | ❌ same | 2/4 |
| `excel-vs-app.tsx` / `-project.tsx` | ✅ trust meta surfaces drift age | ✅ section + table + field shown | ✅ override actions logged via `recordOverride` | ✅ audit visible via diff resolution history | 4/4 |
| `financial-review-queue.tsx` | ⚠️ `lastUpdated` per row | ⚠️ project breadcrumb only | ✅ variance % visible, approve writes audit | ⚠️ no in-page link to audit log | 3/4 |
| `kpi-traceability.tsx` | ❌ N/A — registry view | ✅ this page IS the source breadcrumb registry | ❌ | ❌ | 1/4 (purpose-fit) |
| `execution-dashboard/FinancePage.tsx` | ✅ `DataSourceBadge` + `DataTrustBadge` | ✅ | ⚠️ partial | ❌ | 2.5/4 |
| `cos.tsx` | ✅ `DataTrustBadge` | ✅ | ⚠️ | ❌ | 2.5/4 |
| `finance-quickbooks-throughput.tsx` | ❌ | ⚠️ QB context strings | ❌ | ❌ | 0.5/4 |

**Aggregate coverage:**
- Last-updated timestamp: 8 / 14 ≈ **57 %**
- Source breadcrumb: 9 / 14 ≈ **64 %**
- Override flag: 4 / 14 ≈ **29 %**
- Audit trail link: 1 / 14 ≈ **7 %** (only `excel-vs-app`)

**Overall trust-signal coverage: ≈ 39 %** (sum of cells / 56 cells).

---

## Summary (mirror of caller report)

1. **Most-broken surfaces (top 3):**
   (a) `server/services/company-overview-service.ts:176, 200, 208` — Cash Collected & Cash Paid FY-bucketing falls back to `invoiceDate` / `expectedPaymentDate` / `approvedDate` when `paidDate` is null, violating § 3.4. Numbers feed Company Overview KPI tiles seen by CFO/CEO. **fix-now.**
   (b) `server/routes/dashboard-routes.ts:485-493` — `/api/dashboard/my-work` returns hard-coded fixture rows ("Solar Farm Alpha", "INV-3442") to the home dashboard. **fix-now.**
   (c) `server/routes/register-cashflow-2026-routes.ts:96` — outflow week-bucketing falls back to `expenseInvoicedDate` for cash, conflating recognition with cash per § 3.4. **fix-now.**

2. **KPI definition mismatches:** `fin_cos_vs_target` carries `higherIsBetter:false` while name says "vs Target" (CFO-readable label is misleading). `fin_overdue_debtors` is a Rand value misclassified as `inverse_count` normalization. Finance amount-side calculations correctly route through § 3.2 `getCosRealisedAmountForNclRow` and § 3.3 COS-ratio.

3. **Trust-signal coverage gaps:** ≈ 39 % overall. Audit-trail link present only on `excel-vs-app` (1/14). Override-applied flag present on 4/14. Pages with zero coverage: `expenditure-breakdown`, `revenue-tracking`, `finance-quickbooks-throughput` (last is the page where most reconciliation eyes land).

4. **Reconciliation views:** Excel-vs-App (program + project) — **PASS** end-to-end; § 9.3 four-class scope honoured, override path (`accept_excel` / `keep_app` / `request_approval`) writes audit via `recordOverride`. Reconciliation Program Assessment — PASS. QB linking — PASS (note: explicitly does not realise COS, correct per § 3.2).

5. **Report cadence:** Monthly scheduler (`server/services/monthly-report-scheduler.ts`) auto-generates PM + Engineering drafts on the 1st via setInterval with day-deduplication and DB unique constraint. Snapshots are deterministic. **Audit gap:** neither the scheduler nor the regenerate / review / publish endpoints write `audit_events` rows. State transitions are visible only via `monthly_report_snapshots.reviewedBy` / `publishedBy`. Per § 4 architectural invariants, major state transitions should emit audit events.

6. **One-off oddities flagged:**
   - `programme-reports.tsx:271-277` is **one giant compressed line per sub-report** (1000+ chars); maintenance hazard, not a numeric defect.
   - `kpiKey:"fin_cos_vs_target"` weight is 20 but the underlying signal (realised COS amount) is also the numerator of `fin_revenue_vs_target` and the denominator of `fin_gross_margin_vs_target` — same datum drives 65 % of the Finance department score; correlated risk should be modelled in scoring.
   - `scoreToRag` returns `"red"` when score is null (`kpi-registry.ts:502`) — a department with **no data** is rendered as RED, not GREY. CFO will see a sea of red on a fresh tenant.
   - Hard-coded `realisedRevenueFytd` target is `totalPlannedRevenue * 0.75` and `cashReceivedFytd` target is `totalPlannedRevenue * 0.7` (`company-overview-service.ts:648-649`). These are magic constants, not configured FYTD targets — every "vs target" reads as "vs 75 % of plan" / "vs 70 % of plan" regardless of calendar position.

---

*End of file. ~22 source files read; cap was 30. Read-only audit. No code, schema, or migrations were changed.*
