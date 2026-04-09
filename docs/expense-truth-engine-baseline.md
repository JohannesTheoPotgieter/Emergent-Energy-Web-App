# Expense Truth-Engine Baseline & Extraction Gates

> **Date**: 2026-04-09
> **Purpose**: Verified behavior map, baseline harness, and extraction pre-conditions for the remaining 8 expense methods in `server/storage.ts`.
> **Scope**: Pre-extraction baseline only. No code changes to production logic.

---

## A. What Was Verified

All claims verified by reading source code directly.

**Primary files inspected:**
- `server/storage.ts` lines 1100–1353, 1852–1893 — all 8 in-scope methods
- `server/lib/data-merge.ts` — `adaptCostToExpense` (126 lines), `createNameResolver`
- `server/lib/expense-row-selector.ts` — `selectWinningExpenseRows`, `getExpenseBusinessKey`, `isApprovedExpenseRow`
- `server/lib/temporal-helpers.ts` — `softCloseByProjectName`
- Existing test: `qa/tests/unit/expense-row-selector.test.ts`

**Consumer files verified via grep (93 call sites across 10 files):**
- `server/routes/cos-control-routes.ts` — 17 calls to `getAllProgramExpenses`
- `server/departments/finance-routes.ts` — broadest consumer (reads + writes)
- `server/routes/finance-legacy-extracted-routes.ts` — CRUD + manual create
- `server/routes/register-cashflow-2026-routes.ts` — cashflow view
- `server/routes/imports-admin-extracted-routes.ts` — bulk import/delete
- `server/departments/admin-routes.ts` — admin import/refresh
- `server/departments/financial-integration-routes.ts` — integration endpoints
- `server/routes/dashboard-routes.ts`, `home-extracted-routes.ts`, `overview-extracted-routes.ts`, `support-extracted-routes.ts`, `project-info-extracted-routes.ts`, `departments/project-routes.ts` — dashboard reads

---

## B. What Is Still Unknown

1. **Cache invalidation gap**: No write method (`updateProgramExpenseFields`, `createManualExpense`, `createManyProgramExpenses`) invalidates the 30s `_expenseCache`. Reads within 30s of a write may return stale data. Whether this is intentional or a known-acceptable tradeoff is unconfirmed.

2. **`program_expense` table write path**: `_fetchAllProgramExpenses` reads `program_expense` for budget overlays. Whether any active write path still inserts/updates `program_expense` rows (vs. `normalized_cost_lines`) is unverified. If no writes occur, the PE overlay is a read-only legacy bridge that could eventually be removed.

3. **`getAllCostLinesForCashflow` vs `getAllProgramExpenses` consumer expectations**: These two methods return different data (NCL-only vs NCL+PE merged). Some `finance-routes.ts` endpoints call one vs the other. Whether any consumer accidentally switched or relies on the difference is unverified.

4. **Carry-forward coverage in production**: The carry-forward logic in `getProgramExpensesByProject` (lines 1200–1232) is only triggered when `needsCarryForward` is true (some adapted rows lack both payment dates). Whether this condition occurs frequently or rarely in production data is unknown.

---

## C. Expense Truth-Engine Method Map

### C1. Read Methods

| Method | Lines | Tables | Helpers | Cache | Merge | Temporal | Shape Adapt | Special |
|--------|-------|--------|---------|-------|-------|----------|-------------|---------|
| `getAllProgramExpenses` | 1108–1126 | — | — | YES: 30s TTL + coalesce | — | — | — | Delegates to `_fetchAllProgramExpenses` behind cache |
| `_fetchAllProgramExpenses` | 1128–1175 | `normalized_cost_lines`, `program_expense`, `project_info` | `adaptCostToExpense`, `createNameResolver`, `selectWinningExpenseRows`, `getExpenseBusinessKey` | Populated by caller | YES: NCL adapted → PE budget overlay → combined winner selection | `effectiveTo IS NULL` on NCL and PE | YES: 45+ field adapted shape | PE→NCL budget overlay (6 fields), date overlay (4 fields) |
| `getProgramExpensesByProject` | 1190–1262 | `normalized_cost_lines`, `program_expense`, `project_info` | Same as above | No | YES: same merge + carry-forward | `effectiveTo IS NULL` on NCL active; `effectiveTo IS NOT NULL` on NCL closed (for carry-forward) | YES | Carry-forward: inherits payment dates from closed NCL rows |
| `getAllCostLinesForCashflow` | 1177–1188 | `normalized_cost_lines`, `project_info` | `adaptCostToExpense`, `createNameResolver`, `selectWinningExpenseRows` | No | NO PE merge | `effectiveTo IS NULL` | YES | Intentionally NCL-only, no PE overlay |

### C2. Write Methods

