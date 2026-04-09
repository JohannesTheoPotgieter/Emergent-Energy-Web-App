# Finance Wave 0 — Extraction Map for `server/storage.ts`

> **Purpose**: Real finance extraction map so we can decide the first finance extraction slice without breaking truth.
> **Date**: 2026-04-09
> **Scope**: `server/storage.ts` finance responsibilities only. No code changes. No schema changes.
> **Branch**: `claude/finance-wave-0-mapping-50Hth`

---

## A. What Was Verified

All claims below were verified by reading actual source code. Methods, line numbers, imports, tables, and call sites were inspected directly.

**Files read in full:**
- `server/storage.ts` (2518 lines) — the `IStorage` interface (lines 81–417) and `DatabaseStorage` class (lines 419–2518)
- `server/lib/data-merge.ts` (160 lines) — `adaptCostToExpense`, `adaptRevenueToInflow`, `createNameResolver`
- `server/lib/expense-row-selector.ts` (159 lines) — `selectWinningExpenseRows`, `getExpenseBusinessKey`, `getExpenseEffectiveDateAndSource`, `getCosEffectiveDateAndSource`, `getOutflowAmountBreakdown`
- `server/lib/temporal-helpers.ts` (136 lines) — `softCloseByProjectName`, `addTemporalColumns`, `TEMPORAL_TABLES`
- `server/lib/cashflow-helpers.ts` (143 lines) — `resolveInflowEffectiveDates`, `isDateConfirmedCheck`, `getMergedExpensesAndInflows`
- `server/lib/inline-edit-helper.ts` (174 lines) — `inlineEdit`, `revertToImported`, `applyFieldOverrides`
- `server/lib/finance/cos-realisation.ts` (34 lines) — `isCanonicalCosRealised`
- `server/lib/finance/revenue-ar-status.ts` (85 lines) — `isRevenueSettled`, `evaluateRevenueArStatus`
- `server/lib/finance/margin.ts` (52 lines) — `computeMarginPct`
- `server/lib/calculations/cashflow.ts` (143 lines) — `computeWeeklyCashflow`, `getLinesForWeek`
- All 6 existing repositories in `server/repositories/`

**Consumer files grepped and verified:**
- `server/routes/register-cashflow-2026-routes.ts`
- `server/routes/cos-control-routes.ts`
- `server/routes/finance-legacy-extracted-routes.ts`
- `server/routes/imports-admin-extracted-routes.ts`
- `server/routes/dashboard-routes.ts`
- `server/routes/home-extracted-routes.ts`
- `server/routes/overview-extracted-routes.ts`
- `server/routes/support-extracted-routes.ts`
- `server/routes/project-info-extracted-routes.ts`
- `server/departments/finance-routes.ts`
- `server/departments/project-routes.ts`
- `server/departments/admin-routes.ts`
- `server/departments/financial-integration-routes.ts`

---

## B. What Is Still Unknown

1. **Cache invalidation gap**: `getAllProgramExpenses()` has a 30s TTL cache (`_expenseCache`, line 1099). No write method in `storage.ts` invalidates this cache. After `updateProgramExpenseFields()` or `createManualExpense()`, stale data may be served for up to 30 seconds. Extraction must preserve this exact behavior (including the bug, if it is one) or intentionally fix it with explicit stakeholder agreement.

2. **Inline edit consumers**: `editBaseRowInline`, `revertBaseRowToImported`, `applyFieldOverridesInline` are defined on `DatabaseStorage` (lines 1686–1705) but are NOT on the `IStorage` interface (lines 81–417) and have ZERO external consumers found via grep. They may be dead code or invoked through a path not yet discovered. This needs confirmation before extraction.

3. **Legacy expense/revenue method usage**: `getAllExpenses()` and `getAllRevenues()` are consumed in `dashboard-routes.ts:1256-1257`, `project-routes.ts:1803-1804`, `admin-routes.ts:527`, and `support-extracted-routes.ts:69`. These read from `normalized_cost_lines` / `normalized_revenue_lines` with field mapping but WITHOUT the merge/winner logic. Whether these legacy readers are actively used by frontend clients is unverified.

4. **`programExpense` table reads**: `_fetchAllProgramExpenses` (line 1129) and `getProgramExpensesByProject` (line 1190) still read from the `program_expense` table for legacy budget overlay data. Whether this table still receives writes (outside of `createManyProgramExpenses` which now writes to `normalized_cost_lines`) is unverified.

5. **Revenue summary write path**: `upsertProjectRevenueSummary` exists in `storage.ts` (line 1880) but is NOT on the `IStorage` interface. Consumers found: `imports-admin-extracted-routes.ts` and `finance-routes.ts`. Access path is unverified.

---

## C. Finance Responsibility Map Inside `server/storage.ts`

