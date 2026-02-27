# Foundation → KPI → Dashboard Cascade Validation

## Cascade Chain: Source Data → Calculation → API → Dashboard

### 1. Project Completion (Act% / Expected% / Delta)

**Foundation:** `project_plan` table
- Fields: `percentComplete`, `durationDays`, `actualStart`, `actualEnd`

**Calculation:** `computeProjectCompletion()` in `server/portfolio-routes.ts`
- Duration-weighted average of `percentComplete` → Act%
- Duration-weighted linear interpolation of date range → Expected%
- Delta = Act% - Expected%

**API Consumers:**
- `GET /api/portfolio-dashboard` → Portfolio Dashboard
- `GET /api/pm/dashboard` → PM Dashboard
- `GET /api/projects/:name` → Project Detail

**Dashboard Display:**
- Portfolio Dashboard: Progress bars, health indicators
- Gantt Chart: Progress fill, slippage warnings (>5% behind)
- PM Dashboard: Project cards with Act% vs Expected%

**Golden Assertions (Unit Tests):**
1. Empty plan → 0% Act, 0% Expected, 0 Delta ✅
2. Single task 50% → 50% Act ✅
3. Two equal tasks (100%, 0%) → 50% Act ✅
4. Weighted (30d@100%, 10d@0%) → 75% Act ✅
5. Past-end date → 100% Expected ✅
6. Future-start date → 0% Expected ✅
7. Ahead of schedule → positive delta ✅
8. Behind schedule → negative delta ✅

### 2. COS Aggregation (Realised / Unrealised / Outstanding)

**Foundation:** `program_expense` table
- Fields: `amount`, `status` (Planned/Committed/Invoiced/Paid)

**Calculation:** `aggregateCOS()` in `server/lib/calculations/cosAggregator.ts`
- Buckets amounts by status
- Total Outstanding = Committed + Invoiced
- Total Realised = Invoiced + Paid
- Forecast windows: 4w, 8w, 12w based on `forecastPaymentDate`

**API Consumers:**
- `GET /api/cos-tracker` → COS Tracker
- `GET /api/pm/dashboard` → PM Dashboard (COS summary)
- `GET /api/portfolio-dashboard?viewMode=finance` → Portfolio Finance

**Golden Assertions (Unit Tests):**
9. Status bucketing (Planned:100, Committed:200, Invoiced:300, Paid:400) ✅
10. Total Outstanding = 500 (Committed + Invoiced) ✅

### 3. Revenue vs Costed

**Foundation:** `program_inflows` table
- `milestoneAmount` = Actual revenue received
- `revenueAmount` = Costed/budgeted revenue

**Cascade:**
- Revenue Tracker: Side-by-side actual vs costed
- Portfolio Finance: "Costed vs Actual" bar charts
- PM Dashboard: Contract value summaries

**Integrity Rule:** `milestoneAmount` is ACTUAL, `revenueAmount` is COSTED — never swap

### 4. Financial Year Boundary

**Rule:** FY runs September to August
- September 2025 = FY2026
- August 2025 = FY2025

**Affects:**
- Cashflow Dashboard (FY26 forecast)
- COS Tracker monthly views
- Revenue tracking periods

**Golden Assertions (Unit Tests):**
- September → next FY ✅
- August → current FY ✅

### 5. Milestone Rollups

**Foundation:** `project_plan` with hierarchy via `project_plan_overrides`
- Parent milestones compute from children

**Calculation:** `computeRollups()` in `server/routes.ts`
- Earliest child start → parent start
- Latest child end → parent end
- Duration-weighted average of child percentComplete → parent Act%

**Dashboard Display:**
- Project Detail Plan tab: Hierarchical task grid with rollup values
- Gantt Chart: Milestone progress bars

### 6. Cashflow Balance

**Foundation:** `cashflow_points`, `program_expense`, `program_inflows`, OPEX budget
**Calculation:** Cumulative weekly: Opening + sum(inflows) - sum(outflows)
**Dashboard:** Cashflow Dashboard — balance chart, weekly breakdown

### 7. Quality Pass Rate

**Foundation:** QC checklist items with approval status
**Calculation:** (approved / total) × 100
**Dashboard:** Quality Dashboard, Portfolio Quality view

### 8. Engineering Completion Rate

**Foundation:** `project_eng_stages` with status
**Calculation:** (completed / total stages) × 100
**Dashboard:** Engineering Dashboard, Portfolio Engineering view

### 9. Spend %

**Foundation:** `program_expense.amount` (actual) vs `program_expense.budgetTotal` (costed)
**Calculation:** (totalActual / totalCosted) × 100
**Dashboard:** PM Dashboard project cards

### 10. Gross Profit / GP Margin

**Foundation:** Revenue actual - COS realised
**Calculation:** GP = revenue - COS; Margin = (GP / revenue) × 100
**Dashboard:** Portfolio Finance view

## Coverage Summary

| KPI | Unit Test | API Test | E2E Test | Status |
|-----|-----------|----------|----------|--------|
| Act% | ✅ 8 assertions | ✅ via portfolio | ✅ dashboard loads | COVERED |
| Expected% | ✅ 4 assertions | ✅ via portfolio | ✅ dashboard loads | COVERED |
| Delta | ✅ 2 assertions | ✅ via portfolio | ✅ gantt loads | COVERED |
| COS Realised | ✅ 2 assertions | ✅ via cos-tracker | ✅ page loads | COVERED |
| COS Outstanding | ✅ 1 assertion | ✅ via cos-tracker | ✅ page loads | COVERED |
| FY Boundary | ✅ 3 assertions | N/A | N/A | COVERED |
| Revenue Fields | ✅ 1 assertion | ✅ via projects | ✅ page loads | COVERED |
| Spend % | ✅ 2 assertions | ✅ via pm dashboard | ✅ page loads | COVERED |
| Quality Pass Rate | Manual | ✅ via quality | ✅ page loads | PARTIAL |
| Eng Completion | Manual | ✅ via engineering | ✅ page loads | PARTIAL |
