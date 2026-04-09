# Dashboard KPI Second-Pass Audit (Canonical Reconciliation)

## Source map and classification

### Backend routes inspected
- `server/pm-routes.ts#/api/pm/dashboard` → **CANONICAL_READ** (rerouted in this pass to canonical `project_id` keyed data from `work_items`, `normalized_revenue_lines`, `normalized_cost_lines`).
- `server/pm-routes.ts#/api/pm/priority-items` → **COMPATIBILITY_READ_TO_BE_REROUTED** (still reads `operational_tasks` for continuity; marked inline).
- `server/pm-routes.ts#/api/pm/calendar-events` → **COMPATIBILITY_READ_TO_BE_REROUTED** (still reads `operational_tasks` for continuity; marked inline).
- `server/routes.ts#/api/projects-summary` → inspected, mixed compatibility flow remains; not changed in this patch.
- `server/portfolio-routes.ts#/api/portfolio-dashboard` and `/api/portfolios/:id/rollups` → inspected, mixed project-name compatibility paths remain; not changed in this patch.
- `server/pd-routes.ts#/api/pd/dashboard` → inspected, ticket KPI endpoint (non-financial).

### Frontend KPI surfaces inspected
- `client/src/pages/pm-dashboard.tsx` (consumes `/api/pm/dashboard` summary and project card KPI values; no business-critical finance recompute).
- `client/src/pages/cashflow.tsx` (contains local derived totals from already-queried backend records; no change in this patch).
- `client/src/pages/portfolio-detail.tsx` (renders API rollups; no change in this patch).
- `client/src/components/tabs/UnifiedPlanTab.tsx` and `client/src/components/TaskGridView.tsx` (local schedule/task display aggregation for plan UI; no change in this patch).

## KPI duplication map (this pass)
- PM dashboard financial totals previously had route-local SQL aggregation in `server/pm-routes.ts` and independent aggregations elsewhere.
  - Old duplicate path removed for PM dashboard route-local finance/task SQL.
  - Final canonical path for PM dashboard:
    - finance from `server/services/canonical-dashboard-kpi-service.ts#getCanonicalFinanceByProjectIds`
    - execution/task counts from `server/services/canonical-dashboard-kpi-service.ts#getCanonicalTaskSummaryByProjectIds`

## Reconciliation map (this pass)
- PM dashboard project `financials.totalBudget`, `financials.totalActual`, `summary.totalBudget`, `summary.totalActualSpend`, `summary.cosRealisedTotal`, `summary.cosCommittedTotal` now resolve from one canonical backend path only.
- PM dashboard task counters (`active`, `overdue`, `completed`, summary rollups) now resolve from one canonical backend path only.

## Noise filtering decisions
- Bypassed non-canonical PM dashboard task feed from `operational_tasks` for KPI summary math.
- Bypassed project-name keyed PM dashboard finance aggregation in favor of `project_id` canonical linkage.
- Retained compatibility endpoints (`/api/pm/priority-items`, `/api/pm/calendar-events`) but explicitly marked for reroute.