### C1. Expense / Cost-Line Reads and Writes

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllProgramExpenses()` | 1103–1170 | `normalized_cost_lines`, `program_expense`, `project_info` | Read + Merge + Cache | **30s TTL cache** with coalesce. Reads NCL + PE, adapts NCL via `adaptCostToExpense`, overlays budget/date fields from PE winners, then runs `selectWinningExpenseRows` across merged set. Most complex finance read. | `data-merge.adaptCostToExpense`, `data-merge.createNameResolver`, `expense-row-selector.selectWinningExpenseRows`, `expense-row-selector.getExpenseBusinessKey` | Yes — outputs adapted expense-shaped rows with `_isNormalized`, `_cosOverride*` flags, negative IDs |
| `_fetchAllProgramExpenses()` | 1123–1170 | (same) | (impl) | Private impl behind cache | (same) | (same) |
| `getProgramExpensesByProject()` | 1185–1257 | `normalized_cost_lines`, `program_expense`, `project_info` | Read + Merge + Carry-forward | Per-project version. Includes **carry-forward logic** (lines 1195–1228): if active NCL rows lack payment dates, checks closed (effectiveTo != null) NCL rows for prior payment dates and carries them forward. Then overlays PE budget fields. Then winner selection. | Same as above | Yes — same shape + `_carryForward` flag |
| `getAllCostLinesForCashflow()` | 1172–1183 | `normalized_cost_lines`, `project_info` | Read only (no PE merge) | **Canonical cashflow cost read**. NCL only, no program_expense overlay. Adapts via `adaptCostToExpense`, then dedup via `selectWinningExpenseRows`. | `data-merge.adaptCostToExpense`, `expense-row-selector.selectWinningExpenseRows` | Yes — adapted shape |
| `createManyProgramExpenses()` | 1259–1280 | `normalized_cost_lines` | Write | Bulk insert. Maps PE-shaped input to NCL columns. Returns adapted rows. | `data-merge.adaptCostToExpense` | Yes — returns adapted |
| `deleteProgramExpensesByProject()` | 1282–1285 | `normalized_cost_lines` | Soft-close | Temporal soft-close via `softCloseByProjectName` | `temporal-helpers.softCloseByProjectName` | No |
| `updateProgramExpenseFields()` | 1287–1348 | `normalized_cost_lines` | Write + Map | Field-level update with **field name mapping** (PE names → NCL columns, lines 1289–1307), **ID canonicalization** (negative/offset IDs, line 1318), **optimistic locking** (line 1321–1336). Returns adapted row. | `data-merge.adaptCostToExpense` | Yes — returns adapted |
| `createManualExpense()` | 1964–2005 | `normalized_cost_lines`, `project_info` | Write | Creates single expense. Resolves projectId from projectName. **Policy enforcement**: throws if no valid projectId (line 1978). Returns adapted row. | `data-merge.adaptCostToExpense` | Yes — returns adapted |
| `getAllExpenses()` (legacy) | 620–624 | `normalized_cost_lines`, `project_info` | Read | Legacy adapter. Reads active NCL rows, maps via `mapCostLineToLegacyExpense`. No winner logic, no merge. | None (private mapper) | Yes — legacy `Expense` shape |
| `getExpensesByProject()` (legacy) | 626–631 | `normalized_cost_lines`, `project_info` | Read | Per-project legacy adapter. Same as above. | None | Yes — legacy shape |
| `createExpense()` (legacy) | 633–650 | `normalized_cost_lines`, `project_info` | Write | Legacy single create. Maps to NCL columns. | None | Yes — legacy shape |
| `deleteExpensesByProject()` (legacy) | 662–667 | `normalized_cost_lines` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |

### C2. Inflow / Revenue-Line Reads and Writes

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllProgramInflows()` | 1382–1390 | `normalized_revenue_lines`, `project_info` | Read | Reads active NRL rows, adapts via `adaptRevenueToInflow`. Simpler than expense equivalent — no merge, no winner logic. | `data-merge.adaptRevenueToInflow`, `data-merge.createNameResolver` | Yes — inflow shape with negative IDs |
| `getAllRevenueLinesForCashflow()` | 1392–1402 | `normalized_revenue_lines`, `project_info` | Read | **Canonical cashflow inflow read**. Identical to `getAllProgramInflows()` in current code. Comment says "no promoted fallback complexity". | Same | Yes — inflow shape |
| `getProgramInflowsByProject()` | 1404–1409 | `normalized_revenue_lines` | Read | Per-project. Simple adapt, no merge. | `data-merge.adaptRevenueToInflow` | Yes — inflow shape |
| `updateProgramInflowFields()` | 1350–1380 | `normalized_revenue_lines` | Write + Map | Field name mapping (inflow names → NRL columns, lines 1351–1364), ID canonicalization (line 1371). Returns adapted row. | `data-merge.adaptRevenueToInflow` | Yes — returns adapted |
| `createManyProgramInflows()` | 1411–1428 | `normalized_revenue_lines` | Write | Bulk insert. Maps inflow-shaped input to NRL columns. Returns adapted rows. | `data-merge.adaptRevenueToInflow` | Yes — returns adapted |
| `deleteProgramInflowsByProject()` | 1430–1433 | `normalized_revenue_lines` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |
| `getAllRevenues()` (legacy) | 670–674 | `normalized_revenue_lines`, `project_info` | Read | Legacy adapter. Maps via `mapRevenueLineToLegacyRevenue`. No merge. | None (private mapper) | Yes — legacy `Revenue` shape |
| `getRevenuesByProject()` (legacy) | 676–680 | `normalized_revenue_lines`, `project_info` | Read | Per-project legacy adapter. | None | Yes — legacy shape |
| `createRevenue()` (legacy) | 683–698 | `normalized_revenue_lines`, `project_info` | Write | Legacy single create. | None | Yes — legacy shape |
| `deleteRevenuesByProject()` (legacy) | 710–715 | `normalized_revenue_lines` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |

### C3. Cashflow Points

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllCashflowPoints()` | 1591–1593 | `cashflow_points` | Read | Plain CRUD. Filters `effectiveTo IS NULL`. | None | No |
| `getCashflowPointsByProject()` | 1595–1597 | `cashflow_points` | Read | Plain CRUD filtered by project. | None | No |
| `createManyCashflowPoints()` | 1599–1614 | `cashflow_points` | Write | Bulk insert with batch size 100. | None | No |
| `deleteCashflowPointsByProject()` | 1616–1619 | `cashflow_points` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |

### C4. Finance Monthly Tables (Revenue Monthly + COS Monthly)

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllFinanceRevenueMonthly()` | 1622–1624 | `finance_revenue_monthly` | Read | Plain CRUD. Filters `effectiveTo IS NULL`. | None | No |
| `getFinanceRevenueMonthlyByProject()` | 1626–1628 | `finance_revenue_monthly` | Read | Plain CRUD filtered. | None | No |
| `createManyFinanceRevenueMonthly()` | 1630–1645 | `finance_revenue_monthly` | Write | Bulk insert, batch 100. | None | No |
| `deleteFinanceRevenueMonthlyByProject()` | 1647–1650 | `finance_revenue_monthly` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |
| `getAllFinanceCosMonthly()` | 1653–1655 | `finance_cos_monthly` | Read | Plain CRUD. Filters `effectiveTo IS NULL`. | None | No |
| `getFinanceCosMonthlyByProject()` | 1657–1659 | `finance_cos_monthly` | Read | Plain CRUD filtered. | None | No |
| `createManyFinanceCosMonthly()` | 1661–1676 | `finance_cos_monthly` | Write | Bulk insert, batch 100. | None | No |
| `deleteFinanceCosMonthlyByProject()` | 1678–1681 | `finance_cos_monthly` | Soft-close | Temporal soft-close | `temporal-helpers.softCloseByProjectName` | No |

