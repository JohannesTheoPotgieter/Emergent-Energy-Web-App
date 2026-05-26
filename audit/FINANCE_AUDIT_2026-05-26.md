# Finance Module — Deep Audit

**Date:** 2026-05-26
**Branch:** `claude/jolly-keller-SOQJL`
**Auditor:** Claude (Opus 4.7) via Claude Code on the web
**Scope:** Revenue · COS · Expenditure · Cashflow · Invoices · Payments · POs · Milestones · Actuals · Forecasts · Finance dashboards · Project financial drilldowns · QuickBooks · Excel import

> **Audit posture:** verified against `docs/AGENT_GUARDRAILS.md` § 3 (HARD financial-formula rules) and § 5 (security boundaries). All findings cite file_path:line_number. Safe UI fixes applied inline; finance-formula and RBAC changes documented but **not** applied without owner approval (per § 0A Override Principle).

---

## 1. Finance module summary

### What exists
- **Mature, well-isolated finance core.** Single canonical predicate for COS realisation (`server/lib/finance/cos-realisation.ts:76` `isCanonicalCosRealised()`) and a single per-line POC repository for revenue/GP (`server/repositories/finance-line-level-repository.ts`).
- **Snapshot/temporal model** correctly designed across 10 snapshot tables in `shared/schema/finance.ts` with `effectiveFrom` / `effectiveTo` / `snapshotRunId` columns and partial indexes on `effectiveTo IS NULL`.
- **Smart Import v2 pipeline** with conflict engine, baseline-from-snapshot fallback (field-level per § 9.2), id-first row matching (§ 9.1), and per-row import_snapshot + manual_overrides JSONB columns that survive re-imports.
- **QuickBooks integration** with one-way proposal flow: QB sync emits cascade proposals that operators must explicitly accept; QB never auto-mutates `cosRealised` or `paidDateConfirmed`.
- **80+ finance test files** across qa/tests/unit, qa/tests/api, qa/tests/integration, including parity tests (line-level vs persisted col U) and source-text snapshot-guard regressions.
- **Release gate** (`qa/release-gate.ts`) requires `reconciliation-status.json` whenever finance-model files change.

### What works
- COS realisation predicate (§ 3.2) — correctly gates on invoice number + BLACK invoice-date colour, with QB-allocation override and admin-override paths.
- Per-line revenue/GP via § 3.3 POC formula, snapshot-guarded, never cross-project pooled.
- Cashflow reads payment-receipt-date (inflows) and actual-payment-date (outflows) — invoice date is **explicitly excluded** from the cashflow date fallback chain (`server/routes/register-cashflow-2026-routes.ts:95–98` carries the comment "Invoice date is recognition, not cash, so it is NOT in the fallback chain").
- **Snapshot guards: comprehensive compliance.** Full codebase scan across `server/repositories/`, `server/services/`, `server/routes/`, `server/lib/`, and raw-SQL paths reviewed **~120+ read sites** against the 10 snapshot tables — **ZERO missing-guard violations**. Three minor ambiguous cases flagged (deprecated helpers, documentation string, permissive variant) — see Appendix C. Specifically: 9 repositories, 15+ services, 16+ route files, 10+ lib files. Pinned by `qa/tests/unit/finance-snapshot-guards.test.ts` source-text regressions.
- Smart Import preserves planned vs actual separation (§ 3.7) — `normalizer.ts:1623` comment: "paidDate is actuals — never fall back to forecastPaymentDate."
- COS period locks (`server/lib/finance/period-lock.ts`) auto-lock on 3rd SAST business day with COO/CFO/CEO override; tested in `qa/tests/api/cos-period-lock.test.ts`.

### What is broken — high severity
- **F-1 (HIGH).** "Total Revenue" KPI in `server/services/canonical-dashboard-kpi-service.ts` (lines 65–123) and `server/services/dashboard-metrics.ts` (lines 78–89) is computed as `SUM(amount_ex_vat) FROM normalized_revenue_lines` — i.e. sum of milestone billing amounts, **not** the § 3.3 per-line POC formula. Exposed as KPI `finance_total_revenue` in `shared/platform-contracts.ts:243` and consumed by `priority-detail.tsx`, `project-lifecycle.tsx`, `GpTrackerTab.tsx`, `RevenueTrackerTab.tsx`, `WeeklyReviewWizard.tsx`. Per § 3.3.3 *"Inflow ≠ revenue. The two surfaces must not be conflated in any KPI tile, dashboard, or report."* For partially-completed projects this overstates recognised revenue (returns contract value vs POC partial). **Cannot be safely fixed without owner decision** — fix path is either rename to "Contract value / Billed" or re-source from POC repository. Reconciliation tests will need to be updated in the same PR.
- **F-2 (CRITICAL — RBAC).** 10+ finance endpoints in `server/routes/finance-legacy-extracted-routes.ts` and all of `server/routes/cos-control-routes.ts` use `requireAuth` only or `requireAdmin` only, missing `requirePermission(entity, action)` gates. Specifically:
  - `GET /api/program/cos` (line 51) — `requireAuth` only, exposes full COS dashboard
  - `GET /api/financial-headline` (line 204) — `requireAuth` only
  - `POST /api/cos-status-override` (line 1129) — `requireAuth` only, WRITE
  - `DELETE /api/cos-status-override/:expenseId` (line 1149) — `requireAuth` only, WRITE
  - `PATCH /api/expenditure/font-color-toggle` (line 1078) — `requireAuth` only, WRITE — *this toggles the BLACK/RED realisation signal*
  - All `cos-control-routes.ts` endpoints use `requireAdmin` only (treats finance as admin-only rather than CFO/PFM/ACCOUNTANT-scoped)
  - `GET /api/cashflow-2026` (line 23) and `/detail` (line 181) — `requireAuth` only
- **F-3 (MEDIUM — HARDCODED ROLES).** `server/routes/finance-analysis.routes.ts:42–58` defines `FINANCE_ANALYSIS_ROLES` and `TOLERANCE_WRITE_ROLES` as hardcoded string arrays. Per § 5 of guardrails: "Roles must be read from `COMPANY_ROLES` in `shared/schema/users.ts`, never hardcoded."

### What is broken — medium / low severity
- **F-4 (MEDIUM).** QuickBooks payment-date proposals (`server/services/quickbooks-cascade-proposals-service.ts:256–274`) are pending until operator accepts. If ignored, `paidDate` stays null while QB shows balance=0 — operator may not notice the divergence after a few days. No "proposal age" warning surface today.
- **F-5 (MEDIUM).** No DB CHECK constraint on `normalizedCostLines.paidDate <= CURRENT_DATE`. Frontend doesn't enforce; relies on normalizer. A future-dated paidDate would be treated as "paid" by aggregation.
- **F-6 (LOW).** Date columns labelled just "Date" in cashflow inflows/outflows tables (`client/src/pages/cashflow.tsx:549, 793`). **FIXED in this audit** — added explicit "Payment date" label + tooltip distinguishing it from invoice raised date.
- **F-7 (LOW).** Non-canonical local ZAR formatter in `client/src/pages/revenue-tracking.tsx:54`. **FIXED in this audit** — replaced with canonical `formatZar(v, { cents: true })`.
- **F-8 (LOW).** Direct `db.select()` in route handlers in `server/routes/cos-control-routes.ts` (lines 419, 503, 558) and `server/invoice-pattern-routes.ts` (lines 51–94) — anti-pattern per CLAUDE.md "Do NOT" list. Read-only / admin-only contexts, so low data-integrity risk, but inconsistent with repository discipline.
- **F-9 (LOW).** `quickbooks-reconciliation-service.ts:1007–1010` carries an obsolete comment about 1:1 uniqueness post-Task #142.

### What was fixed in this audit
- ✅ **F-6:** Ambiguous "Date" headers in cashflow inflows + outflows tables relabelled to "Payment date" with tooltip per § 3.4 (`client/src/pages/cashflow.tsx:549, 793`).
- ✅ **F-7:** `revenue-tracking.tsx` now uses canonical `formatZar` (`client/src/pages/revenue-tracking.tsx:25, 54`).