| Method | Lines | Tables | Helpers | Input Mapping | Output Shape | Special |
|--------|-------|--------|---------|---------------|-------------|---------|
| `createManyProgramExpenses` | 1264–1285 | `normalized_cost_lines` | `adaptCostToExpense` | PE→NCL: 14 field mapping | Adapted expense shape | Bulk insert, returns adapted rows |
| `deleteProgramExpensesByProject` | 1287–1290 | `normalized_cost_lines` | `softCloseByProjectName` | — | void | Temporal soft-close |
| `updateProgramExpenseFields` | 1292–1353 | `normalized_cost_lines` | `adaptCostToExpense` | PE→NCL: 17 field mapping | Adapted expense shape | ID canonicalization, optimistic locking (409 on conflict), field validation |
| `createManualExpense` | 1852–1893 | `normalized_cost_lines`, `project_info` | `adaptCostToExpense` | PE→NCL: 14 field mapping | Adapted expense shape | Policy: throws if no projectId. Resolves projectId from projectName. Idempotency key support. |

---

## D. Consumer Map

### Dashboard-Critical (read-heavy, high blast radius)

| File | Methods | Call Sites |
|------|---------|------------|
| `cos-control-routes.ts` | `getAllProgramExpenses` | 17 |
| `finance-routes.ts` | `getAllProgramExpenses`, `getProgramExpensesByProject`, `getAllCostLinesForCashflow`, `updateProgramExpenseFields` | 15+ |
| `project-routes.ts` | `getAllProgramExpenses` | 3 |
| `register-cashflow-2026-routes.ts` | `getAllProgramExpenses` | 2 |
| `dashboard-routes.ts` | `getAllProgramExpenses` | 1 |
| `home-extracted-routes.ts` | `getAllProgramExpenses` | 1 |
| `overview-extracted-routes.ts` | `getAllProgramExpenses` | 1 |

### Write-Critical (import/admin/manual)

| File | Methods | Call Sites |
|------|---------|------------|
| `imports-admin-extracted-routes.ts` | `createManyProgramExpenses`, `deleteProgramExpensesByProject` | 10 |
| `admin-routes.ts` | `createManyProgramExpenses`, `deleteProgramExpensesByProject` | 4 |
| `finance-legacy-extracted-routes.ts` | `getProgramExpensesByProject`, `updateProgramExpenseFields`, `createManualExpense` | 8 |
| `finance-routes.ts` | `createManualExpense`, `updateProgramExpenseFields` | 6 |
| `financial-integration-routes.ts` | `getProgramExpensesByProject`, `updateProgramExpenseFields` | 5 |

---

## E. Baseline Harness Design

### Artifact 1: Unit Tests (implemented)

**File**: `qa/tests/unit/expense-truth-engine-baseline.test.ts`

Tests the pure-function helpers that underpin the expense truth engine, without requiring a database:

| Test Group | Coverage |
|-----------|----------|
| `adaptCostToExpense` field mapping | ID negation, costCategory→expenseCategory, sourceRow→rowNumber, computedState derivation (Planned/Committed/Invoiced/Paid), _isNormalized flag |
| `selectWinningExpenseRows` merge | Approved beats non-approved, tie-breaking by timestamp then id, normalized vs legacy diagnostics, different business keys not merged |
| `getExpenseBusinessKey` determinism | projectId+sourceRow primary key, projectName fallback, id-only fallback, case normalization |
| PE budget overlay | Business-key matching, overlay application, no-match passthrough |
| Carry-forward simulation | Inherits from closed row, skips when active row has date, picks highest-id closed row |
| ID canonicalization | Negative→positive, 900000 offset→base, plain passthrough |
| `updateProgramExpenseFields` field mapping | All 17 PE→NCL mappings verified |
| `createManualExpense` field mapping | 14-field PE→NCL mapping, projectId policy |
| `createManyProgramExpenses` mapping | 14-field PE→NCL batch mapping |
| `createNameResolver` | Exact match, tracker suffix resolution, no-match passthrough |

### What the unit tests do NOT cover (requires DB)

- Actual SQL queries and result sets
- `_expenseCache` TTL and coalesce behavior (singleton on DatabaseStorage)
- Transaction propagation of dbInstance
- `effectiveTo IS NULL` filtering at query level
- Optimistic locking 409 response behavior
- Temporal soft-close execution

### Future Artifact: Integration Snapshot Test (not implemented — requires running DB)

A future integration test should:
1. Seed known NCL + PE + project_info rows
2. Call `getAllProgramExpenses()` and snapshot the result
3. Call `getProgramExpensesByProject("knownProject")` and snapshot
4. Call `getAllCostLinesForCashflow()` and snapshot
5. Compare snapshots before and after extraction

This cannot be implemented without a running database, which is out of scope for this task.

---

## F. Exact Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `qa/tests/unit/expense-truth-engine-baseline.test.ts` | Created | 10 test groups, ~320 lines, pins down all pure-function behavior |
| `docs/expense-truth-engine-baseline.md` | Created | This document — method map, consumer map, extraction gates |

**No production files modified.**

---

## G. Extraction Gates

These conditions MUST ALL be true before extracting expense methods into a repository:

### Gate 1: Baseline Tests Pass
- [ ] `qa/tests/unit/expense-truth-engine-baseline.test.ts` passes (all 10 groups)
- [ ] Existing `qa/tests/unit/expense-row-selector.test.ts` still passes

