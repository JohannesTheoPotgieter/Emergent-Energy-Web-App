# Parked features

Surfaces that have **no canonical data source yet**. Per the finance-data rule
(see `docs/AGENT_GUARDRAILS.md` §3), a fabricated/synthesized number must never be
shown on a finance screen. Where a real source does not exist yet, the surface is
**disabled by default** and its code is **kept (not deleted)** so it can be
re-enabled once a canonical source lands.

Each entry records: **what**, **files**, **how it's gated (off)**, **why**, and
**how to re-enable**.

---

## 1. Synthetic analytics endpoints (trends / budget-waterfall / velocity)

- **What:** `GET /api/analytics/trends`, `GET /api/analytics/budget-waterfall`,
  `GET /api/analytics/velocity`. They fabricated values from constants / a real
  `total_project_value` × magic multipliers (`× 0.08`, `× 0.74`, sequence maths).
- **Files:** `server/analytics-routes.ts`.
- **Gated off:** each returns **HTTP 410** unless the caller passes `?demo=true`,
  in which case the payload carries `synthetic: true`. **No live client screen
  consumes them** (verified by grep — `client/src` has no reference).
- **Why parked:** no canonical read backs these series. Real equivalents already
  exist via `/api/program-dashboard`, `/api/portfolio-dashboard`, and the KPI
  traceability surface.
- **Re-enable:** either (a) wire a consumer to the canonical dashboards above, or
  (b) replace each handler body with a real query and drop the `?demo`/410 gate.
  The `?demo=true` debug path is retained for local inspection only.

## 2. Company-overview "vs target" KPIs with no real target (margin, pipeline)

- **What:** two department-score KPIs that previously scored against a **fabricated
  target**: `fin_gross_margin_vs_target` (hardcoded `20%`) and
  `pd_signed_pipeline_vs_target` (real signed pipeline × `1.2`).
- **Files:** `server/services/company-overview-service.ts`.
- **Gated off:** the fabricated targets were removed; each KPI now passes
  `target: null`. `calculateKpiScore` (`shared/config/kpi-registry.ts`,
  `percentage_vs_target`) returns `null` for a null/zero target, so the KPI is
  **greyed and excluded from the department score** (it is also in
  `HARD_HIDDEN_KPI_KEYS`, so it never renders as a number). The sibling finance
  targets (`fin_revenue_vs_target`, `fin_cash_collected_vs_target`,
  `fin_cos_vs_target`) are unaffected — they use the real FYTD-anchored plan.
- **Why parked:** there is no board-set gross-margin target and no real
  signed-pipeline target in the data model.
- **Re-enable:** supply a real target value where the KPI is built (replace
  `target: null` with the canonical target) once a target source exists.

## 3. Static COS budget fallback (`STATIC_COS_BUDGET_FY26`)

- **What:** a hardcoded monthly COS-budget map (12 fabricated FY26 figures) used as
  a fallback when no manual budget had been entered for a month. Fed the "Budget"
  rows/variance on the COS tracker, GP-company page, finance-lines budget, and the
  Realisation KPIs page.
- **Files:** constant retained (deprecated) in
  `server/lib/calculations/financeUtils.ts`; the fallback was removed from the read
  paths in `server/departments/finance-routes.ts` (COS tracker + GP `getCosBudget`),
  `server/routes/finance-lines.routes.ts` (`loadBudgetByMonth`), and
  `server/routes/finance-legacy-extracted-routes.ts` (`/api/realisation-kpis`
  `ytdBudget`).
- **Gated off:** the monthly COS budget now comes **only** from the canonical
  manual entries (`tracker_monthly_manual`, via `storage.getTrackerMonthlyManual`).
  A month with no manual entry now shows **0**, not a hardcoded figure. The
  constant itself is **kept** (not deleted) for reference.
- **Why parked:** the static numbers are hardcoded/fabricated. The canonical budget
  source is the manual budget entries; a DB-backed monthly budget baseline does not
  otherwise exist (`budget_baselines` is per-project totals, not a monthly company
  COS budget).
- **Re-enable:** restore the `?? STATIC_COS_BUDGET_FY26[mk]` fallback in the files
  above, **or** (preferred) seed the manual budget entries / add a monthly
  budget-baseline table and read from it.
