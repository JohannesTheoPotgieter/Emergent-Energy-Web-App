# Reporting KPI Audit Map (Code-Level) + Proposed KPI Corrections

Date: 2026-04-01 (UTC)

## Scope audited

This audit maps KPI logic for reporting surfaces served from `/api/reports/*` and `/api/admin/reports/*`, and proposes KPI definition updates aligned to existing app metric patterns:

1. **Admin Operational Overview** (`/api/admin/reports/operational-overview`) — `server/report-routes.ts`
2. **PM Monthly Report** (`/api/reports/pm/monthly`) — `server/services/pm-monthly-report-service.ts`
3. **Engineering Monthly Report** (`/api/reports/engineering/monthly`) — `server/services/engineering-monthly-report-service.ts`
4. Cross-check against broader KPI conventions in `server/services/dashboard-metrics.ts` and `server/routes/dashboard-routes.ts`

---

## 1) KPI source map + recommended business definition

### A. Admin Operational Overview KPIs

**Code source of truth:** `calculateKPIs(month)` in `server/report-routes.ts`.

| KPI | Current code definition | Recommended business definition (for approval) |
|---|---|---|
| `activeProjects` | Counts `isActive=true` and phase not in inactive statuses. | **Change definition:** “Projects handed over to PM and not yet client-handed-over” (from PD→PM handover until Client Handover phase). This matches your operating view better than generic `isActive`. |
| `constructionStarts` | Distinct project IDs with `constructionStartActual` in selected month. | Keep as-is (good). |
| `pdPmHandovers` | Distinct project IDs with `pdHandoverActual` in selected month. | Keep as-is (good). |
| `commissionings` | Distinct project IDs with `commissioningActual` in selected month. | Keep as-is (good). |
| `clientHandoversPlanned` | Distinct project IDs with `clientHandoverDate` in selected month. | Keep naming explicit as **planned**; optionally add a parallel `clientHandoversActual` KPI where needed. |

### B. PM Monthly Report KPIs

**Code source of truth:** `generatePmReportData(month)` in `server/services/pm-monthly-report-service.ts`.

| KPI | Current code definition | Recommended business definition (for approval) |
|---|---|---|
| `activeProjects` | Same generic `isActive + phase not inactive` filter. | Align to PM-operating definition above: handed over to PM and not yet client-handover complete. |
| `totalContractValue` | Sum `contractValue` of active projects. | **Replace KPI tile** with `actualRealisedRevenueMonth` from finance revenue tracker (`finance_revenue_monthly`) for selected month, per your comment. Keep contract value as secondary contextual metric if needed. |
| `constructionStarts` | Projects with `constructionStartActual` in month. | Keep as-is. |
| `commissionings` | Projects with `commissioningActual` in month. | Keep as-is. |
| `pdPmHandovers` | Projects with `pdHandoverActual` in month. | Keep as-is. |
| `clientHandovers` | Projects with `clientHandoverDate` in month. | Rename to `clientHandoversPlanned` for consistency with operational overview. |
| `totalRevenue` | Sum of `normalized_revenue_lines.amountExVat` for active projects (all-time current rows). | **Change to month-scoped planned revenue** for selected month (planned view), aligned with dashboard planned cashflow conventions. |
| `totalCost` | Sum of `normalized_cost_lines.amountExVat` for active projects (all-time current rows). | **Change to month-scoped planned COS/expenditure** for selected month (planned view), aligned with dashboard planned cashflow conventions. |
| `blendedGpMarginPct` | `(totalRevenue - totalCost)/totalRevenue`. | Keep formula, but compute from the corrected month-scoped planned values. |
| `projectsAtRisk` | Active projects with `ragStatus` in RED/AMBER. | Keep as-is (optionally include `AT RISK` for parity with dashboard-metrics). |
| `avgHealthScore` | Avg positive `dashboard_project_metrics.healthScore`. | Keep as-is for management overview. |

### C. Engineering Monthly Report KPIs

**Code source of truth:** `generateEngineeringReportData(month)` in `server/services/engineering-monthly-report-service.ts`.

| KPI | Current code definition | Recommended business definition (for approval) |
|---|---|---|
| `totalEngineeringTasks` | ENG tasks on active projects. | Keep as-is. |
| `tasksCompletedThisMonth` | Tasks with `completedAt` in month. | Keep as-is. |
| `cumulativeCompletionRate` | `completed/total * 100`. | Keep as-is. |
| `monthlyCompletionRate` | `completedThisMonth / (completedThisMonth + activeTasks) * 100`. | Re-define if needed to `completedThisMonth / tasksInScopeThisMonth` for clearer month performance semantics. |
| `deliverablesSubmitted` | `createdAt in month` and current status `NEEDS APPROVAL`. | Consider event-based transition metric to avoid status drift bias. |
| `deliverablesApproved` | `updatedAt in month` and current status approved/complete. | Consider event-based transition metric. |
| `deliverablesRejected` | `updatedAt in month` and current status feedback. | Consider event-based transition metric. |
| `openBlockers` | Non-complete tasks overdue by selected month-end. | Keep for period-close reporting. |

---

## 2) Current code behavior references (validated)

- Admin operational overview KPI calculation and month windowing come from `calculateKPIs()` in `server/report-routes.ts`.
- PM monthly KPI object comes from `generatePmReportData()` in `server/services/pm-monthly-report-service.ts`.
- Engineering monthly KPI object comes from `generateEngineeringReportData()` in `server/services/engineering-monthly-report-service.ts`.
- Program/dashboard metric conventions already distinguish planned vs realised in several places (e.g., revenue/cost received/paid breakdown and planned cashflow/reporting structures), which supports the recommended month-scoped planned KPI updates above.

---

## 3) Suggested concrete KPI spec update (so we can implement next)

If you approve, I will implement the following exact changes:

1. **Operational Overview `activeProjects`**
   - Replace generic active filter with phase-window logic: from PD→PM handover through pre-client-handover completion.

2. **PM KPI tile change**
   - Replace `totalContractValue` with `actualRealisedRevenueMonth` sourced from monthly finance tracker.

3. **PM financial KPI scoping**
   - `totalRevenue` => `plannedRevenueMonth`
   - `totalCost` => `plannedCostMonth`
   - `blendedGpMarginPct` recomputed from above.

4. **Naming consistency**
   - Standardize on `clientHandoversPlanned` across admin + PM report payloads.

5. **Optional parity update**
   - Include `AT RISK` in `projectsAtRisk` status mapping for PM to match `dashboard-metrics` behavior.

---

## 4) Why these updates are more accurate

- They separate **planned vs actual realised** values (which the rest of the app already does in dashboard/finance logic).
- They align PM reporting to **execution accountability windows** (handover-to-handover lifecycle), not broad active flags.
- They avoid mixed-timeframe KPIs (all-time totals shown in a monthly report), improving month-on-month comparability.