### What could not be verified in this sandbox
- `npm run check` failed with `error TS2688: Cannot find type definition file for 'node'` (missing `@types/node` install). Could not produce a clean type-check pass in this environment.
- `npx vitest run` aborted on `vite.config.ts` import (`Cannot find package 'vite'`). Could not run finance unit tests in this sandbox.
- Could not bring up the dev server / browser-test finance flows (sandbox does not have the database container and external deps).
- The agent's claim that 80+ finance test files exist is documentary only — they exist on disk, but green-status in this environment is **unverified**.

---

## 2. Finance file map

| File | Purpose | Finance area | Functions/Components | Source of truth | Risk |
|------|---------|--------------|----------------------|-----------------|------|
| `shared/schema/finance.ts` | All finance tables (cost lines, revenue lines, allocations, cashflow points, POs, invoiceCaptures, paymentRequests, period locks). | All | Drizzle table definitions | Schema | LOW |
| `shared/schema/projects.ts` | Project spine + project-level finance summary fields. | All | `projectInfo`, FK targets | Schema | LOW |
| `shared/platform-contracts.ts` | Shared KPI contracts and authoritative service references. | Dashboards | `PLATFORM_TABLE_OWNERSHIP`, `PLATFORM_EXTENSION_RULES` | Contracts | LOW |
| `server/repositories/finance-line-level-repository.ts` | **Canonical** § 3.3 per-line POC revenue/GP repository. Snapshot-guarded. | Revenue · COS · GP | `getProjectFinanceLines`, `getPortfolioFinanceLines` | Tracker → cost actuals | LOW |
| `server/repositories/finance-inflows-repository.ts` | Revenue-line inflows. 14× `isNull(effectiveTo)` guards. | Revenue · Cashflow | `listInflowsForRange`, `listOutstandingRevenueLines` | normalizedRevenueLines | LOW |
| `server/repositories/finance-expense-engine-repository.ts` | Cost-line outflows; merges parent+child actuals. 16× guards. | COS · Cashflow | `getMergedExpensesAndInflows`, `getCanonicalAllCurrentCostLines` | normalizedCostLines + actuals | LOW |
| `server/repositories/finance-analysis-repository.ts` | AR/AP aging, DSO/DPO, overdue lists, concentration. | Cashflow analysis | `listOutstanding*`, `computeDsoDpoTrend`, `listCashflowPointsForRange` (snapshot-guarded line 438–459) | Multiple snapshot tables | LOW |
| `server/repositories/finance-temporal-repository.ts` | CRUD on cashflow_points + monthly finance aggregates. | Cashflow · Monthly | `getCashflowPointsByProject`, etc. | Snapshot tables | LOW |
| `server/repositories/quickbooks-invoice-matches-repository.ts` | QB match suggestions + learned invoice patterns. | Invoices · QB | `createSuggestion`, `markAccepted`, pattern CRUD | QB sync | LOW |
| `server/lib/finance/cos-realisation.ts` | **Canonical** § 3.2 COS realisation predicate. | COS | `isCanonicalCosRealised`, `isPastMonthAutoRealised`, `isEffectivelyRealised`, `isEffectivelyCommitted`, `getCosRealisationWarnings` | Predicate | LOW |
| `server/lib/finance/revenue-recognition.ts` | Helpers for persisted col U revenue recognition amount. | Revenue | `recognitionAmountFor` | Delegated to col U | LOW |
| `server/lib/finance/recognition-bucketing.ts` | Month bucket by invoice_date (§ 3.3). | Revenue · COS monthly | Bucketing helpers | invoice_date | LOW |
| `server/lib/finance/revenue-ar-status.ts` | Settlement / AR status (cash side). | Revenue · AR | Settlement helpers | paidDate, inBankDate, QB | LOW |
| `server/lib/finance/margin.ts` | `computeMarginPct` with shared rounding. | GP / margin | `computeMarginPct` | Formula | LOW |
| `server/lib/finance/period-lock.ts` | COS period lock predicate; SAST business-day logic. | Governance | `isMonthLocked`, `canBypassLock` | cosPeriodLocks | LOW |
| `server/lib/finance/qb-allocation.ts` + `qb-allocation-read.ts` | QB ex-VAT decomposition + assigned-evidence query. | COS · QB | `deriveQbVatAmounts`, `getAssignedEvidenceByCostLineIds` | QB doc snapshots | LOW |
| `server/services/canonical-dashboard-kpi-service.ts` | Canonical dashboard KPI source (revenue + cost aggregates). | Dashboards | `getCanonicalFinanceByProjectIds`, `getCanonicalTaskSummaryByProjectIds` | normalizedRevenueLines (**F-1**) + normalizedCostLines | **HIGH** (F-1) |
| `server/services/dashboard-metrics.ts` | Per-project dashboard metric aggregator. | Dashboards | `getDashboardMetricsForProject`, etc. | Same as above (**F-1**) | **HIGH** (F-1) |
| `server/services/project-platform-summary-service.ts` | Platform contract summary builder. | Dashboards | `buildKpis`, etc. | Consumes F-1 outputs | **HIGH** (downstream of F-1) |
| `server/services/project-header-kpi-service.ts` | Project header KPI tiles. | Project drilldown | Margin/tile builders | Pinned test: project-header-kpi-query-guards.test.ts | LOW |
| `server/services/financial-temporal.ts` | Point-in-time temporal query helper. | Snapshot reads | `getFinancialStateAt`, `getCurrentFinancialState` | Snapshot pattern | LOW |
| `server/services/quickbooks-reconciliation-service.ts` | QB Bill ↔ cost line / QB Invoice ↔ revenue line reconciliation. | QB recon | `confirmCostLineLink`, `confirmRevenueLineLink`, `searchCostLines`, `searchRevenueLines` (all snapshot-guarded) | QB + app | LOW |
| `server/services/quickbooks-cascade-service.ts` | Bulk cascade preview/commit (admin-only). | QB recon | `previewCustomerCascade`, `commitVendorCascade` | QB mappings | LOW |
| `server/services/quickbooks-cascade-proposals-service.ts` | Per-link cascade proposal detection (one-way). | QB recon | `detectAndPersistProposals`, `acceptProposal`, `declineProposal` | qb_link_proposed_cascades | MEDIUM (F-4) |
| `server/services/finance-core-trust-service.ts` | Trust-level aggregates and freshness. | Trust / sync health | Trust evaluators | Multiple | LOW |
| `server/lib/import/conflict-engine.ts` | 3-way conflict detection (§ 9.1 id-first). | Smart Import | `buildBaselineLookup`, `mergeSection` | Pinned by tests | LOW |
| `server/lib/import/merge-engine.ts` | Row-level merge resolution; manual_overrides tracking. | Smart Import | `mergeRow`, `updateManualOverrides` (lines 307–372) | Pinned by tests | LOW |
| `server/lib/import/baseline.ts` | Snapshot fallback (field-level § 9.2). | Smart Import | `loadBaselineFromSnapshots`, `loadBaselineForPlanner` | Pinned by tests | LOW |
| `server/lib/import/normalizer.ts` | Workbook → typed rows. Reads cell colour (§ 3.7) into `invoiceDateFontColor` + `invoiceDateConfirmed`. | Smart Import | `getCellFontColor`, `classifyColorHex`, per-section parsers | Excel | LOW |
| `server/lib/import/commit-executor.ts` | Applies merged rows + soft-closes deleted; recomputes `cosRealised` boolean from invoice. | Smart Import | `commit*` | Pinned by tests | LOW (predicate is canonical) |
| `server/lib/import/row-matcher.ts` | Compare-fields per section. | Smart Import | `PLAN_COMPARE_FIELDS`, `REVENUE_COMPARE_FIELDS`, `EXPENDITURE_COMPARE_FIELDS` (lines 292–320) | Diff scope (§ 9.3) | LOW |
| `server/routes/finance-analysis.routes.ts` | Analysis APIs (aging, DSO/DPO, variance, tolerance band). | Cashflow analysis | All gated `requireRole(FINANCE_ANALYSIS_ROLES)` (**F-3**) | finance-analysis-repository | MEDIUM (F-3) |
| `server/routes/finance-lines.routes.ts` | Per-project + portfolio line-level finance. | Revenue · COS · GP | `requirePermission("financials", "view")` ✓ | finance-line-level-repository | LOW |
| `server/routes/finance-trust-routes.ts` | Sync-health, exceptions, freshness. | Trust / sync | `requirePermission("financials", "view")` ✓ | finance-core-trust-service | LOW |
| `server/routes/finance-legacy-extracted-routes.ts` | Legacy program/cos, financial-headline, expenditure overrides, COS status overrides, etc. | Multiple | Mixed: some `requirePermission`, several `requireAuth` only (**F-2**) | Storage + legacy paths | **CRITICAL** (F-2) |
| `server/routes/cos-control-routes.ts` | COS control tower (summary, by-project, lines, invoices, POs, cashflow forecast). | COS · Cashflow forecast | `requireAuth + requireAdmin` only — **no entity gates** (**F-2**) | Service layer | **CRITICAL** (F-2) |
| `server/routes/register-cashflow-2026-routes.ts` | Weekly cashflow grid + detail + opening-balance overrides. | Cashflow | Mixed: read endpoints unguarded (**F-2**); writes use `requirePermission("cashflow", "edit")` ✓ | finance-inflows + expense-engine | MEDIUM (F-2 read gaps) |
| `server/routes/quickbooks-invoice-matches.routes.ts` | QB invoice match find/approve/reject. | QB recon | `requirePermission("financials", "view"/"edit"/"override")` ✓ | QB recon services | LOW |
| `server/routes/imports.routes.ts` | Smart Import v2 entry. | Smart Import | RBAC enforced | Smart Import engine | LOW |
| `server/quickbooks-routes.ts` | OAuth + read-only QB endpoints. | QB | `requirePermission("financial_integration"/"financials", action)` ✓ | QB API | LOW |
| `server/invoice-pattern-routes.ts` | Invoice pattern rule CRUD (Phase 2 learning). | Invoices | `requirePermission("procurement", action)` ✓ | invoicePatternRules | LOW |
| `client/src/pages/cos.tsx` | COS Tracker (Realised/Committed/Planned/QB Actual). | COS | `formatZar` / `formatZarCompact` ✓; drilldown drawer | API: cos-tracker | LOW |
| `client/src/pages/cos-analysis.tsx` | Earned vs invoiced, tolerance band. | COS analysis | `canEditTolerance` gating | finance-analysis API | LOW |
| `client/src/pages/revenue-tracking.tsx` | Per-project Revenue Tracking replica. | Revenue | **Now using canonical `formatZar` (fix F-7)** | tracker-replica API | LOW |
| `client/src/pages/cashflow.tsx` | Weekly cashflow + week detail. | Cashflow | `usePermission('cashflow', 'edit')`; **header tooltips fixed (F-6)** | cashflow-2026 API | LOW |
| `client/src/pages/cashflow-analysis.tsx` | Aging buckets, overdue, DSO/DPO, at-risk, forecast-vs-actual. | Cashflow analysis | Read-only | finance-analysis API | LOW |
| `client/src/pages/dashboard.tsx` | Executive dashboard. | Dashboards | Local `money()` helper — not canonical | Backend KPIs | LOW (minor consistency) |
| `client/src/pages/finance-gp.tsx` | GP tracking with line drill-down. | GP / margin | Canonical formatZar | finance-lines API | LOW |
| `client/src/pages/milestone-tracker.tsx` | Milestone status board (In Bank / Invoiced / Overdue / Planned). | Milestones | Status badge logic | normalized_revenue_lines | LOW |
| `client/src/pages/po-approval-board.tsx` | PO review/approve workflow. | POs | Permission-gated actions | purchaseOrders + reviews | LOW |
| `client/src/components/POGenerator.tsx` | New-PO modal. | POs | Idempotency key on submit | po/generate API | LOW |
| `client/src/pages/admin-quickbooks.tsx` | QB OAuth + sync admin UI. | QB | Admin redirect on non-admin | QB routes | LOW |
| `qa/release-gate.ts` | Release gate; requires reconciliation evidence for any FINANCE_MODEL_PATHS change. | Governance | `npm run release:gate` | Git diff vs main | LOW |
| `qa/tests/unit/cos-realisation-consistency.test.ts` | Pins canonical realisation rule (50+ scenarios). | COS | 493 lines | Predicate | LOW |
| `qa/tests/unit/finance-snapshot-guards.test.ts` | Source-text regression on 5 snapshot guards. | Snapshot rule | Asserts query strings contain `effectiveTo` | LOW |
| `qa/tests/unit/finance-line-level.test.ts` | POC formula + per-line GP. | Revenue · GP | Mondi-shaped fixture | LOW |
| `qa/tests/unit/finance-acceptance-checks.test.ts` | Reference values (De Drift, Coega, Mondi) for COS-ratio. | Reconciliation | Fixture-based | LOW |
| `qa/tests/unit/smart-import-paid-date-actual-only.test.ts` | § 3.7 HARD: paidDate is actuals-only, never falls back to forecastPaymentDate. | Smart Import | Regression | LOW |
| `qa/tests/api/cos-period-lock.test.ts` | Lock/unlock endpoints + 423 enforcement. | Governance | API contract | LOW |