### Gate 2: Cache Singleton Decision
- [ ] Decide: does `_expenseCache` stay on `DatabaseStorage` or move to the repository?
- [ ] If it stays on `DatabaseStorage`, the repository is called through the cache wrapper — extraction is a private impl swap
- [ ] If it moves to the repository, the repository MUST be a singleton (not per-transaction)
- [ ] **Recommended**: keep cache on `DatabaseStorage`, extract `_fetchAllProgramExpenses` and the 7 other methods to the repository. `getAllProgramExpenses()` stays on `DatabaseStorage` as the cache wrapper calling `this.financeExpensesRepository._fetchAllProgramExpenses()`

### Gate 3: Helper Import Path Adjustment
- [ ] `adaptCostToExpense` is imported via `await import("./lib/data-merge")` — repository must use `await import("../lib/data-merge")`
- [ ] Same for `softCloseByProjectName`
- [ ] Verify no circular dependency introduced

### Gate 4: Write-After-Read Cache Staleness
- [ ] Document or resolve: after `updateProgramExpenseFields` or `createManualExpense`, the 30s cache may serve stale data
- [ ] If resolving: add `this._expenseCache = null` after writes. But this is a behavior change — requires explicit approval

### Gate 5: No Behavioral Drift
- [ ] `getAllProgramExpenses()` output must be identical before/after (same fields, same winner selection, same PE overlay)
- [ ] `getProgramExpensesByProject()` carry-forward must produce identical results
- [ ] `getAllCostLinesForCashflow()` must NOT gain PE overlay (currently intentionally NCL-only)
- [ ] `updateProgramExpenseFields()` field mapping must remain identical (17 PE→NCL mappings)
- [ ] `createManualExpense()` projectId policy must remain enforced
- [ ] ID canonicalization logic must be identical

### Gate 6: Transaction Safety
- [ ] New repository must accept `dbInstance` through constructor
- [ ] `imports-admin-extracted-routes.ts` calls `deleteProgramExpensesByProject` + `createManyProgramExpenses` inside transactions — the repository must receive the transactional DB handle

### Gate 7: No Hidden Consumers
- [ ] Grep confirms 93 call sites across 10 files — all go through `storage.*`
- [ ] No route directly imports the new repository

---

## H. Risks / Blind Spots Before Extraction

1. **Cache singleton is the #1 risk**: If extraction creates a new repository instance per `DatabaseStorage.transaction()` call, the cache would exist per-instance and be useless. The recommended approach (Gate 2) keeps the cache wrapper on `DatabaseStorage` and only extracts the implementation methods.

2. **`program_expense` table dependency**: `_fetchAllProgramExpenses` and `getProgramExpensesByProject` read from `program_expense` for budget overlays. The repository must import this table schema. If the PE table is eventually deprecated, the overlay code must be explicitly removed from the repository — it won't disappear automatically.

3. **`getAllCostLinesForCashflow` separation**: This method intentionally reads NCL-only (no PE merge). If someone "refactors" it to call `_fetchAllProgramExpenses` for DRY, they would add the PE overlay to cashflow and break the intentional separation. The repository must keep these as separate methods.

4. **Carry-forward reads closed rows**: `getProgramExpensesByProject` queries `effectiveTo IS NOT NULL` rows (closed/historical). This is unique among all finance methods — all others only read active rows. The repository must preserve this query.

5. **No integration test baseline**: Unit tests cover helper function behavior but cannot verify the full pipeline (DB query → adapt → merge → overlay → winner select). A snapshot-based integration test against a seeded DB would significantly reduce extraction risk.

---

## I. Recommendation

**Conditionally ready for extraction** — provided Gates 1–7 are satisfied.

**Recommended extraction approach**:

1. Create `server/repositories/finance-expenses-repository.ts` containing:
   - `_fetchAllProgramExpenses()` (the impl, not the cache wrapper)
   - `getProgramExpensesByProject()`
   - `getAllCostLinesForCashflow()`
   - `createManyProgramExpenses()`
   - `deleteProgramExpensesByProject()`
   - `updateProgramExpenseFields()`
   - `createManualExpense()`

2. Keep on `DatabaseStorage`:
   - `getAllProgramExpenses()` — the cache wrapper, which calls `this.financeExpensesRepository._fetchAllProgramExpenses()`
   - `_expenseCache`, `_expenseCachePromise`, `EXPENSE_CACHE_TTL_MS` — cache state stays on the singleton

3. This approach:
   - Preserves cache singleton behavior
   - Keeps the cache wrapper minimal (8 lines)
   - Moves all 250+ lines of complex logic to the repository
   - Follows the established repository pattern
   - Is trivially reversible

**What should NOT happen**:
- Do not move `getAllProgramExpenses()` including its cache to the repository — breaks singleton semantics
- Do not merge `getAllCostLinesForCashflow` into `_fetchAllProgramExpenses` — they are intentionally different
- Do not remove the PE overlay — it's still read for budget fields
- Do not add cache invalidation as part of extraction — that's a separate behavior change

---

*End of Expense Truth-Engine Baseline*