### C5. Project Revenue Summary

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllProjectRevenueSummaries()` | 1871–1873 | `project_revenue_summary` | Read | Filters `effectiveTo IS NULL`. | None | No |
| `getProjectRevenueSummary()` | 1875–1878 | `project_revenue_summary` | Read | By project, filtered. | None | No |
| `upsertProjectRevenueSummary()` | 1880–1895 | `project_revenue_summary` | Upsert (temporal) | Soft-closes existing, inserts new with `addTemporalColumns`. | `temporal-helpers.softCloseByProjectName`, `temporal-helpers.addTemporalColumns` | No |

### C6. Manual / Support Finance Tables

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `getAllCashflowWeeklyManual()` | 2028–2030 | `cashflow_weekly_manual` | Read | Plain CRUD. No temporal filter. | None | No |
| `upsertCashflowWeeklyManual()` | 2032–2043 | `cashflow_weekly_manual` | Upsert | Check-then-insert/update by weekStartDate. | None | No |
| `deleteCashflowWeeklyManual()` | 2045–2048 | `cashflow_weekly_manual` | Delete (hard) | Hard delete by weekStartDate. | None | No |
| `deleteAllCashflowWeeklyManualAfter()` | 2050–2060 | `cashflow_weekly_manual` | Delete (hard) | Hard deletes all rows >= weekStartDate. Returns deleted weeks. | None | No |
| `getBalanceHistory()` | 2062–2066 | `cashflow_balance_history` | Read | By weekStartDate, ordered desc. | None | No |
| `getAllBalanceHistory()` | 2068–2071 | `cashflow_balance_history` | Read | All rows, ordered desc. | None | No |
| `addBalanceHistory()` | 2073–2076 | `cashflow_balance_history` | Write | Insert single row. Append-only audit log. | None | No |
| `getAllOpexBudgetMonthly()` | 2078–2080 | `opex_budget_monthly` | Read | Plain CRUD. | None | No |
| `upsertOpexBudgetMonthly()` | 2082–2093 | `opex_budget_monthly` | Upsert | Check-then-insert/update by monthKey. | None | No |
| `getAllOpexWeeklyManual()` | 2095–2097 | `opex_weekly_manual` | Read | Plain CRUD. | None | No |
| `upsertOpexWeeklyManual()` | 2099–2110 | `opex_weekly_manual` | Upsert | Check-then-insert/update by weekStartDate. | None | No |
| `deleteOpexWeeklyManual()` | 2112–2114 | `opex_weekly_manual` | Delete (hard) | Hard delete. | None | No |
| `getAllAvailablePaymentOverrides()` | 2116–2118 | `available_payment_overrides` | Read | Plain CRUD. | None | No |
| `upsertAvailablePaymentOverride()` | 2120–2131 | `available_payment_overrides` | Upsert | Check-then-insert/update by weekStartDate. | None | No |
| `deleteAvailablePaymentOverride()` | 2133–2135 | `available_payment_overrides` | Delete (hard) | Hard delete. | None | No |
| `getAvailablePaymentHistory()` | 2137–2141 | `available_payment_history` | Read | By weekStartDate, ordered desc. | None | No |
| `addAvailablePaymentHistory()` | 2143–2146 | `available_payment_history` | Write | Append-only audit. | None | No |
| `getTrackerMonthlyManual()` | 2148–2150 | `tracker_monthly_manual` | Read | By trackerType. | None | No |
| `upsertTrackerMonthlyManual()` | 2152–2164 | `tracker_monthly_manual` | Upsert | Check-then-insert/update by trackerType + monthKey. | None | No |

### C7. Inline Edit Methods (not on IStorage interface)

| Method | Lines | Table(s) | R/W | Behavior | Calls Helpers | Adapts Shape |
|--------|-------|----------|-----|----------|---------------|-------------|
| `editBaseRowInline()` | 1686–1691 | (dynamic) | Write | Delegates to `inline-edit-helper.inlineEdit` | `inline-edit-helper.inlineEdit` | No |
| `revertBaseRowToImported()` | 1693–1696 | (dynamic) | Write | Delegates to `inline-edit-helper.revertToImported` | `inline-edit-helper.revertToImported` | No |
| `applyFieldOverridesInline()` | 1698–1705 | (dynamic) | Write | Delegates to `inline-edit-helper.applyFieldOverrides` | `inline-edit-helper.applyFieldOverrides` | No |

### C8. Caching Behavior

Only ONE finance method has caching:
- **`getAllProgramExpenses()`** — 30-second TTL in-memory cache (`_expenseCache`, `_expenseCachePromise`, `EXPENSE_CACHE_TTL_MS = 30_000`)
- Cache is populated on first call, coalesced for concurrent callers
- **No cache invalidation** exists anywhere in the codebase. Writes (e.g., `updateProgramExpenseFields`, `createManualExpense`) do NOT clear the cache
- Extraction MUST preserve this exact cache instance behavior

### C9. Temporal Soft-Close Behavior

All finance delete methods use temporal soft-close (setting `effective_to = NOW()`) instead of hard deletes:
- `deleteProgramExpensesByProject` → `softCloseByProjectName("normalized_cost_lines", ...)`
- `deleteProgramInflowsByProject` → `softCloseByProjectName("normalized_revenue_lines", ...)`
- `deleteCashflowPointsByProject` → `softCloseByProjectName("cashflow_points", ...)`
- `deleteFinanceRevenueMonthlyByProject` → `softCloseByProjectName("finance_revenue_monthly", ...)`
- `deleteFinanceCosMonthlyByProject` → `softCloseByProjectName("finance_cos_monthly", ...)`
- `upsertProjectRevenueSummary` → soft-closes then inserts new temporal version

All finance reads filter `WHERE effective_to IS NULL` to see only active rows.

**Exception**: The manual/support tables (C6) use **hard deletes** — `cashflow_weekly_manual`, `opex_weekly_manual`, `available_payment_overrides`. These tables do NOT have temporal columns.

### C10. Field Mapping / Row-Shape Adaptation

Three critical adapter functions transform DB rows into API-facing shapes:

1. **`adaptCostToExpense()`** (`data-merge.ts:46–126`): Transforms `normalized_cost_lines` → expense-shaped API rows. 45+ fields. Computes `computedState` (Planned/Committed/Invoiced/Paid), negates IDs (`id: -cost.id`), derives `effectivePaidDate`, sets `_isNormalized: true`, carries COS override flags.

2. **`adaptRevenueToInflow()`** (`data-merge.ts:128–159`): Transforms `normalized_revenue_lines` → inflow-shaped API rows. 25+ fields. Negates IDs, computes `inBank` flag, derives `effectiveDate`.

3. **`mapCostLineToLegacyExpense()`** (`storage.ts:496–511`): Simpler legacy mapping. No winner logic, no COS flags, no negative IDs.

4. **`mapRevenueLineToLegacyRevenue()`** (`storage.ts:513–525`): Simpler legacy mapping.

---

## D. Finance Consumer Map

### D1. Dashboard-Critical Consumers (high blast radius)

| Consumer File | Methods Used | Criticality |
|--------------|-------------|-------------|
| `server/routes/cos-control-routes.ts` | `getAllProgramExpenses` (17+ calls), `getAllProgramInflows`, `getAllMilestoneTaskLinks` | **Dashboard-critical**. COS dashboard — data quality, cost lines, variances. Heaviest single consumer of `getAllProgramExpenses`. Cache exists specifically for this file. |
| `server/departments/finance-routes.ts` | `getAllProgramExpenses`, `getAllProgramInflows`, `getAllCashflowPoints`, `getAllFinanceRevenueMonthly`, `getAllFinanceCosMonthly`, `getTrackerMonthlyManual`, `getAllCashflowWeeklyManual`, `getAllOpexBudgetMonthly`, `getAllOpexWeeklyManual`, `getAllBalanceHistory`, `updateProgramExpenseFields`, `getProgramInflowsByProject` | **Dashboard-critical**. Main finance department. Broadest consumer across all finance method groups. |
| `server/departments/project-routes.ts` | `getAllProgramExpenses`, `getAllMilestoneTaskLinks`, `getTrackerMonthlyManual`, `getAllExpenses` (legacy), `getAllRevenues` (legacy) | **Dashboard-critical**. Project detail views with expense aggregation. |
| `server/routes/register-cashflow-2026-routes.ts` | `getAllProgramExpenses`, `getAllProgramInflows`, `getAllMilestoneTaskLinks`, `getAllCashflowWeeklyManual`, `upsertCashflowWeeklyManual`, `deleteCashflowWeeklyManual`, `deleteAllCashflowWeeklyManualAfter`, `getAllOpexBudgetMonthly`, `upsertOpexBudgetMonthly`, `getAllOpexWeeklyManual`, `upsertOpexWeeklyManual`, `deleteOpexWeeklyManual`, `getAllAvailablePaymentOverrides`, `upsertAvailablePaymentOverride`, `deleteAvailablePaymentOverride`, `getBalanceHistory`, `getAllBalanceHistory`, `addBalanceHistory`, `addAvailablePaymentHistory` | **Dashboard-critical**. Cashflow 2026 view. Primary consumer of ALL manual/support finance tables. |
| `server/routes/dashboard-routes.ts` | `getAllProgramExpenses`, `getAllProgramInflows`, `getAllMilestoneTaskLinks`, `getAllExpenses` (legacy), `getAllRevenues` (legacy) | **Dashboard-critical**. Main dashboard views. |
| `server/routes/home-extracted-routes.ts` | `getAllProgramExpenses`, `getAllProgramInflows`, `getAllMilestoneTaskLinks`, `getProjectRevenueSummary` | **Dashboard-critical**. Home/summary page. |
| `server/routes/overview-extracted-routes.ts` | `getAllProgramExpenses`, `getAllProgramInflows`, `getAllMilestoneTaskLinks` | **Dashboard-critical**. Portfolio overview. |

### D2. Reconciliation / Integration-Critical Consumers

| Consumer File | Methods Used | Criticality |
|--------------|-------------|-------------|
| `server/routes/finance-legacy-extracted-routes.ts` | `getAllProgramExpenses`, `getProgramExpensesByProject`, `getProgramInflowsByProject`, `getAllProgramInflows`, `updateProgramInflowFields`, `updateProgramExpenseFields`, `createManualExpense`, `getExpenseTaskLinks` | **Reconciliation-critical**. Finance CRUD endpoints — inline edits, manual expense creation, field updates. |
| `server/departments/financial-integration-routes.ts` | `getProgramExpensesByProject`, `getProgramInflowsByProject` | **Integration-critical**. Financial data export/integration endpoints. |

### D3. Import-Critical Consumers

| Consumer File | Methods Used | Criticality |
|--------------|-------------|-------------|
| `server/routes/imports-admin-extracted-routes.ts` | `deleteProgramExpensesByProject`, `deleteProgramInflowsByProject`, `deleteCashflowPointsByProject`, `deleteFinanceRevenueMonthlyByProject`, `deleteFinanceCosMonthlyByProject`, `createManyProgramExpenses`, `createManyProgramInflows`, `createManyCashflowPoints`, `createManyFinanceRevenueMonthly`, `createManyFinanceCosMonthly` | **Import-critical**. File upload/parse pipeline. Transactional bulk create/delete. |
| `server/departments/admin-routes.ts` | Same bulk create/delete methods as above + `getAllExpenses` (legacy) | **Import-critical**. Admin project refresh/reimport. |

### D4. Lower-Criticality Consumers

| Consumer File | Methods Used | Criticality |
|--------------|-------------|-------------|
| `server/routes/support-extracted-routes.ts` | `getAllProgramInflows`, `getAllProgramExpenses`, `getAllRevenues` (legacy) | Support views. Lower blast radius. |
| `server/routes/project-info-extracted-routes.ts` | `getProgramExpensesByProject` | Project info detail. Narrow scope. |

### D5. Zero External Consumers (verified)

These methods exist on `DatabaseStorage` but had **zero grep matches** outside `storage.ts`:
- `editBaseRowInline()` — not on `IStorage` interface
- `revertBaseRowToImported()` — not on `IStorage` interface
- `applyFieldOverridesInline()` — not on `IStorage` interface
- `getExpensesByProject()` (legacy) — no external callers found
- `getRevenuesByProject()` (legacy) — no external callers found

---

## E. Finance Extraction Bands

### Band A — Safest Finance Support/Manual Tables

**Criteria**: Plain CRUD, no shape adaptation, no helper dependencies, no temporal soft-close, no merge logic, narrow consumer set.

| Method | Table | Justification |
|--------|-------|--------------|
| `getAllCashflowWeeklyManual()` | `cashflow_weekly_manual` | Plain select. No adaptation. Consumed by `register-cashflow-2026-routes.ts`, `cos-control-routes.ts`, `finance-routes.ts`. |
| `upsertCashflowWeeklyManual()` | `cashflow_weekly_manual` | Check-then-upsert. No adaptation. Same consumers. |
| `deleteCashflowWeeklyManual()` | `cashflow_weekly_manual` | Hard delete by key. Same consumers. |
| `deleteAllCashflowWeeklyManualAfter()` | `cashflow_weekly_manual` | Hard delete range. Same consumers. |
| `getBalanceHistory()` | `cashflow_balance_history` | Plain select by key. Consumed by `register-cashflow-2026-routes.ts`, `finance-routes.ts`. |
| `getAllBalanceHistory()` | `cashflow_balance_history` | Plain select all. Same consumers. |
| `addBalanceHistory()` | `cashflow_balance_history` | Append-only insert. Same consumers. |
| `getAllOpexBudgetMonthly()` | `opex_budget_monthly` | Plain select. Consumed by `register-cashflow-2026-routes.ts`, `finance-routes.ts`. |
| `upsertOpexBudgetMonthly()` | `opex_budget_monthly` | Check-then-upsert. Same consumers. |
| `getAllOpexWeeklyManual()` | `opex_weekly_manual` | Plain select. Same consumers. |
| `upsertOpexWeeklyManual()` | `opex_weekly_manual` | Check-then-upsert. Same consumers. |
| `deleteOpexWeeklyManual()` | `opex_weekly_manual` | Hard delete. Same consumers. |
| `getAllAvailablePaymentOverrides()` | `available_payment_overrides` | Plain select. Consumed by `register-cashflow-2026-routes.ts` only. |
| `upsertAvailablePaymentOverride()` | `available_payment_overrides` | Check-then-upsert. Same consumer. |
| `deleteAvailablePaymentOverride()` | `available_payment_overrides` | Hard delete. Same consumer. |
| `getAvailablePaymentHistory()` | `available_payment_history` | Plain select by key. Same consumer. |
| `addAvailablePaymentHistory()` | `available_payment_history` | Append-only insert. Same consumer. |
| `getTrackerMonthlyManual()` | `tracker_monthly_manual` | Plain select by type. Consumed by `finance-routes.ts`, `project-routes.ts`. |
| `upsertTrackerMonthlyManual()` | `tracker_monthly_manual` | Check-then-upsert. Same consumers. |

**Count**: 19 methods across 7 tables. All plain CRUD. Zero shape adaptation. Zero helper dependencies beyond drizzle.

### Band B — Medium-Risk Finance Persistence

**Criteria**: Plain CRUD but with temporal soft-close behavior OR bulk import semantics. No merge/winner logic, no shape adaptation in the storage method itself.

| Method | Table | Justification |
|--------|-------|--------------|
| `getAllCashflowPoints()` | `cashflow_points` | Plain select with `effectiveTo IS NULL` filter. No adaptation. |
| `getCashflowPointsByProject()` | `cashflow_points` | Plain filtered select. No adaptation. |
| `createManyCashflowPoints()` | `cashflow_points` | Bulk insert with batch sizing. No adaptation. |
| `deleteCashflowPointsByProject()` | `cashflow_points` | Temporal soft-close. Calls `softCloseByProjectName`. |
| `getAllFinanceRevenueMonthly()` | `finance_revenue_monthly` | Plain select, temporal filter. No adaptation. |
| `getFinanceRevenueMonthlyByProject()` | `finance_revenue_monthly` | Plain filtered. No adaptation. |
| `createManyFinanceRevenueMonthly()` | `finance_revenue_monthly` | Bulk insert. No adaptation. |
| `deleteFinanceRevenueMonthlyByProject()` | `finance_revenue_monthly` | Temporal soft-close. |
| `getAllFinanceCosMonthly()` | `finance_cos_monthly` | Plain select, temporal filter. No adaptation. |
| `getFinanceCosMonthlyByProject()` | `finance_cos_monthly` | Plain filtered. No adaptation. |
| `createManyFinanceCosMonthly()` | `finance_cos_monthly` | Bulk insert. No adaptation. |
| `deleteFinanceCosMonthlyByProject()` | `finance_cos_monthly` | Temporal soft-close. |
| `getAllProjectRevenueSummaries()` | `project_revenue_summary` | Plain select, temporal filter. |
| `getProjectRevenueSummary()` | `project_revenue_summary` | Filtered. |
| `upsertProjectRevenueSummary()` | `project_revenue_summary` | Temporal upsert (soft-close + insert). Calls `addTemporalColumns`. |

**Count**: 15 methods across 4 tables. All use temporal `effectiveTo IS NULL` filtering but have no shape adaptation and no merge logic. The soft-close dependency on `temporal-helpers.ts` is well-isolated and already shared across bands.

### Band C — High-Risk Finance Truth-Engine Methods

**Criteria**: Shape adaptation, merge/winner logic, field mapping, carry-forward logic, caching, or ID canonicalization. These methods define the API contract for finance dashboards.

| Method | Risk Factors |
|--------|-------------|
| `getAllProgramExpenses()` | **Highest risk.** 30s cache + coalesce. Reads NCL + PE. Adapts via `adaptCostToExpense`. Overlays budget/date from PE winners. Final winner selection across merged set. 17+ route consumers. Output shape = 45+ field API contract. |
| `_fetchAllProgramExpenses()` | Private impl of above. Same risk. |
| `getProgramExpensesByProject()` | **High risk.** Same merge + adapt as above PLUS carry-forward logic for missing payment dates from closed rows. 8 route consumers. |
| `getAllCostLinesForCashflow()` | **Medium-high risk.** NCL-only canonical read (no PE merge), but still adapts shape and runs winner dedup. Cashflow truth path. |
| `getAllProgramInflows()` | **Medium risk.** Adapts via `adaptRevenueToInflow`. No merge, but output shape is API contract. 12+ consumers. |
| `getAllRevenueLinesForCashflow()` | **Medium risk.** Identical to `getAllProgramInflows` currently. Cashflow truth path. |
| `getProgramInflowsByProject()` | **Medium risk.** Per-project adapt. Simpler than expense equivalent. |
| `updateProgramExpenseFields()` | **High risk.** Field name mapping (PE→NCL), ID canonicalization (negative/offset), optimistic locking, returns adapted row. Contract-sensitive. |
| `updateProgramInflowFields()` | **Medium-high risk.** Field name mapping (inflow→NRL), ID canonicalization, returns adapted row. |
| `createManyProgramExpenses()` | **Medium risk.** Maps PE-shaped input → NCL columns. Returns adapted rows. Write contract. |
| `createManyProgramInflows()` | **Medium risk.** Maps inflow-shaped input → NRL columns. Returns adapted rows. |
| `createManualExpense()` | **Medium-high risk.** Policy enforcement (must have projectId), field mapping, returns adapted row. |
| `deleteProgramExpensesByProject()` | **Low-medium risk.** Just temporal soft-close, but included here because it's in the expense truth path. |
| `deleteProgramInflowsByProject()` | **Low-medium risk.** Same — temporal soft-close on inflow path. |

**Count**: 14 methods. All touch the expense/inflow truth path. All either adapt output shapes or have merge/mapping/cache semantics.

### Band D — Do Not Extract Until Baseline Tests Exist

| Method | Reason |
|--------|--------|
| `getAllProgramExpenses()` | Cannot be safely moved until a snapshot-based integration test validates that the merged output (NCL + PE overlay + winner selection) produces identical results before and after extraction. The cache behavior must also be preserved or explicitly changed. |
| `getProgramExpensesByProject()` | Cannot be safely moved until carry-forward logic has snapshot tests. The closed-row lookup + date inheritance is business-critical and has no existing test coverage visible in the repo. |
| `updateProgramExpenseFields()` | The field mapping + ID canonicalization + optimistic locking must have contract tests before extraction. A wrong field mapping silently corrupts data. |

**Count**: 3 methods. These are the most dangerous to extract without test infrastructure.

---

## F. Output-Contract-Sensitive Methods and Why

These methods are flagged because even a "mechanically identical" extraction could break consumers if any subtle behavior changes.

### F1. `getAllProgramExpenses()` — CRITICAL

| Risk | Detail |
|------|--------|
| **Merged row selection** | Reads from TWO tables (`normalized_cost_lines` + `program_expense`), adapts NCL, overlays PE budget/date fields onto adapted NCL by business key, then runs `selectWinningExpenseRows` across the combined set. Winner logic uses approval status → approved date → updated timestamp → ID tiebreaker. Changing read order, key matching, or winner sort could silently change which row wins. |
| **Field mapping** | `adaptCostToExpense` produces 45+ fields. ID negation (`id: -cost.id`), `computedState` derivation, `effectivePaidDate` fallback chain, `_isNormalized` flag. Any drift breaks downstream COS, cashflow, and dashboard consumers. |
| **Cache semantics** | 30s TTL with promise coalesce. If extraction creates a new repository instance per request (instead of singleton), the cache would be per-instance and useless. Must preserve singleton cache. |
| **Legacy overlay** | PE rows contribute budget fields (`budgetTotal`, `budgetQty`, `budgetRateUnit`, `budgetCosTotal`) and date fields (`forecastPaymentDate`, `computedForecastPaymentDate`, admin overrides). These are grafted onto NCL-adapted rows by business key. If PE table eventually goes away, this overlay must be explicitly removed, not accidentally dropped. |

### F2. `getProgramExpensesByProject()` — CRITICAL

| Risk | Detail |
|------|--------|
| **Carry-forward logic** | Lines 1195–1228: if active NCL rows lack payment dates, queries CLOSED NCL rows (effectiveTo IS NOT NULL) for the same sourceRow and inherits their payment date. Sets `_carryForward: true` flag and `paymentDateFontColor: "red"`. This is business logic embedded in storage. |
| **Same merge/overlay as F1** | Plus carry-forward on top. |

### F3. `updateProgramExpenseFields()` — HIGH

| Risk | Detail |
|------|--------|
| **Field name mapping** | Maps 16 PE-facing field names to NCL column names (lines 1289–1307). E.g., `expenseCategory` → `costCategory`, `expensePaymentDate` → `paidDate`. A wrong mapping silently writes to the wrong column. |
| **ID canonicalization** | `id < 0 ? -id : (id >= 900000 ? id - 900000 : id)` (line 1318). Consumers send negative IDs (from `adaptCostToExpense`). Storage must un-negate them. If extraction changes ID handling, updates silently fail or hit wrong rows. |
| **Optimistic locking** | Compares `expectedUpdatedAt` timestamps and throws 409 on mismatch (lines 1321–1336). Must be preserved. |

### F4. `updateProgramInflowFields()` — MEDIUM-HIGH

| Risk | Detail |
|------|--------|
| **Field name mapping** | 12 inflow-facing field names → NRL columns (lines 1351–1364). Same silent corruption risk. |
| **ID canonicalization** | Same negative/offset logic (line 1371). |

### F5. `getAllCostLinesForCashflow()` — MEDIUM-HIGH

| Risk | Detail |
|------|--------|
| **Different from `getAllProgramExpenses`** | Intentionally reads NCL only (no PE overlay). But still adapts shape and runs winner dedup. If someone "refactors" this to call `getAllProgramExpenses` for DRY, they would add the PE overlay to cashflow and break the intentional separation. |
| **Row ordering** | `selectWinningExpenseRows` doesn't guarantee output order. If any consumer depends on implicit ordering, extraction must not change it. |

### F6. `createManualExpense()` — MEDIUM

| Risk | Detail |
|------|--------|
| **Policy enforcement** | Throws if no valid `projectId` (line 1978). This is a business rule in storage. If extracted to a repository, the policy must travel with it. |
| **Field mapping** | Maps 14 PE-shaped fields to NCL columns (lines 1982–1998). |

### F7. `createManyProgramExpenses()` / `createManyProgramInflows()` — MEDIUM

| Risk | Detail |
|------|--------|
| **Input field mapping** | Maps PE/inflow-shaped input objects to NCL/NRL column names. The mapping is slightly different from `updateProgramExpenseFields` mapping. Both must stay consistent. |
| **Return shape** | Returns adapted rows. Consumers may depend on exact return fields. |

### F8. `upsertProjectRevenueSummary()` — LOW-MEDIUM

| Risk | Detail |
|------|--------|
| **Temporal upsert pattern** | Soft-closes existing, inserts new with `addTemporalColumns`. Not a simple upsert. Pattern must be preserved exactly. |

---

## G. Candidate Finance Slice Ranking

Slices ranked from safest to most dangerous using: blast radius, business criticality, validation ease, overlap with merge/overlay logic, overlap with dashboard truth, overlap with legacy compatibility, reversibility.

### Slice 1: Manual/Support Finance Tables (Band A)

| Factor | Rating |
|--------|--------|
| **Blast radius** | LOW — 2-3 consumer files (`register-cashflow-2026-routes.ts`, `finance-routes.ts`, `project-routes.ts`) |
| **Business criticality** | Medium — cashflow opening balances, OPEX budgets, payment overrides |
| **Validation ease** | HIGH — all plain CRUD with no shape transformation. Can validate with simple read-after-write tests. |
| **Merge/overlay overlap** | NONE |
| **Dashboard truth overlap** | LOW — these are input parameters TO dashboards, not computed truth |
| **Legacy compatibility overlap** | NONE |
| **Reversibility** | HIGH — trivially reversible by pointing delegate methods back to inline implementations |

**Methods**: 19 methods, 7 tables. See Band A above.

### Slice 2: Finance Monthly + Cashflow Points (Band B, non-summary)

| Factor | Rating |
|--------|--------|
| **Blast radius** | LOW-MEDIUM — primarily `finance-routes.ts`, `imports-admin-extracted-routes.ts`, `admin-routes.ts` |
| **Business criticality** | Medium — finance monthly aggregation data |
| **Validation ease** | HIGH — plain temporal CRUD. Soft-close behavior is mechanical. |
| **Merge/overlay overlap** | NONE |
| **Dashboard truth overlap** | LOW — these are stored aggregates, not source-of-truth expense/inflow lines |
| **Legacy compatibility overlap** | NONE |
| **Reversibility** | HIGH |

**Methods**: 12 methods, 3 tables (`cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly`).

### Slice 3: Revenue Summary (Band B, temporal upsert)

| Factor | Rating |
|--------|--------|
| **Blast radius** | LOW — `imports-admin-extracted-routes.ts`, `finance-routes.ts` |
| **Business criticality** | Medium — project revenue summary |
| **Validation ease** | MEDIUM — temporal upsert pattern needs care |
| **Merge/overlay overlap** | NONE |
| **Dashboard truth overlap** | MEDIUM — feeds into home dashboard revenue display |
| **Legacy compatibility overlap** | LOW |
| **Reversibility** | HIGH |

**Methods**: 3 methods, 1 table (`project_revenue_summary`).

### Slice 4: Inflow reads/writes (Band C, simpler half)

| Factor | Rating |
|--------|--------|
| **Blast radius** | MEDIUM — 12+ consumers |
| **Business criticality** | HIGH — revenue truth |
| **Validation ease** | MEDIUM — shape adaptation via `adaptRevenueToInflow` needs contract tests |
| **Merge/overlay overlap** | LOW — no multi-table merge (unlike expenses) |
| **Dashboard truth overlap** | HIGH |
| **Legacy compatibility overlap** | LOW |
| **Reversibility** | MEDIUM |

**Methods**: ~10 methods.

### Slice 5: Expense reads/writes (Band C+D, most complex)

| Factor | Rating |
|--------|--------|
| **Blast radius** | HIGHEST — 17+ consumers for `getAllProgramExpenses` alone |
| **Business criticality** | HIGHEST — expense truth engine |
| **Validation ease** | LOW — merge logic, winner selection, carry-forward, cache, ID canonicalization all need comprehensive tests |
| **Merge/overlay overlap** | MAXIMUM — NCL + PE overlay + winner selection |
| **Dashboard truth overlap** | MAXIMUM — feeds COS, cashflow, project detail, home |
| **Legacy compatibility overlap** | HIGH — PE table still read for overlay |
| **Reversibility** | LOW — cache singleton must be preserved; rollback requires careful re-delegation |

**Methods**: ~14 methods. Should be LAST.

---

## H. Recommendation: First Finance Slice and Why

**First slice: Band A — Manual/Support Finance Tables**

Create `server/repositories/finance-support-repository.ts` containing these 19 methods across 7 tables:

```
cashflow_weekly_manual     — getAllCashflowWeeklyManual, upsertCashflowWeeklyManual,
                             deleteCashflowWeeklyManual, deleteAllCashflowWeeklyManualAfter