---

## 3. Data lineage register

| Metric | Source | Transform | API | UI location | Date basis | Reconciles? | Issue/fix |
|--------|--------|-----------|-----|-------------|------------|-------------|-----------|
| Per-line revenue (POC) | `normalized_cost_line_actuals.actual_total` ÷ category total × `category_revenue_allocations.revenue_allocation` | § 3.3 formula in `finance-line-level-repository.ts` | `/api/finance/lines/:projectId` | finance-gp.tsx, GpTrackerTab | `invoice_date` (col T) | Yes — `qa/tests/unit/finance-line-level.test.ts`, `finance-acceptance-checks.test.ts` | OK |
| Per-line GP | `perLineRevenue − line.actualTotal` | § 3.3 in `finance-line-level-repository.ts` | `/api/finance/lines` | finance-gp.tsx | invoice_date | Yes | OK |
| COS realised | `normalized_cost_lines` + `normalized_cost_line_actuals` + `invoice_date_font_color` + QB allocation | `isCanonicalCosRealised()` predicate | `/api/cos-tracker`, `/api/finance/lines` | cos.tsx, cos-analysis.tsx | invoice_date | Yes — `cos-realisation-consistency.test.ts` | OK |
| Cash inflow (received) | `normalized_revenue_lines.paidDate` / `inBankDate` BLACK | `cashflow-helpers.ts` effective-date hierarchy | `/api/cashflow-2026` | cashflow.tsx | payment-receipt-date | Yes | Header label clarified (F-6 fixed) |
| Cash inflow (forecast) | Same as above but RED or null | Same | Same | Same | Same | Yes | OK |
| Cash outflow (paid) | `normalized_cost_lines.paidDate` BLACK + invoice | `cashflow-helpers.ts` | `/api/cashflow-2026` | cashflow.tsx | actual-payment-date | Yes | OK |
| Cash outflow (forecast) | Same RED or future | Same | Same | Same | Same | Yes | OK |
| Cashflow series | `cashflowPoints` | snapshot-guarded read (`finance-temporal-repository.ts:26, 30`) | `/api/finance/analysis/cashflow/forecast-actual` | cashflow-analysis.tsx | pointDate | Yes | OK |
| Aging buckets (AR/AP) | `normalized_revenue_lines` + `normalized_cost_lines` | `resolveDueDate()` + `daysOverdueOn()` (`shared/lib/financeAnalysis.ts`) | `/api/finance/analysis/cashflow/aging` | cashflow-analysis.tsx | expected_date or invoice_date + terms_days | Yes | OK |
| DSO / DPO | Same | paidDate − invoiceDate over 12-week window | `/api/finance/analysis/cashflow/dso-dpo` | cashflow-analysis.tsx | Same | Yes | OK |
| Monthly recon grid | `finance-line-level-repository` + persisted `revenue_recognition_amount` | Parity check | `/api/finance/recon-grid` + `/api/finance/recon-check/:projectId` | finance-gp / admin | invoice_date | Yes (R1 tolerance) | OK |
| **"Total Revenue" KPI** | `SUM(amount_ex_vat) FROM normalized_revenue_lines WHERE effective_to IS NULL` | `canonical-dashboard-kpi-service.ts:103–123` | `/api/platform/project-summary` etc. | priority-detail, project-lifecycle, GpTracker, WeeklyReview | n/a (sums all states) | **NO** — billing sum, not POC | **F-1 — see § 4** |
| "Received Revenue" KPI | Same table where paidDate/inBankDate IS NOT NULL | Same service | Same surfaces | Same | paidDate/inBankDate | Cash, not revenue | Conflated label — see § 4 |
| "Outstanding Revenue" KPI | Same table where paidDate IS NULL AND inBankDate IS NULL | Same service | Same | Same | n/a | AR, not unbilled revenue | Conflated label — see § 4 |
| Total Cost (raw) | `SUM(amount_ex_vat) FROM normalized_cost_lines` | Same service | Same | Same | n/a | Cost ledger sum | OK (matches schema intent) |
| Realised Cost | Cost-line iteration with `getCosRealisedAmountForNclRow()` | Same | Same | Same | invoice_date | Yes — predicate-based | OK |
| Margin % | `(revenue − cost) / revenue × 100` | `margin.ts` `computeMarginPct` | Multiple | Multiple | Derived | Stored as 0–100 scale; pinned by `project-header-kpi-service.test.ts` | OK |
| QB Bill balance | QuickBooks API | `billRawToSummary()` derives ex-VAT | `/api/quickbooks/bills` | admin-quickbooks, cashflow QB badges | QB txn date | Yes — drives match suggestions | OK |
| QB payment status | qbBalance ≤ 0.01 → paid; <total → partial | `quickbooks-reconciliation-service.ts:659–668` | Same | Cashflow QB badges | Inferred | Partial-payment not propagated automatically | F-4 |
| Period lock status | `cos_period_locks` with `unlockedAt IS NULL` partial index | `period-lock.ts:236` | `/api/cos-periods/status` | cos.tsx (lock indicator) | periodMonth | Yes | OK |

