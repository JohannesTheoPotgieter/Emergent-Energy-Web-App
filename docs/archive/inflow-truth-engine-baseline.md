# Inflow Truth-Engine Baseline & Behavioral Lock

> **Date**: 2026-04-09
> **Purpose**: Retroactive behavioral baseline for the 6 inflow methods already extracted into `server/repositories/finance-inflows-repository.ts`.
> **Status**: Extraction was completed in Wave 3 (commit `c74c21a`) WITHOUT pre-extraction baseline tests. This document and its companion test file lock down the extracted behavior retroactively.

---

## A. What Was Verified

**Repository file inspected:**
- `server/repositories/finance-inflows-repository.ts` (104 lines) — all 6 methods

**Helper file inspected:**
- `server/lib/data-merge.ts` lines 128–159 — `adaptRevenueToInflow` (23-field output shape)

**Consumer search**: 62 call sites across 14 route/department files (all go through `storage.*`).

---

## B. What Is Still Unknown

1. **`updateProgramInflowFields` has NO field validation gate** — unlike `updateProgramExpenseFields` which has a `validDbColumns` + `Object.keys(normalizedCostLines)` two-gate filter, the inflow update passes ALL unmapped keys through to the DB update (line 66–67: `const mapped = fieldMap[key] || key; mappedFields[mapped] = value;`). Whether this is intentional or an oversight is unverified.

2. **`getAllRevenueLinesForCashflow` is currently identical to `getAllProgramInflows`** — both read from `normalized_revenue_lines` with `effectiveTo IS NULL` and adapt via `adaptRevenueToInflow`. Whether these are intended to diverge in the future is unknown.

3. **`createManyProgramInflows` sets `description` from `milestoneName`, not `milestoneNotes`** (line 86). Whether this is intentional or a copy-paste artifact is unverified.

---

## C. Inflow Truth-Engine Method Map

| Method | Location | Tables | Helpers | Temporal | Shape Adapt | ID Canon | Special |
|--------|----------|--------|---------|----------|-------------|----------|---------|
| `getAllProgramInflows` | repo:20–28 | `normalized_revenue_lines`, `project_info` | `adaptRevenueToInflow`, `createNameResolver` | `effectiveTo IS NULL` | YES: 23-field shape | No | Name resolution via `createNameResolver` |
| `getAllRevenueLinesForCashflow` | repo:30–39 | `normalized_revenue_lines`, `project_info` | Same | `effectiveTo IS NULL` | YES | No | Identical to `getAllProgramInflows` currently |
| `getProgramInflowsByProject` | repo:42–47 | `normalized_revenue_lines` | `adaptRevenueToInflow` | `effectiveTo IS NULL` | YES | No | Project-scoped, no name resolver needed |
| `updateProgramInflowFields` | repo:49–79 | `normalized_revenue_lines` | `adaptRevenueToInflow` | No | YES: returns adapted | YES: negative/offset→base | 12-field map, NO validation gate, returns adapted row |
| `createManyProgramInflows` | repo:81–98 | `normalized_revenue_lines` | `adaptRevenueToInflow` | No | YES: returns adapted | No | 10-field input mapping, `importRunId: 0` hardcoded |
| `deleteProgramInflowsByProject` | repo:100–103 | `normalized_revenue_lines` | `softCloseByProjectName` | Soft-close | No | No | Temporal soft-close |

**Key structural differences from expense engine:**
- **No merge**: No `program_inflows` table overlay (unlike expense which overlays from `program_expense`)
- **No winner selection**: No `selectWinningExpenseRows` equivalent
- **No carry-forward**: No closed-row date inheritance
- **No cache**: No TTL cache or promise coalescing
- **No field validation gate in update**: Unmapped keys pass through (expense drops them)

---

## D. Consumer Map

### Dashboard-Critical (read-heavy)

| File | Methods | Call Sites |
|------|---------|------------|
| `cos-control-routes.ts` | `getAllProgramInflows` | 8 |
| `departments/project-routes.ts` | `getAllProgramInflows` | 5 |
| `departments/finance-routes.ts` | `getAllProgramInflows`, `getProgramInflowsByProject`, `getAllRevenueLinesForCashflow`, `updateProgramInflowFields` | 12 |
| `register-cashflow-2026-routes.ts` | `getAllProgramInflows` | 2 |
| `dashboard-routes.ts` | `getAllProgramInflows` | 1 |
| `home-extracted-routes.ts` | `getAllProgramInflows` | 1 |
| `overview-extracted-routes.ts` | `getAllProgramInflows` | 1 |

### Finance-Critical (write + read)