cashflow_balance_history   — getBalanceHistory, getAllBalanceHistory, addBalanceHistory
opex_budget_monthly        — getAllOpexBudgetMonthly, upsertOpexBudgetMonthly
opex_weekly_manual         — getAllOpexWeeklyManual, upsertOpexWeeklyManual, deleteOpexWeeklyManual
available_payment_overrides — getAllAvailablePaymentOverrides, upsertAvailablePaymentOverride,
                              deleteAvailablePaymentOverride
available_payment_history  — getAvailablePaymentHistory, addAvailablePaymentHistory
tracker_monthly_manual     — getTrackerMonthlyManual, upsertTrackerMonthlyManual
```

**Why this slice:**
1. **Zero shape adaptation** — all methods return raw DB rows. No `adaptCostToExpense`, no `adaptRevenueToInflow`, no field mapping.
2. **Zero helper dependencies** — no imports from `data-merge.ts`, `expense-row-selector.ts`, or `temporal-helpers.ts`. Only drizzle ORM.
3. **Zero merge/winner logic** — no multi-table reads, no business key matching, no carry-forward.
4. **Zero caching** — no cache to break or preserve.
5. **No temporal soft-close** — these tables use hard deletes (they're admin-managed parameters, not imported data).
6. **Narrow consumer set** — primarily `register-cashflow-2026-routes.ts` and `finance-routes.ts`. `cos-control-routes.ts` uses `getAllCashflowWeeklyManual` only.
7. **Follows established pattern** — mirrors `ProjectSupportRepository` extraction pattern (simple delegation from `DatabaseStorage`).
8. **Trivially reversible** — if anything goes wrong, restore inline implementations in minutes.

**Extraction pattern** (following existing repository precedent):
1. Create `server/repositories/finance-support-repository.ts` with the class
2. Add `private readonly financeSupportRepository: FinanceSupportRepository` to `DatabaseStorage`
3. Change each method body to `return this.financeSupportRepository.methodName(...)`
4. Add the repository to `IStorage` interface — no interface signature changes needed since method signatures are unchanged
5. Verify all 3 consumer files still compile and serve identical responses

---

## I. What Should Explicitly NOT Be First

1. **`getAllProgramExpenses()`** — must not be extracted until:
   - Snapshot-based integration test validates merged NCL+PE output
   - Cache singleton behavior is explicitly designed for repository pattern
   - 17+ consumer endpoints are cataloged with expected response shapes

2. **`getProgramExpensesByProject()`** — must not be extracted until:
   - Carry-forward logic has test coverage
   - Closed-row query behavior is documented and tested

3. **`updateProgramExpenseFields()`** — must not be extracted until:
   - Field mapping table (PE names → NCL columns) has explicit test coverage
   - ID canonicalization logic has test coverage
   - Optimistic locking has test coverage

4. **Any method that calls `adaptCostToExpense` or `adaptRevenueToInflow`** — these adapters produce the API contract. Extraction must not change which adapter is called or how.

5. **The legacy `getAllExpenses()`/`getAllRevenues()` methods** — although simpler, they read from the same tables as the canonical methods and any extraction confusion between legacy and canonical paths could cause routing errors.

---

## J. Guardrails and Validation Gates for Finance PRs

### Gate 1: Pre-Extraction Checklist
- [ ] New repository file follows existing pattern (`server/repositories/*.ts`)
- [ ] Constructor accepts `dbInstance` parameter for transaction support
- [ ] No new imports beyond what the methods already use
- [ ] No behavior changes — pure mechanical extraction
- [ ] `IStorage` interface unchanged (same method signatures)

### Gate 2: Compile Gate
- [ ] `tsc --noEmit` passes
- [ ] No new TypeScript errors

### Gate 3: Runtime Verification
- [ ] Each extracted method returns identical results to pre-extraction
- [ ] For Band A: verify each upsert/delete path by calling the route endpoint
- [ ] For Band B+: verify temporal soft-close produces identical row states
- [ ] For Band C+: snapshot output of `getAllProgramExpenses()` before and after must be byte-identical

### Gate 4: Rollback Protocol
- [ ] Keep old inline method bodies as comments for 1 sprint (or in a revert commit)
- [ ] Repository can be bypassed by restoring inline implementations
- [ ] No consumer file changes required for rollback

### Gate 5: Cache Preservation (Band C+ only)
- [ ] `_expenseCache` must remain a singleton on the `DatabaseStorage` instance, NOT on the repository
- [ ] If repository is instantiated per-transaction, cache must stay on the outer storage object
- [ ] Verify cache coalesce still works with concurrent requests

---

## K. Questions/Blockers Before Finance Wave 1

1. **Cache invalidation decision**: The 30s `_expenseCache` is never invalidated by writes. Is this intentional? If Wave 1 touches `getAllProgramExpenses`, should we add cache invalidation to `updateProgramExpenseFields` and `createManualExpense`, or preserve the current 30s stale window?

2. **Inline edit methods**: `editBaseRowInline`, `revertBaseRowToImported`, `applyFieldOverridesInline` are on `DatabaseStorage` but NOT on `IStorage` and have zero external consumers. Are these dead code? If alive, they need to be added to `IStorage` before extraction or explicitly removed.

3. **`program_expense` table future**: `_fetchAllProgramExpenses` still reads `program_expense` for budget overlay. Is there a plan to migrate these budget fields into `normalized_cost_lines`? If so, the overlay logic will eventually be removable, and we should avoid entrenching it in a new repository.

4. **Legacy method cleanup**: `getAllExpenses`, `getAllRevenues`, `getExpensesByProject`, `getRevenuesByProject` and their private mappers (`mapCostLineToLegacyExpense`, `mapRevenueLineToLegacyRevenue`) are consumed by 4 route files. Can these be deprecated before finance extraction to reduce the surface area?

5. **Test infrastructure**: No finance-specific integration tests were found in the repo. Before Band C extraction, should we create a test harness that snapshots `getAllProgramExpenses()` output and validates it against a known baseline?

6. **`upsertProjectRevenueSummary` interface gap**: This method exists on `DatabaseStorage` but is not on the `IStorage` interface. It is consumed by `imports-admin-extracted-routes.ts` and `finance-routes.ts`. Should it be added to the interface before extraction?

7. **Transaction support**: The existing repository pattern passes `dbInstance` through constructors. Band A methods don't use transactions, but Band B+ methods are called within import transactions (`imports-admin-extracted-routes.ts`). The repository must accept the transactional DB instance. This is already the pattern used by existing repositories, so it should work, but needs verification.

---

*End of Finance Wave 0 Extraction Map*