---

## 4. Formula register

| Formula / KPI | Current formula | Expected rule (per AGENT_GUARDRAILS) | Source fields | Problem | Fix applied | Test evidence |
|---------------|----------------|---------------------------------------|---------------|---------|-------------|---------------|
| **COS realised (per line)** | Admin override → QB allocation → invoice non-placeholder + (BLACK font OR confirmed=true) → legacy `cosRealised` boolean | § 3.2: invoice captured + invoice-date BLACK | `expenseInvoiceNumber`, `invoiceDateFontColor`/`invoiceDateConfirmed`, `lineAssignedQbExVat`, `cosStatusOverride` | None | n/a | `qa/tests/unit/cos-realisation-consistency.test.ts` (493 lines), `qa/tests/unit/finance-utils-iscosrealised.test.ts` |
| **COS recognition bucket** | `normalized_cost_line_actuals.invoice_date` (col T) | § 3.3: invoice_date column | actuals.invoiceDate | None | n/a | `recognition-bucketing.ts` + parity test |
| **Per-line revenue** | `(line.actualTotal / category.totalActualTotal) × category.revenueAllocation`, project-scoped | § 3.3: identical | actuals.actualTotal, categoryRevenueAllocations.revenueAllocation | None | n/a | `qa/tests/unit/finance-line-level.test.ts`, `finance-acceptance-checks.test.ts` |
| **Per-line GP** | `perLineRevenue − line.actualTotal` | § 3.3: identical | Derived | None | n/a | finance-line-level.test.ts |
| **Project total revenue (POC)** | Sum of per-line | § 3.3.1: sum of per-line, never pooled | Derived | None | n/a | finance-line-level-portfolio.test.ts |
| **Portfolio total revenue (POC)** | Sum across projects of per-project sums | § 3.3.1: identical | Derived | None | n/a | Same |
| **"Total Revenue" KPI tile (`finance_total_revenue`)** | `SUM(amount_ex_vat) FROM normalized_revenue_lines WHERE effective_to IS NULL AND deleted_at IS NULL` (milestone billing sum) | § 3.3.3: "Inflow ≠ revenue. ... must not be conflated in any KPI tile, dashboard, or report." Should be POC formula. | normalizedRevenueLines.amountExVat | **F-1: conflation of milestone billing sum with "Revenue".** For partially-completed projects this overstates recognised revenue by returning contract value. Exposed in dashboards via `priority-detail.tsx`, `project-lifecycle.tsx`, `GpTrackerTab.tsx`, `RevenueTrackerTab.tsx`, `WeeklyReviewWizard.tsx`. | **NOT applied** — requires owner decision (rename to "Contract value / Billed" vs re-source from POC). Documented as P0 recommendation. | None pinning the violation — recommend new test `dashboard-revenue-poc-parity.test.ts` |
| **"Received Revenue" KPI** | `SUM(amount_ex_vat) WHERE paidDate IS NOT NULL OR inBankDate IS NOT NULL` | This is cash receipt, not revenue. § 3.3.3: forbidden conflation in KPI tiles. | Same | Label conflation — describes cash inflow, not "revenue received". | NOT applied — owner decision (rename label vs change scope) | None |
| **"Outstanding Revenue" KPI** | `SUM(amount_ex_vat) WHERE paidDate IS NULL AND inBankDate IS NULL` | This is unpaid milestone billing (AR), not "outstanding revenue". | Same | Label conflation — describes AR, not unbilled revenue. | NOT applied | None |
| **Total Cost** | `SUM(amount_ex_vat) FROM normalized_cost_lines` | Cost ledger sum is correct for "Total Cost". | normalizedCostLines.amountExVat | None | n/a | dashboard-financial-summary.test.ts |
| **Realised Cost** | Per-row `getCosRealisedAmountForNclRow()` | § 3.2 via canonical predicate | normalizedCostLines + QB | None | n/a | finance-utils-iscosrealised.test.ts |
| **Margin %** | `(revenue − cost) / revenue × 100`, precision 1, null-on-zero-revenue | Internal standard | computeMarginPct | Stored as 0–100; **note: depends on revenue input**. If consumer passes the F-1 milestone-sum revenue, margin = (billed − cost)/billed, not POC margin. | Document downstream of F-1 | margin-consistency.test.ts, project-header-kpi-service.test.ts |
| **Cash inflow bucketing** | Hierarchy: `paidDate → adminDateOverride → computedForecastReceiptDate → plannedPaymentDate` | § 3.4: payment-receipt-date for inflows. NOT invoice date. | normalizedRevenueLines | None — comment explicit | n/a | cashflow-helpers.effective-date.test.ts |
| **Cash outflow bucketing** | `paidDate → computedForecastPaymentDate → forecastPaymentDate`. Invoice date explicitly excluded. | § 3.4: actual-payment-date for outflows. | normalizedCostLines | None | n/a | smart-import-paid-date-actual-only.test.ts |
| **Cashflow point series** | `cashflowPoints` snapshot-guarded read | § 3.4: canonical sources only | cashflowPoints | None | n/a | finance-analysis-repository tests |
| **DSO / DPO** | `paidDate − invoiceDate` over 12-week window | Standard | normalizedRevenueLines, normalizedCostLines | None | n/a | finance-analysis tests |
| **Aging due date** | `resolveDueDate()` — explicit expectedDate or invoiceDate + termsDays | Standard | finance-analysis | None | n/a | finance-analysis tests |

---

## 5. Function-by-function register

(Selected — limited to functions with findings or worth surfacing. Compliant functions noted in § 2.)

