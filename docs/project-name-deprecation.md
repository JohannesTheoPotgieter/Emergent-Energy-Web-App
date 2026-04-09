# projectName Column Deprecation Plan

## Status: PHASE 1 — AUDIT COMPLETE

All tables below have both `projectName` (text) and `projectId` (integer FK to project_info).
The canonical key is `projectId`. The `projectName` column is deprecated and must not be
used in new code. It will be dropped after a 90-day observation window per table.

## 90-Day Window Rules

1. **Do not drop** any projectName column until 90 days after all reads are removed
2. **Do not stop writing** projectName until all reads are migrated to projectId joins
3. One table at a time — each drop in a separate PR
4. Make projectName nullable before dropping (separate PR)

## Inventory: Tables with Deprecated projectName

### finance.ts (19 tables — already marked @deprecated)

| # | SQL Table | Drizzle Name | @deprecated | Read Paths | Write Paths |
|---|-----------|-------------|-------------|------------|-------------|
| 1 | program_expense | programExpense | Yes | revenue-tracker, cos-tracker, cashflow, smart-import | smart-import commit |
| 2 | program_inflows | programInflows | Yes | revenue-tracker, cashflow, smart-import | smart-import commit |
| 3 | cashflow_points | cashflowPoints | Yes | cashflow routes | cashflow computation |
| 4 | finance_revenue_monthly | financeRevenueMonthly | Yes | finance routes | computation service |
| 5 | finance_cos_monthly | financeCosMonthly | Yes | finance routes | computation service |
| 6 | working_plan_scenario | workingPlanScenario | Yes | plan routes | plan service |
| 7 | working_plan_dependency_override | workingPlanDependencyOverride | Yes | plan routes | plan service |
| 8 | tracker_monthly_manual | trackerMonthlyManual | Yes | tracker routes | tracker routes |
| 9 | normalized_revenue_lines | normalizedRevenueLines | Yes | dashboard-metrics, finance, smart-import | smart-import commit |
| 10 | normalized_cost_lines | normalizedCostLines | Yes | dashboard-metrics, finance, smart-import | smart-import commit |
| 11 | invoice_captures | invoiceCaptures | Yes | invoice routes | invoice capture |
| 12 | expense_task_links | expenseTaskLinks | Yes | finance routes | smart-import |
| 13 | milestone_task_links | milestoneTaskLinks | Yes | finance routes | smart-import |
| 14 | forecast_pipeline | forecastPipeline | Yes | forecast routes | forecast service |
| 15 | lost_deals | lostDeals | Yes | forecast routes | forecast service |
| 16 | invoice_pattern_rules | invoicePatternRules | Yes | invoice-pattern routes | invoice-pattern routes |
| 17 | invoice_pattern_matches | invoicePatternMatches | Yes | invoice-pattern routes | invoice-pattern routes |
| 18 | financial_integration_rules | financialIntegrationRules | Yes | admin routes | admin routes |
| 19 | budget_baselines | budgetBaselines | Yes | financial-review service | financial-review service |

### imports.ts (6 tables — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated | Read Paths | Write Paths |
|---|-----------|-------------|-------------|------------|-------------|
| 20 | smart_import_runs | smartImportRuns | **No** | smart-import routes, import-control-tower | smart-import upload |
| 21 | issue_resolution_rules | issueResolutionRules | **No** | smart-import issue resolution | smart-import learning |
| 22 | normalized_plan_tasks | normalizedPlanTasks | **No** | smart-import, plan routes | smart-import commit |
| 23 | change_sets | changeSets | **No** | audit/diff engine | diff-engine record |
| 24 | plan_edit_notifications | planEditNotifications | **No** | (unused — notifications removed) | (unused) |
| 25 | import_logs | importLogs | **No** | import health dashboard | smart-import commit |

### quality.ts (4 tables — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated |
|---|-----------|-------------|-------------|
| 26 | qc_checklist | qcChecklist | **No** |
| 27 | qc_plan_link | qcPlanLink | **No** |
| 28 | qc_warning | qcWarning | **No** |
| 29 | qc_postmortem | qcPostmortem | **No** |

### collaboration.ts (3 tables — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated |
|---|-----------|-------------|-------------|
| 30 | notifications | notifications | **No** |
| 31 | audit_events | auditEvents | **No** |
| 32 | teams_chat_groups | teamsChatGroups | **No** |

### mytool.ts (3 tables — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated |
|---|-----------|-------------|-------------|
| 33 | mytool_tasks | mytoolTasks | **No** |
| 34 | mytool_recurrence_templates | mytoolRecurrenceTemplates | **No** |
| 35 | priority_links | priorityLinks | **No** |

### engineering.ts (1 table — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated |
|---|-----------|-------------|-------------|
| 36 | deliverables | deliverables | **No** |

### projects.ts (7 tables — need @deprecated)

| # | SQL Table | Drizzle Name | @deprecated |
|---|-----------|-------------|-------------|
| 37 | project_revenue_summary | projectRevenueSummary | **No** |
| 38 | project_editable_fields | projectEditableFields | **No** |
| 39 | project_team_members | projectTeamMembers | **No** |
| 40 | user_project_folders | userProjectFolders | **No** |
| 41 | derived_project_kpis | derivedProjectKpis | **No** |
| 42 | key_date_mappings | keyDateMappings | **No** |
| 43 | normalized_execution_phases | normalizedExecutionPhases | **No** |

## Migration Priority

### Tier 1 — High traffic, most query references
1. normalizedCostLines (already @deprecated)
2. normalizedRevenueLines (already @deprecated)
3. programExpense (already @deprecated)
4. programInflows (already @deprecated)
5. smartImportRuns (needs @deprecated)
6. normalizedPlanTasks (needs @deprecated)

### Tier 2 — Medium traffic
7-15. Quality, collaboration, and remaining finance tables

### Tier 3 — Low traffic or unused
16-43. mytool (being migrated to workItems), audit events, priority links, etc.

## CI Guardrail

After all @deprecated comments are added, new code should not introduce new
WHERE/ORDER BY/JOIN conditions using projectName on these tables. Use projectId + join instead.

## Notes

- `project_info.projectName` is NOT deprecated (it's the canonical source)
- `notifications.projectName` and `auditEvents.projectName` are display-only denormalized
  fields — lower priority since they're not used for filtering/joining
- `projectTeamMembers.projectName` is used as a primary lookup key in some routes — higher risk
