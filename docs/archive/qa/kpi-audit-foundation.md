# KPI Foundation-Up Audit (Canonical Path)

This audit records the canonical KPI path used by portfolio, dashboard, and KPI traceability routes/pages.

| KPI | Canonical source | Calculation rule | Dependent pages/endpoints |
|---|---|---|---|
| Average Project Progress % | `work_items` adapted as project plan | `computeProjectCompletion` duration-weighted actual/expected percentage and `delta` | `/api/portfolio-dashboard`, `/api/portfolios/:id/rollups`, Dashboard schedule cards, Portfolio pages |
| Project Health / Behind Count | canonical project completion deltas | `summarizeSchedule` thresholds (`delta < -5` behind, `< -10` at risk) | `/api/portfolio-dashboard`, `/api/portfolios/:id/rollups`, portfolio health badges |
| Engineering Completion % | `project_eng_stages.status` | `toCanonicalEngineeringStageStatus` + `summarizeEngineeringStatuses` | `/api/portfolio-dashboard`, `/api/portfolios/:id/rollups`, `/api/admin/kpi-traceability` |
| Quality Pass / Pending / Failed | `qc_item_instance.status` | `toCanonicalQualityStatus` + `summarizeQualityStatuses` | `/api/portfolio-dashboard`, `/api/portfolios/:id/rollups`, `/api/admin/kpi-traceability` |
| Gross Margin % | canonical financial rollups from normalized revenue/cost lines | `calculateGrossMarginPercent(actualRevenue, actualExpenses)` | `/api/portfolios/:id/rollups`, portfolio finance cards |
| KPI Traceability Metadata | `shared/kpi-definitions.ts` | Definitions provide source layer, business rule, aggregation path, and consumers | `/api/admin/kpi-traceability`, `client/src/pages/kpi-traceability.tsx` |

## Guardrails introduced
- Canonical status mapping for engineering and quality now lives in `shared/status-logic.ts`.
- KPI aggregation helpers now live in `server/services/kpi-service.ts` and are reused by multiple portfolio/KPI routes.
- KPI traceability now exposes `sourceLayer`, `businessRule`, and `aggregationPath` to discourage page-local KPI math.

## Remaining inconsistencies (not auto-changed)
- Several non-portfolio pages still compute local display-only percentages from already-aggregated API payloads; these should be gradually migrated to shared client selectors once endpoint contracts are aligned.
- Legacy `engineering_tasks` status semantics differ from `project_eng_stages`; this change standardizes project-stage KPIs but does not rewrite legacy task tables.