| Function / Component / API | File | Expected behaviour | Actual behaviour | Issue | Severity | Fix applied | Test evidence |
|----------------------------|------|--------------------|------------------|-------|----------|-------------|---------------|
| `getCanonicalFinanceByProjectIds` | `server/services/canonical-dashboard-kpi-service.ts:48–162` | Return POC-recognised revenue per § 3.3 | Returns `SUM(amount_ex_vat) FROM normalized_revenue_lines` (milestone billing) | **F-1: conflated with POC** | HIGH | None | None pinning the violation; needs `dashboard-revenue-poc-parity.test.ts` |
| `dashboard-metrics.ts` per-project revenue aggregation | `server/services/dashboard-metrics.ts:78–89` | Same as above | Same anti-pattern | **F-1** | HIGH | None | None |
| `buildKpis` (KPI contract builder) | `server/services/project-platform-summary-service.ts:86–98` | Surface POC revenue | Consumes the F-1 output; labels it `finance_total_revenue`, `sourceTable: "normalized_revenue_lines"` | Downstream of F-1 | HIGH | None | None |
| `isCanonicalCosRealised` | `server/lib/finance/cos-realisation.ts:76–124` | § 3.2 predicate | Correct: override → QB → invoice+BLACK → legacy boolean | None | — | n/a | cos-realisation-consistency.test.ts |
| `isPastMonthAutoRealised` | `cos-realisation.ts:194–206` | Closed-month invoiced lines promote to realised | Correct (respects override + placeholder gates) | None | — | n/a | Same |
| `isEffectivelyRealised` | `cos-realisation.ts:224–232` | Composite of past-month + canonical | Correct (with current-month boundary guard) | None | — | n/a | Same |
| `getProjectFinanceLines` | `server/repositories/finance-line-level-repository.ts:215–319` | § 3.3 POC, snapshot-guarded | Correct: lines 257, 292, 312 apply `isNull(effectiveTo)`; line 549–563 per-project category totals; line 628 applies formula; line 689 buckets by invoice_date | None | — | n/a | finance-line-level.test.ts |
| `listInflowsForRange` | `server/repositories/finance-inflows-repository.ts:198–528` | Inflows by effective payment-receipt date | Correct; 14 instances of snapshot guard | None | — | n/a | v2-finance-cashflow-db.test.ts |
| `getMergedExpensesAndInflows` | `server/repositories/finance-expense-engine-repository.ts:92–663` | Outflows merging parent+child actuals | Correct; 16 guards; line 663 sets paidDate = child.financePaymentDate **primary**, parent.paidDate fallback | None | — | n/a | Same |
| `listCashflowPointsForRange` | `server/repositories/finance-analysis-repository.ts:438–459` | Date-range read on cashflow_points, guarded | Correct: `isNull(effectiveTo)` + date range | None | — | n/a | finance-analysis tests |
| `cashflow-2026` weekly aggregator | `server/routes/register-cashflow-2026-routes.ts:23–177` | Bucket inflows by effective date, outflows by payment date; explicit exclusion of invoice date | Correct (comment lines 95–98 calls out exclusion); status badges Out of Bank / Outstanding / Risk / Planned | None | — | n/a | Smoke tests |
| `cashflow-2026` route auth | `register-cashflow-2026-routes.ts:23` | `requirePermission("cashflow","view")` | Only `requireAuth` | **F-2** | CRITICAL | NOT applied | None |
| `cashflow-2026/detail` route auth | line 181 | `requirePermission("cashflow","view")` | Only `requireAuth` | **F-2** | CRITICAL | NOT applied | None |
| `cashflow-2026/balance-history` route | line 401 | Permission gate | Only `requireAuth` | **F-2** | CRITICAL | NOT applied | None |
| `/api/program/cos` | `server/routes/finance-legacy-extracted-routes.ts:51` | `requirePermission("financials","view")` | Only `requireAuth` | **F-2** | CRITICAL | NOT applied | None |
| `/api/financial-headline` | line 204 | `requirePermission("financials","view")` | Only `requireAuth` | **F-2** | CRITICAL | NOT applied | None |
| `POST /api/cos-status-override` | line 1129 | `requirePermission("cos","override")` | Only `requireAuth` | **F-2** — WRITE | CRITICAL | NOT applied | None |
| `DELETE /api/cos-status-override/:expenseId` | line 1149 | `requirePermission("cos","override")` | Only `requireAuth` | **F-2** — WRITE | CRITICAL | NOT applied | None |
| `PATCH /api/expenditure/font-color-toggle` | line 1078 | `requirePermission("cos","override")` | Only `requireAuth` | **F-2** — WRITE toggling realisation signal | CRITICAL | NOT applied | None |
| `cos-control-routes.ts` endpoints | `server/routes/cos-control-routes.ts:60–812` | `requirePermission("cos"/"cashflow", action)` | `requireAdmin` only (no granularity); two endpoints `requireAuth` only | **F-2** | CRITICAL/HIGH | NOT applied | None |
| `FINANCE_ANALYSIS_ROLES` / `TOLERANCE_WRITE_ROLES` | `server/routes/finance-analysis.routes.ts:42–58` | Roles read from `COMPANY_ROLES` or use entity permissions | Hardcoded string arrays | **F-3** | MEDIUM | NOT applied | None |
| `detectAndPersistProposals` (paid_date branch) | `server/services/quickbooks-cascade-proposals-service.ts:256–274` | Propose `paid_date` when QB balance ≤ 0.01 | Correct — proposes, never auto-applies; never touches `cosRealised` or `paidDateConfirmed` | F-4: no proposal-age surfacing | MEDIUM | NOT applied | qb-allocation-evidence.test.ts |
| `confirmCostLineLink` / `confirmRevenueLineLink` | `server/services/quickbooks-reconciliation-service.ts` | Atomic link creation | Correct; uses `onConflictDoNothing` (obsolete after Task #142) | F-9: stale comment | LOW | NOT applied | quickbooks-invoice-matches.test.ts |
| `loadBaselineFromSnapshots` | `server/lib/import/baseline.ts:404–568` | Field-level snapshot fallback (§ 9.2) | Correct | None | — | n/a | Tests pin baseline behaviour |
| `mergeRow` | `server/lib/import/merge-engine.ts:307–372` | Field-level snapshot fallback, manual_overrides preservation | Correct | None | — | n/a | Same |
| `normalizer.ts` cosRealised derivation | line 1627: `cosRealised = isValidInvoiceNumber(invoiceNumber) && hasAmount` | Persisted hint only; runtime predicate `isCanonicalCosRealised` is canonical | Correct — this is a derived persisted boolean; canonical predicate adds BLACK gate at read time | None (consumer must use predicate) | — | n/a | cos-realisation-consistency.test.ts |
| `period-lock.ts` `isMonthLocked` | line ~236 | Read `cos_period_locks` with `isNull(unlockedAt)` | Correct; SAST timezone for business days | None | — | n/a | cos-period-lock.test.ts |
| `formatZar`, `formatZarCompact` | `client/src/lib/currency.ts` | Canonical en-ZA ZAR with em-dash for missing | Correct | None | — | n/a | (Unit tests exist) |
| `money()` in revenue-tracking.tsx | line 55 (now line 54 after fix) | Use canonical formatter | **FIXED**: now wraps `formatZar(v, { cents: true })` | F-7 fixed | LOW | ✅ Applied | n/a |
| Inflow / outflow table column headers | `client/src/pages/cashflow.tsx:549, 793` | Distinguish payment date from invoice date | **FIXED**: now labelled "Payment date" + tooltip referencing § 3.4 | F-6 fixed | LOW | ✅ Applied | n/a |
| `cashflow.tsx` QB "Settled" badge | line 614–620 | Tie "Settled" to `paymentReceivedDate ≤ today` | Shows "Settled" purely on `qbPaymentStatus === 'paid'` regardless of date | F-5 adjacent — future-dated "Settled" possible | MEDIUM | NOT applied (needs care) | None |

---

## 6. Button / action register

(Selected — finance-impacting actions; not exhaustive.)

| Button / action | Page / location | Expected result | Actual result | Saves? | Reload proof? | Permission check? | Issue / fix |
|-----------------|-----------------|-----------------|---------------|--------|---------------|-------------------|-------------|
| Approve invoice match | quickbooks invoice match drawer | Link app row to QB doc; emit cascade proposals | `POST /api/quickbooks/invoice-matches/:id/approve`; persists link + proposals | ✅ | ✅ via re-fetch | ✅ `requirePermission("financials","edit")` | OK |
| Reject invoice match | Same | Mark suggestion rejected; train pattern decay | `POST /reject`; records reason | ✅ | ✅ | ✅ | OK |
| Manual link (override) | Same | Force link without match suggestion | `POST /manual-link` | ✅ | ✅ | ✅ `requirePermission("financials","override")` | OK |
| Edit budget (COS Tracker) | cos.tsx grid | `POST /api/tracker-monthly` | Updates monthly budget | ✅ | ✅ | Backend gates apply | OK (per-cell edit) |
| Override admin date (cashflow row) | cashflow.tsx DateOverridePopover | Persist date override; show admin badge | API write; audit recorded | ✅ | ✅ | ✅ `requirePermission("cashflow","edit")` | OK |
| Toggle invoice-date font colour | `PATCH /api/expenditure/font-color-toggle` | Flip BLACK ↔ RED (changes realisation signal) | Persists toggle | ✅ | ✅ | ❌ `requireAuth` only — **F-2 CRITICAL** | NOT applied; recommend gating with `requirePermission("cos","override")` |
| Override COS status | `POST /api/cos-status-override` | Force realised / not realised | Persists override | ✅ | ✅ | ❌ `requireAuth` only — **F-2 CRITICAL** | NOT applied |
| Open COS period lock | `cos-period-lock` API | Soft-lock month, prevent further edits | Locks; emits audit | ✅ | ✅ | ✅ `requirePermission("cos","override")` and bypass list | OK |
| Unlock period | Same | Soft-unlock with reason | Updates `unlockedAt` + reason | ✅ | ✅ | ✅ COO/CEO/CFO override list | OK |
| Add invoice (via Smart Import) | imports.routes.ts | Update `normalized_cost_lines` + actuals child | Full conflict/merge cycle | ✅ | ✅ | ✅ permission-gated | OK |
| Add PO (POGenerator) | client/src/components/POGenerator.tsx | Create PO, queue for approval | `POST /api/po/generate` with idempotency key | ✅ | ✅ | ✅ `requirePermission("procurement","create")` | OK |
| Approve / block / request-info on PO | po-approval-board.tsx | Update `poReviewAssignments` + status | API write; audit | ✅ | ✅ | ✅ requirePermission | OK |
| Delegate PO review | Same | Assign to another reviewer | API write | ✅ | ✅ | ✅ | OK |
| Mark milestone | milestone-tracker.tsx | Status badge re-renders | API write to `normalized_revenue_lines` | ✅ | ✅ | ✅ via finance permissions | OK |
| Set opening balance (cashflow week) | cashflow.tsx | Persist override + history | `POST /api/cashflow-2026/opening-balance` | ✅ | ✅ | ✅ `requirePermission("cashflow","edit")` | OK |
| Set opex budget (monthly) | cashflow.tsx modal | Persist budget | `POST /api/cashflow-2026/opex-budget` | ✅ | ✅ | ✅ | OK |
| Set available payment override | cashflow.tsx | Persist + reason | `POST /api/cashflow-2026/available-payment` | ✅ | ✅ | ✅ | OK |
| Refresh QuickBooks | admin-quickbooks.tsx | `POST /api/quickbooks/sync-now` | Refreshes QB cache | ✅ | ✅ | ✅ `financials:edit` | OK |
| Connect / disconnect QuickBooks | Same | OAuth flow | OK | ✅ | ✅ | ✅ requireAdmin + OAuth | OK |
| Export finance data | (Not present on COS, Cashflow, Revenue Tracking) | CSV/PDF export | **Missing on COS, Cashflow, Revenue tabs** | n/a | n/a | n/a | Recommend adding export action |
| Open drilldown (COS month cell) | cos.tsx grid | Open MonthDetailDrawer with source lines | API: `/api/cos-tracker/month-detail` | n/a | ✅ | ✅ | OK |
| Open week detail (Cashflow) | cashflow.tsx week row | DetailRow component expands inline | `/api/cashflow-2026/detail` | n/a | ✅ | ❌ `requireAuth` only — **F-2** | NOT applied |
| Approve cascade proposal | QB cascade drawer | Apply mutation per type | `acceptProposal` | ✅ | ✅ | ✅ requirePermission | OK |
| Decline cascade proposal | Same | Mark declined; will re-detect on next sync | `declineProposal` | ✅ | ✅ | ✅ | OK; F-4 — no proposal-age UI |

---

## 7. Reconciliation results

| Area | Dashboard value | Drilldown total | Source total | Difference | Status | Root cause |
|------|-----------------|-----------------|--------------|------------|--------|------------|
| **Revenue tile vs POC** | `finance_total_revenue` = SUM(`normalized_revenue_lines.amount_ex_vat`) | Sum of per-line POC from `/api/finance/lines` | POC formula sum | **Diverges for partially-completed projects** (billing sum > POC) | **MISMATCH** | F-1: KPI uses milestone billing sum, not POC formula |
| Revenue page vs POC (Revenue Tracking) | Milestone amounts × state | Sum of milestones | Source workbook | Matches (replica view) | OK | n/a |
| COS realised | COS Tracker total | Sum per project of realised lines | Workbook col Q sum (where BLACK) | Matches within tolerance | OK | Pinned by `finance-acceptance-checks.test.ts` |
| Cashflow weekly | Per-week sum | Drill-in detail rows | Sum of effective-date items | Matches | OK | Same effective-date hierarchy used at both layers |
| Aging (AR) | Bucket totals | Overdue list | Same source rows | Matches | OK | Single repository read |
| Aging (AP) | Bucket totals | Overdue list | Same source rows | Matches | OK | Same |
| DSO / DPO trend | 12-week series | Per-period detail | Same data | Matches | OK | One query |
| QB recon (COS) | qb_bills vs cost_lines match summary | Per-line variance | QB Bill totals vs ex-VAT amounts | Matches within R1 (auto-exact) or flagged | OK | `quickbooks-reconciliation-service.ts:56` AMOUNT_TOLERANCE = 1 |
| QB recon (Revenue) | Same for invoices | Same | Same | Matches | OK | Same |
| Lifecycle month tile vs FY KPI | `lifecycle-routes.ts:1614–1632` uses POC col U for month bucket; FY tile uses F-1 conflated sum | **Inconsistent** in same view for partial projects | n/a | **Hidden divergence** | OBSERVATION | F-1 root cause |
| Smart Import baseline parity | `import_snapshot` row | Live DB row | Tracker workbook | Matches per § 9.2 field-level fallback | OK | Pinned by smart-import-invariants.test.ts |
| Persisted revenue_recognition_amount vs derived | `/api/finance/recon-check/:projectId` | Per-line POC | Persisted col U | Within R1 | OK | Audit-test (§ 3.3.2) |

---

## 8. UX / UI findings

### UX / UI issues
- **U-1:** Cashflow inflow/outflow tables have ambiguous "Date" column header. **FIXED (F-6).**
- **U-2:** `revenue-tracking.tsx` used non-canonical ZAR formatter (2 decimals vs canonical 0). **FIXED (F-7).**
- **U-3:** No CSV/PDF export buttons on COS, Cashflow, Revenue Tracking main tables. Management review use case.
- **U-4:** "Settled" QB badge on inflow rows (`cashflow.tsx:614–620`) tied purely to `qbPaymentStatus === 'paid'`; could show "Settled" even when `paymentReceivedDate` is future. Recommend a `paymentReceivedDate ≤ today` guard.
- **U-5:** Status terminology ("Out of Bank", "Outstanding", "Risk", "Planned") is meaningful but undefined inline. Recommend tooltips with one-line definitions referencing § 3.4.
- **U-6:** No "Partially Paid" milestone status badge — milestones flip from Invoiced → In Bank without an intermediate state, even though QB partial payments are detected internally.
- **U-7:** `dashboard.tsx:136` and `coo-home.tsx:190–195` define local `money()` helpers — not canonical. Minor consistency issue.
- **U-8:** Overdue receivables not surfaced in the main cashflow page; only in Cashflow Analysis tab. Design choice (cash-date vs aging) but worth a cross-link.

### Data issues
- **F-1 (HIGH):** Dashboard "Total Revenue" is milestone billing sum, not POC. § 3.3.3 violation.
- **F-5 (MEDIUM):** No DB constraint on future `paidDate` — relies on normalizer; corner case if a manual edit slips through.

### Workflow / process issues
- **F-4 (MEDIUM):** QB cascade proposals can sit pending indefinitely; no proposal-age warning surface; next sync re-proposes the same divergence without escalation.

### Permissions / role issues
- **F-2 (CRITICAL):** 10+ finance endpoints lack `requirePermission(entity, action)` gates. Mostly legacy routes; includes WRITE endpoints (`cos-status-override`, `font-color-toggle`).
- **F-3 (MEDIUM):** Hardcoded role arrays in `finance-analysis.routes.ts`.

### Technical / code issues
- **F-8 (LOW):** Direct `db.select()` in route handlers in `cos-control-routes.ts` and `invoice-pattern-routes.ts`.
- **F-9 (LOW):** Obsolete comment in `quickbooks-reconciliation-service.ts:1007–1010`.

### Governance / control issues
- COS period lock pattern is correctly implemented with COO/CEO/CFO override and audit. ✅
- Smart Import baseline / overrides preserve manual edits across re-imports. ✅
- Audit events emitted at major mutation points (verified in approve/reject/cascade paths). ✅
- Release gate requires `reconciliation-status.json` for finance-model changes. ✅

---

## 9. Fixes applied

| # | File changed | What changed | Why | Risk | Test result |
|---|--------------|--------------|-----|------|-------------|
| 1 | `client/src/pages/revenue-tracking.tsx` | Removed local `ZAR = new Intl.NumberFormat(..., minimumFractionDigits: 2)`; added `import { formatZar } from "@/lib/currency"`; rewrote `money()` to call `formatZar(v, { cents: true })`. | Consistency with canonical ZAR formatter; em-dash placeholder for non-numeric; ASCII space normalisation; honours UI/UX audit X2 integrity rule. | Very low — formatting only; identical numeric output for valid numbers; "—" for empty/non-numeric (was "—" or raw string before). | Could not run `npm run check` in sandbox (env missing `@types/node`). Edit is minimal and well-typed. |
| 2 | `client/src/pages/cashflow.tsx` (inflows table header, line ~549) | Relabelled "Date" → "Payment date" and added `title` tooltip: *"Payment receipt date (actual if received, otherwise forecast). Drives cash inflow per § 3.4 — NOT the invoice raised date."* | Cashflow inflow column is bound to `effectiveDate` hierarchy (paidDate / inBankDate / forecast), never invoice date. Header was ambiguous. | Very low — label and tooltip only; no logic change. | Same sandbox limitation. |
| 3 | `client/src/pages/cashflow.tsx` (outflows table header, line ~793) | Same change for outflows column: "Date" → "Payment date" with tooltip clarifying actual-payment-date vs forecast (not invoice). | Same rationale; outflow column is bound to `expensePaymentDate`. | Very low. | Same. |

**No formula changes applied. No RBAC changes applied. No schema changes applied.** All HIGH/CRITICAL findings are documented and routed to the COO for decision.

---

## 10. Tests run

| Command / test | Result | Notes |
|----------------|--------|-------|
| `git status`, `git log` | Pass | Branch `claude/jolly-keller-SOQJL` clean, latest commits show recent priorities-audit follow-ups. |
| Schema exploration (Drizzle files in `shared/schema/finance.ts`) | Pass | 10 snapshot tables identified; encrypted bank fields confirmed; deprecated tables (`program_expense`, `program_inflows`) physically dropped. |
| Full snapshot-guard scan across server/ (repositories, services, routes, lib, raw SQL) | **Pass — ZERO violations** | ~120+ distinct reads against the 10 snapshot tables; every aggregate / live-row read carries `isNull(effectiveTo)` (or `WHERE effective_to IS NULL`). Three minor stylistic cases logged — see Appendix C. |
| `grep` audit of `isNull(effectiveTo)` across `server/repositories/finance-*-repository.ts` and `server/lib/finance/*` | Pass (compliance) | 14+ guards in inflows repo, 16+ in expense engine repo, all reviewed snapshot reads guarded. |
| Code-path audit: `cos-realisation.ts` (§ 3.2) | Pass | Predicate correctly checks override → QB allocation → invoice + BLACK gate → legacy boolean. |
| Code-path audit: `finance-line-level-repository.ts` (§ 3.3) | Pass | Per-line POC formula scoped to single project; aggregates are sums; bucket date is invoice_date. |
| Code-path audit: `register-cashflow-2026-routes.ts` (§ 3.4) | Pass | Inflow effective-date hierarchy excludes invoice date; comment lines 95–98 make this explicit. |
| Code-path audit: `canonical-dashboard-kpi-service.ts` (§ 3.3.3) | **Fail (F-1)** | KPI sources from `normalized_revenue_lines.amount_ex_vat`, not POC formula. |
| RBAC audit of finance routes vs `requirePermission` middleware | **Fail (F-2)** | Multiple endpoints in `finance-legacy-extracted-routes.ts`, `cos-control-routes.ts`, `register-cashflow-2026-routes.ts` lack entity-permission gates. |
| RBAC audit: hardcoded roles | **Fail (F-3)** | `finance-analysis.routes.ts:42–58` hardcodes role arrays. |
| Smart Import: planned vs actual separation (§ 3.7) | Pass | Normalizer keeps separate fields; comment "paidDate is actuals — never fall back to forecastPaymentDate" verified at `normalizer.ts:1623`. |
| Smart Import: line-ID stability (§ 3.5) | Pass | Row hash via SHA-256 of normalised identity fields; versioned (`HASH_VERSION_EXPENDITURE = 2`); deterministic. |
| Smart Import: baseline lookup id-first (§ 9.1) | Pass | `buildBaselineLookup` returns both `byRowId` and `byBusinessKey`; `mergeSection` prefers `mr.existingRowId`. |
| Smart Import: snapshot fallback field-level (§ 9.2) | Pass | Both planner and writer skip null/undefined inside `importSnapshot` and fall back at field level. |
| Smart Import: comparison scope narrow (§ 9.3) | Pass | `PLAN_COMPARE_FIELDS`, `REVENUE_COMPARE_FIELDS`, `EXPENDITURE_COMPARE_FIELDS` limited to dates, amounts, add/delete, colour-derived booleans. |
| `npm run check` (TypeScript) | **Could not run** | Sandbox missing `@types/node` — `error TS2688`. |
| `npx vitest run qa/tests/unit/finance-snapshot-guards.test.ts qa/tests/unit/cos-realisation-consistency.test.ts qa/tests/unit/finance-utils-iscosrealised.test.ts` | **Could not run** | Vitest aborts on `vite.config.ts` (Cannot find package 'vite'). |
| `npx vitest run qa/tests/unit/finance-line-level.test.ts qa/tests/unit/finance-acceptance-checks.test.ts qa/tests/unit/dashboard-financial-summary.test.ts qa/tests/unit/smart-import-paid-date-actual-only.test.ts` | **Could not run** | Same env issue. |
| Browser-test finance flows | **Could not run** | No dev server brought up in this sandbox (would need DB + external integrations). |

> **Tests not executable in this sandbox.** The release-gate workflow (CI) runs the same scripts and is authoritative for green/red status. The test FILES exist on disk and the source-text guards are pinned (e.g. `finance-snapshot-guards.test.ts` asserts the literal `effectiveTo` token in 5 critical query strings). Re-run in CI or a local environment with dependencies installed before merging the safe fixes.

---

## 11. Remaining risks

### High-risk finance defects still open
1. **F-1 — Dashboard "Total Revenue" KPI conflates milestone billing sum with POC-recognised revenue.** Per § 3.3.3 this is a violation. Material overstatement on partially-completed projects. Owner must decide: (a) rename KPI to "Contract value billed" + add a separate "Revenue recognised (POC)" tile sourced from `finance-line-level-repository`, or (b) re-source `canonical-dashboard-kpi-service` and `dashboard-metrics` to use the POC formula. Either path needs a new parity test and a `reconciliation-status.json` entry per release gate.
2. **F-2 — RBAC gaps on finance routes.** WRITE endpoints (`cos-status-override`, `font-color-toggle`, `expenditure overrides`) exposed to any authenticated user via `requireAuth` only. Read endpoints (`/api/program/cos`, `/api/financial-headline`, `/api/cashflow-2026`) expose finance data without entity-permission check. P0 to gate before any wider role rollout. Note that `font-color-toggle` directly mutates the realisation signal — anyone authenticated can flip BLACK ↔ RED for any line.

### Medium-risk
3. **F-3 — Hardcoded `FINANCE_ANALYSIS_ROLES`/`TOLERANCE_WRITE_ROLES` arrays.** Per § 5, roles should be read from `COMPANY_ROLES` (currently 16 roles, per `shared/schema/users.ts`) or replaced with `requirePermission(entity, action)`.
4. **F-4 — Stale QB proposals.** No age/escalation surface; payment-date proposal can sit pending while QB shows paid. Build an "open cascade proposals > X days" indicator on admin-quickbooks.tsx.
5. **F-5 — No DB CHECK on future `paidDate`.** Soft guarantee only; normalizer enforces, but a manual route write could slip through.

### Missing test coverage
- No test pinning the F-1 violation. Recommend `qa/tests/unit/dashboard-revenue-poc-parity.test.ts` asserting that `getCanonicalFinanceByProjectIds` returns the same per-project totalRevenue as the line-level POC sum (within rounding).
- No test pinning RBAC gates on each finance endpoint. The route-RBAC validation file mentioned in `release-gate.ts` (CRITICAL_ROUTE_ROLE_VALIDATION) exists but is non-gating today.
- Snapshot guards are pinned by source-text in `finance-snapshot-guards.test.ts` (5 critical query paths). Recommend extending to cover every snapshot-table read in `server/repositories/finance-*-repository.ts` if it's not already.

### Missing source data / connector access
- This audit ran in a sandbox without DB/QB access — could not verify a real reconciliation between Excel tracker, app, and QuickBooks for a known project. Recommend an "audit project" (e.g. Mondi) be selected by COO and reconciled by Finance against the tracker and QB to ground-truth the dashboards.

### Ambiguous business rules
- The Smart Import spec mention of `expense_line_id` / `inflow_line_id` (§ 3.5 of guardrails) appears to be satisfied by `row_hash` in the live code. Recommend an owner note in guardrails confirming the naming.
- The "Settled" QB badge semantics — should it require `paymentReceivedDate ≤ today`? Owner clarification needed.
- The dashboard "Revenue" terminology — is "Total Revenue" meant to be contract value, invoiced revenue, or recognised revenue? F-1 hinges on this decision.

### Items requiring COO / Finance decision
- **D-1 (F-1 fix path):** Rename "Total Revenue" KPI to "Contract value (billed)" and add a separate "Revenue (POC recognised)" tile, **or** re-source the existing KPI from the POC repository.
- **D-2 (F-2 fix path):** Approve a per-endpoint RBAC migration plan for `finance-legacy-extracted-routes.ts`, `cos-control-routes.ts`, and `register-cashflow-2026-routes.ts`. Each route needs `requirePermission(entity, action)` aligned with the registry.
- **D-3 (F-3 fix path):** Replace `FINANCE_ANALYSIS_ROLES` / `TOLERANCE_WRITE_ROLES` with `requirePermission` calls.
- **D-4 (F-4 governance):** Decide on the proposal-age threshold (e.g. > 7 days pending) and escalation path.
- **D-5 (F-5 governance):** Decide whether to add a CHECK constraint on `paidDate` (additive migration) or leave the normalizer as the sole guard.
- **D-6 (UX export):** Approve export buttons (CSV/Excel/PDF) on the main finance tables.

---

## 12. Next recommended module

**Module:** Procurement (POs + Procurement Items + Payment Requests + Counterparties + Bank Details).

**Why:**
1. It's the most adjacent risk surface to Finance — POs feed cost lines, supplier invoices flow through payment requests, and supplier bank details are field-encrypted (per § 5).
2. The PO approval workflow has its own RBAC surface (delegation, decision history) which deserves the same audit lens as Finance.
3. Counterparty bank-details encryption (`server/lib/field-encryption.ts`) is a HARD security boundary — periodic verification protects against accidental log-leaks or unencrypted writes.
4. The procurement category mapping influences COS realisation (counterparty → SUPPLIER/INSTALLER/OTHER classification feeds the cost-line categorisation, which feeds revenue POC).

After Procurement, the natural next module is **Engineering** (because it owns the BOQ and design that becomes the cost baseline) or **Project Lifecycle / Gates** (because gate evidence is where Finance handshakes back to operations).

---

## Appendix A — Snapshot tables (HARD `effectiveTo IS NULL` audit candidates)

Per `docs/AGENT_GUARDRAILS.md` § 3.1, every aggregate read against these tables MUST include the guard:

1. `cashflowPoints`
2. `categoryRevenueAllocations`
3. `financeCosMonthly`
4. `financeRevenueMonthly`
5. `normalizedCostLineActuals`
6. `normalizedCostLines`
7. `normalizedRevenueLines`
8. `projectRevenueSummary`
9. `trackerProjectMetadata`
10. `trackerRevenueSummary`

Each table also carries `effectiveFrom`, `snapshotRunId`, and (where present) `deletedAt` for soft-delete. Source-text test in `qa/tests/unit/finance-snapshot-guards.test.ts` pins 5 critical paths.

---

## Appendix C — Snapshot-guard scan (the three ambiguous cases)

A full scan of every read against the 10 snapshot tables (~120+ sites) found **zero confirmed violations**. Three minor cases worth a note (none aggregate-affecting):

**C.1** `server/routes/excel-vs-app.routes.ts:557, 559, 581, 583, 603, 605, 630, 632` — deprecated helpers (`readLiveValue`, `readSnapshotValue`, `patchImportSnapshot`, `readManualOverrideValue`) do point-lookups by primary key without `isNull(effectiveTo)`. These functions are `@deprecated` per JSDoc and not called from the live resolve path (`lib/excel-vs-app-bulk.ts` is current). Lookups by serial `id` are unique across snapshots, so the worst case is an ambiguous overlay read, not a double-count. **Recommendation:** delete the deprecated helpers, or add the guard for defence-in-depth.

**C.2** `server/lib/reconciliation/selected-truth-registry.ts:259` — the formula DESCRIPTION string for the `unmatched_cost_invoices` KPI omits `effective_to IS NULL` from the displayed formula text. This is metadata only; the actual query is computed elsewhere. **Recommendation:** update the description string to mention the guard so future readers don't misinterpret it as authoritative.

**C.3** `server/services/project-platform-summary-service.ts:632, 645` — uses the permissive variant `(effective_to IS NULL OR effective_to > CURRENT_TIMESTAMP/NOW())` instead of the canonical `effective_to IS NULL`. Today this is equivalent because soft-close always stamps `effective_to` to the close moment (≤ NOW). Would break if any code path ever wrote a future-dated `effective_to` for an active row — none does today. **Recommendation:** standardise on `effective_to IS NULL`.

---

## Appendix B — Override + audit pattern (per § 0A)

For any of the soft-rule findings above (e.g. F-3 hardcoded roles, F-5 missing CHECK constraint, U-3 missing exports), the override pattern is:

- **Authoriser:** COO (default), CFO for finance-specific finance-formula or KPI labelling changes
- **Reason:** Free-text, captured against the action / PR description
- **Audit:** Entry in `audit_events` for any data mutation; PR description for any code change touching guardrail-named files
- **Surfacing:** F-1 fix needs a reconciliation-status.json entry per release gate; F-2 fix should land alongside RBAC tests and a route-RBAC validation entry

For HARD findings (F-1 is the only HARD candidate in this audit, due to § 3.3.3), there is **no override path** — the fix is required before the code can be trusted to produce correct numbers.

---

*End of finance audit.*
