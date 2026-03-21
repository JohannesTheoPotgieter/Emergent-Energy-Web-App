# Architecture Audit — Final Cleanup Report

**Date:** 2026-03-21
**Branch:** `claude/architecture-audit-qOdnl`

## Summary

Cleanup prompts 1–10 completed. The codebase has been consolidated from a
dual-table architecture (legacy + canonical) to a single canonical data model
backed by `project_info`, `work_items`, and normalized financial tables.

---

## Metrics

| Metric                | Audit Baseline | After Cleanup | Delta        |
|-----------------------|----------------|---------------|--------------|
| Database tables       | 217            | 209           | -8 dropped   |
| pgEnum definitions    | 85             | 59            | -26 removed  |
| Schema lines          | 5,936          | 5,691         | -245         |
| API endpoints         | 1,090+         | 1,077         | -13 removed  |
| Frontend pages        | 73             | 73            | 0            |
| Frontend components   | 143+           | 125           | -18 removed  |
| Net lines changed     | —              | —             | -3,673       |
| Files changed         | —              | 177           | —            |

---

## Tables Dropped

| Table                        | Replacement                     |
|------------------------------|---------------------------------|
| `projects`                   | `project_info`                  |
| `expenses`                   | `normalized_cost_lines`         |
| `revenues`                   | `normalized_revenue_lines`      |
| `tasks`                      | `work_items`                    |
| `budgets`                    | FYE tracking tables             |
| `operational_tasks`          | `work_items`                    |
| `engineering_tasks`          | `work_items` (workstream=ENG)   |
| `expenditure_overrides`      | `program_expense` (inline)      |
| `revenue_tracking_overrides` | `program_inflows` (inline)      |
| `cashflow_planning_overrides`| `cashflow_points` (inline)      |
| `cos_status_overrides`       | `program_expense` (inline)      |

Schema definitions removed for migration artifact tables (pending DB DROP):
`task_migration_map`, `override_migration_orphans`, `override_migration_ambiguous`

---

## Endpoints Removed

| Method | Path                                | Replacement                        |
|--------|-------------------------------------|------------------------------------|
| GET    | `/api/expenses`                     | `/api/v2/projects/:id/finance`     |
| GET    | `/api/revenues`                     | `/api/v2/projects/:id/finance`     |
| GET    | `/api/budgets`                      | FYE tracking                       |
| POST   | `/api/budgets`                      | FYE tracking                       |
| DELETE | `/api/budgets/:id`                  | FYE tracking                       |
| GET    | `/api/scenarios/:id/overrides`      | Overrides baked into base tables   |
| POST   | `/api/scenarios/:id/overrides`      | Overrides baked into base tables   |
| DELETE | `/api/overrides/:id`                | Overrides baked into base tables   |
| GET    | `/api/finance/revenue/overrides`    | Overrides baked into base tables   |
| POST   | `/api/finance/revenue/overrides`    | Overrides baked into base tables   |
| DELETE | `/api/finance/revenue/overrides/:p` | Overrides baked into base tables   |
| GET    | `/api/finance/cos/overrides`        | Overrides baked into base tables   |
| POST   | `/api/finance/cos/overrides`        | Overrides baked into base tables   |
| DELETE | `/api/finance/cos/overrides/:p`     | Overrides baked into base tables   |

Duplicate budget routes also removed from `finance-routes.ts`.

---

## Components Removed (18)

DatabaseStatusBanner, DateRangeBar, EditableDataGrid, EpmChallengeModal,
FinancialIntegrationPanel, HandoverGatePanel, InteractiveTutorial,
KeyDatesPanel, MicroGuidance, ModuleContext, PmModeToggle, PostMortemPanel,
QmChallengeModal, QueryResult, ScenarioSelector, TaskGridView,
UploadValidationReport, my-tool-nav

---

## Server Files Removed

| File                                    | Reason                              |
|-----------------------------------------|-------------------------------------|
| `server/legacy-table-guard.ts`          | safeLegacyQuery no longer needed    |
| `server/services/domain-events.ts`      | Zero callers                        |
| `hooks/use-program-data.tsx`            | Zero consumers (replaced by hooks)  |

---

## Dead Routes Removed

| Path                      | Reason                          |
|---------------------------|---------------------------------|
| `/my-tool`                | Missing component (MyToolTodayPage) |
| `/my-tool/week`           | Missing component                |
| `/my-tool/backlog`        | Missing component                |
| `/my-tool/settings`       | Missing component                |
| `/my-tool/help`           | Missing component                |
| `/admin/legacy-utilities` | Missing component (AdminPage)    |

---

## Enums Removed (26)

**legacy.ts (6):** expenseStatusEnum, expenseCategoryEnum, revenueTypeEnum,
revenueStatusEnum, taskStatusEnum, budgetCategoryEnum

**collaboration.ts (9):** assigneeTypeEnum, entityAssignmentRoleEnum,
feedbackTicketTypeEnum, feedbackTicketStatusEnum, feedbackTicketPriorityEnum,
eeInfoNodeStatusEnum, eeInfoNodeCategoryEnum, eeInfoEdgeTypeEnum,
domainEventStatusEnum

**projects.ts (8):** projectStatusEnum, projectStageEnum, pdTicketStatusEnum,
pdRequestTypeEnum, pdFundingTypeEnum, pdProvinceEnum,
companyLifecyclePhaseEnum, portfolioStatusEnum

**finance.ts (1):** dependencyTypeEnum

**engineering.ts (1):** engTaskStatusEnum

**users.ts (1):** userRoleEnum

---

## Legacy API Client Functions Removed

`expensesApi`, `revenuesApi`, `tasksApi`, `budgetsApi`, `dashboardApi`,
`budgetsQueryOptions`, `dashboardQueryOptions`, `projectsQueryOptions`

Types removed: `Expense`, `Revenue`, `Task`, `Budget`, `CreateBudget`,
`DashboardData`

---

## Remaining Known Technical Debt

1. **`projectName` text columns** — 11 tables carry both `projectName` and
   `projectId`. All queries still filter by `projectName`. Requires a query
   migration pass before columns can be dropped.

2. **`work-items-adapter.ts`** — Active adapter with 7 consumers. Functions
   like `getWorkItemsAsOperationalTasks` still translate canonical data to
   legacy shapes. Should be inlined into callers over time.

3. **Legacy storage methods** — `storage.getAllProjects()`, `getAllExpenses()`,
   etc. still exist as compatibility wrappers querying `project_info` and
   mapping to legacy types. Callers should migrate to direct queries.

4. **Endpoints with frontend consumers** — `GET /api/tasks` and
   `GET /api/projects` (legacy) retained because frontend pages still use them.
   Frontend should migrate to V2 endpoints.

5. **Migration artifact tables** — `task_migration_map`,
   `override_migration_orphans`, `override_migration_ambiguous` need DB DROP
   once confirmed empty (schema definitions already removed).

---

## Validation Results

- **TypeScript:** `tsc --noEmit` — clean (0 errors)
- **Vite build:** clean (0 errors)
- **Remaining legacy references:** Only in migration/backfill scripts, string
  literals for `legacyTable` column values, permission entity names, and
  comments — all expected.
