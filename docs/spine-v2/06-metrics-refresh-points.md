# Prompt 12 — Dashboard Metrics Refresh Points

Documents all trigger points where `refreshProjectMetrics()` and `refreshProgramMetrics()` should be called after data mutations.

## Currently Wired (3 triggers)

| # | Trigger | File | Line | Refresh Call |
|---|---------|------|------|--------------|
| 1 | Smart import commit | `server/smart-import-routes.ts` | After `res.json()` in POST `/api/smart-import/:runId/commit` | `refreshProjectMetricsAsync(projectId)` |
| 2 | Revenue tracking override save | `server/departments/finance-routes.ts` | After `res.json()` in POST `/api/revenue-tracking/overrides` | `refreshProjectMetricsAsync(projectId)` per affected project |
| 3 | Phase change (lifecycle board) | `server/lifecycle-routes.ts` | After `res.json()` in PATCH `/api/lifecycle-board/projects/:id/phase` | `refreshProjectMetricsAsync(projectId)` |

## Future Triggers (not yet wired)

| # | Trigger | File | Route | Notes |
|---|---------|------|-------|-------|
| 4 | Expenditure override save | `server/departments/finance-routes.ts` | POST `/api/expenditure/overrides` | Multiple projects may be affected |
| 5 | Bulk import commit | `server/smart-import-routes.ts` | POST `/api/smart-import/bulk-commit` | Loop over committed project IDs |
| 6 | Phase change (engineering) | `server/engineering-routes.ts` | PATCH `/api/projects/:projectId/phase` | Alternative phase-change route |
| 7 | Project info update | `server/departments/project-routes.ts` | PATCH `/api/project-info/:id` | Phase/status fields |
| 8 | Finance revenue overrides | `server/departments/finance-routes.ts` | POST `/api/finance/revenue/overrides` | Revenue metrics |
| 9 | Finance COS overrides | `server/departments/finance-routes.ts` | POST `/api/finance/cos/overrides` | Cost metrics |
| 10 | Planning overrides | `server/departments/finance-routes.ts` | POST `/api/cashflow/planning-overrides` | Cashflow changes |
| 11 | COS toggle realised | `server/departments/finance-routes.ts` | PATCH `/api/cos-tracker/toggle-realised/:id` | Cost state change |
| 12 | Revenue date override | `server/departments/finance-routes.ts` | POST `/api/revenue-tab/:projectName/date-override` | Revenue timeline |
| 13 | Expense date override | `server/departments/finance-routes.ts` | POST `/api/expense-task-links/:projectName/:expenseId/date-override` | Cost timeline |
| 14 | Add expense line | `server/departments/finance-routes.ts` | POST `/api/expenses/add-line` | New cost row |
| 15 | QC warning create/resolve | `server/routes.ts` | POST/PATCH qc_warning endpoints | Warning count |
| 16 | Work item status change | `server/routes.ts` | PATCH work_item status | Task metrics |
| 17 | Import rollback | `server/smart-import-routes.ts` | POST `/api/smart-import/:runId/rollback` | Undo import |

## Refresh Strategy

### Fire-and-Forget (Current)
All triggers use `refreshProjectMetricsAsync()` which runs the recalculation in the background without blocking the HTTP response. Failures are logged but don't affect the user operation.

### Staleness Guarantee
- Project metrics are at most 1 mutation behind (refreshed after every trigger)
- Program metrics are refreshed after `refreshAllMetrics()` or can be called independently
- `last_refreshed_at` timestamp lets consumers know data freshness

### Full Rebuild
Call `refreshAllMetrics()` for a complete rebuild of all project + program metrics. This is suitable for:
- Scheduled cron jobs (e.g., nightly)
- Post-migration data repair
- Manual admin action

## Aggregation Sources

| Metric | Source Table(s) | Aggregation |
|--------|----------------|-------------|
| total_revenue | normalized_revenue_lines | SUM(amount_ex_vat) WHERE closed_at IS NULL |
| received_revenue | normalized_revenue_lines | SUM WHERE paid_date OR in_bank_date IS NOT NULL |
| total_cost | normalized_cost_lines | SUM(amount_ex_vat) WHERE closed_at IS NULL |
| paid_cost | normalized_cost_lines | SUM WHERE paid_date IS NOT NULL |
| margin_pct | Computed | (revenue - cost) / revenue |
| task_count | work_items | COUNT WHERE deleted_at IS NULL |
| tasks_completed | work_items | COUNT WHERE status IN (COMPLETE, COMPLETED, DONE) |
| tasks_overdue | work_items | COUNT WHERE end_date < today AND not completed |
| open_warnings | qc_warning | COUNT WHERE status = 'open' |
| qc_progress_pct | qc_item_instance | approved / total applicable items |
| health_score | Computed | 40% margin + 30% task_completion + 30% qc_progress |