| File | Methods | Call Sites |
|------|---------|------------|
| `finance-legacy-extracted-routes.ts` | `getAllProgramInflows`, `getProgramInflowsByProject`, `updateProgramInflowFields` | 3 |
| `departments/financial-integration-routes.ts` | `getProgramInflowsByProject` | 3 |

### Import-Critical (bulk write + delete)

| File | Methods | Call Sites |
|------|---------|------------|
| `imports-admin-extracted-routes.ts` | `createManyProgramInflows`, `deleteProgramInflowsByProject` | 12 |
| `departments/admin-routes.ts` | `createManyProgramInflows`, `deleteProgramInflowsByProject` | 4 |

### Lower-Criticality

| File | Methods | Call Sites |
|------|---------|------------|
| `support-extracted-routes.ts` | `getAllProgramInflows` | 2 |
| `project-info-extracted-routes.ts` | `getAllProgramInflows`, `getProgramInflowsByProject` | 2 |

---

## E. Baseline Harness

### Test File: `qa/tests/unit/inflow-truth-engine-baseline.test.ts`

| Group | Tests | Coverage |
|-------|-------|----------|
| `adaptRevenueToInflow` field mapping | 12 tests | ID negation, all field mappings, fallback behavior, complete 23-field shape assertion |
| `inBank` flag derivation | 8 tests | payment+invoice=1, payment-only=0, invoice-only=0, manual override (true/1/"1"), dash/empty paidDate |
| `effectiveDate` fallback chain | 5 tests | paidDate→inBankDate→expectedPaymentDate→invoiceDate→falsy |
| `updateProgramInflowFields` field map | 3 tests | All 12 mappings, unmapped key passthrough (no validation gate), empty-returns-undefined |
| ID canonicalization | 3 tests | Negative→positive, 900000 offset→base, plain passthrough |
| `createManyProgramInflows` mapping | 2 tests | 10-field mapping, description←milestoneName behavior |
| Structural differences | 3 tests | No merge/winner, no cache, cashflow≡inflows currently |

---

## F. Exact Files Created

| File | Action | Purpose |
|------|--------|---------|
| `qa/tests/unit/inflow-truth-engine-baseline.test.ts` | Created | 7 test groups, ~300 lines |
| `docs/inflow-truth-engine-baseline.md` | Created | This document |

**No production files modified.**

---

## G. Extraction Gates

The extraction already happened. These gates serve as **regression guards**:

### Gate 1: Baseline Tests Pass
- [ ] `qa/tests/unit/inflow-truth-engine-baseline.test.ts` passes

### Gate 2: No Shape Drift
- [ ] `adaptRevenueToInflow` still produces exactly 23 fields
- [ ] Output field names match the baseline test assertions

### Gate 3: Field Map Stability
- [ ] `updateProgramInflowFields` field map still has 12 entries
- [ ] Unmapped keys still pass through (no validation gate added without review)

### Gate 4: No Accidental Unification
- [ ] `getAllRevenueLinesForCashflow` remains a separate method (even though currently identical to `getAllProgramInflows`)
- [ ] No merge/winner/carry-forward logic added to inflow methods

### Gate 5: Consumer Stability
- [ ] All 62 call sites still go through `storage.*` — no direct repository imports from routes

---

## H. Risks / Blind Spots

1. **No field validation gate in update**: `updateProgramInflowFields` accepts any key the caller sends. If a route passes a typo'd field name, it would be silently sent to the DB update (where it would likely be ignored by Drizzle/Postgres, but the behavior is different from the expense update which actively filters). This is pre-existing behavior, not introduced by extraction.

2. **`description` ← `milestoneName` in bulk create**: `createManyProgramInflows` line 86 sets `description: i.milestoneName || null`, not `i.milestoneNotes`. This means the `description` column gets the milestone name, not any notes. Pre-existing behavior.

3. **`importRunId: 0` hardcoded**: `createManyProgramInflows` line 93 hardcodes `importRunId: 0` for all bulk-created inflows. This differs from import-pipeline-created rows which get real run IDs. Pre-existing behavior.

---

## I. Recommendation

**The inflow extraction is already complete.** The retroactive baseline tests now lock down the behavior. No further extraction work is needed for inflows. The baseline tests should be run as part of the standard test suite to catch any future regressions.

The remaining unextracted finance methods in `storage.ts` are the **legacy expense/revenue adapters** (`getAllExpenses`, `getAllRevenues`, `getExpensesByProject`, `getRevenuesByProject`, `createExpense`, `createRevenue`, etc.) and their private mappers. These have very few consumers and could be addressed in a future cleanup wave.
