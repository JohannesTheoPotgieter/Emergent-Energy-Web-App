# Plan: Consolidate to Single Execution Dashboard

## Problem
6 separate dashboards (`/dashboard`, `/execution-board`, `/pm-dashboard`, `/engineering`, `/quality`, `/pd`) with overlapping data, inconsistent metrics, and unclear data provenance. Users don't trust the numbers because they can't see how they're calculated.

## Solution
Use **execution-board.tsx** as the base (it's already the best-structured) and enhance it into a single consolidated dashboard. Add data methodology transparency throughout.

## Implementation Steps

### Step 1: Add Data Methodology Component
Create a reusable `MetricTooltip` component that shows users exactly how each metric is calculated - what data sources, what formula, what time range. This replaces the dev-only `DataSourceDebug` with a production-grade transparency layer.

**New file:** `client/src/components/dashboard/MetricTooltip.tsx`
- Info icon (i) next to each KPI
- On hover/click shows: formula, data tables, time range, last refresh timestamp
- Styled consistently, non-intrusive

### Step 2: Add Upcoming Events Section to Execution Board
Port the upcoming events/financial milestones from `dashboard.tsx` into the consolidated dashboard as a new section between Action Center and Project Portfolio.

**Edit:** `client/src/pages/execution-board.tsx`
- Add "Upcoming Milestones" section showing project milestones in next 10 working days
- Add "Financial Events" section showing inflows/outflows due soon
- These come from the existing API data + a new lightweight endpoint

### Step 3: Add Data Methodology to All KPI Cards
Enhance the 4 KPI cards in execution-board.tsx with MetricTooltip showing exactly what each number means.

**Edit:** `client/src/pages/execution-board.tsx`
- Portfolio card: "Active Projects = ACTIVE projects in project_info with FY plan or financial data"
- Revenue card: "Planned Revenue = sum of normalized_revenue_lines.amount_ex_vat where invoice/payment date falls in current FY"
- Expenditure card: "Planned = sum of normalized_cost_lines.amount_ex_vat in FY, Paid = where paid_date_confirmed is set"
- Risks card: "Engineering Blockers = operational_tasks with blocker_reason OR priority in [high, urgent, critical]"

### Step 4: Add Data Methodology to Action Center Queues
Each queue type gets a methodology tooltip explaining its trigger criteria.

**Edit:** `client/src/pages/execution-board.tsx`
- Behind Plan: "actual_pct_complete < expected_pct_complete - 5%"
- Inflow at Risk: "open_inflow / planned_revenue > 35%"
- Expenditure at Risk: "open_expenditure / planned_expenditure > 35%"
- Engineering Bottlenecks: "tasks with blocker_reason or high/critical priority"
- Quality Issues: "qc_warning records with status != closed"
- Pending Approvals: "approvals with status = pending"

### Step 5: Enhance Role-Based Tabs with Richer Content
Currently the role tabs (COO, Program, Finance, Construction) just filter the same data. Add role-specific summary content per tab.

**Edit:** `client/src/pages/execution-board.tsx`
- COO tab: Add RAG distribution chart (pie/donut), portfolio health summary
- Finance tab: Add GP margin distribution, cashflow summary bar
- Construction tab: Add engineering task completion rates, quality checklist status
- Program tab: Add milestone timeline, behind-plan trend

### Step 6: Add Last Refresh Timestamp + Data Freshness Indicator
Show when data was last loaded and import freshness prominently.

**Edit:** `client/src/pages/execution-board.tsx`
- Add "Data as of: [timestamp]" in header area
- Show stale data warning banner if import > 7 days old
- Include "Sources: plan tasks, revenue lines, cost lines, engineering tasks, quality warnings, approvals" in a collapsible footer

### Step 7: Update Navigation & Routing
Redirect all old dashboard routes to the consolidated dashboard. Update navigation config.

**Edit files:**
- `client/src/config/app-navigation.ts` - Remove separate dashboard entries, point to `/execution-board`
- `client/src/config/page-registry.ts` - Add redirects from `/dashboard`, `/pm-dashboard`, `/engineering`, `/quality`, `/pd` to `/execution-board`
- Keep old pages in codebase but add deprecation comments (don't delete yet to avoid breaking anything)

### Step 8: Server-side Enhancement - Add Methodology Metadata to API Response
Extend the execution-dashboard API to return methodology metadata alongside data.

**Edit:** `server/lifecycle-routes.ts`
- Add `methodology` object to API response with per-metric explanations
- Add `dataFreshness` object with last import timestamp, record counts per source table
- This makes the client-side tooltips data-driven rather than hardcoded

## Files Modified
- `client/src/components/dashboard/MetricTooltip.tsx` (NEW)
- `client/src/pages/execution-board.tsx` (MAJOR - add sections, methodology, role content)
- `client/src/lib/execution-dashboard.ts` (extend types for methodology)
- `client/src/config/app-navigation.ts` (consolidate nav)
- `client/src/config/page-registry.ts` (add redirects)
- `server/lifecycle-routes.ts` (add methodology metadata to API)

## What We're NOT Doing
- Not deleting old dashboard files yet (safe rollback)
- Not changing the underlying data model
- Not adding new database tables
- Not changing permissions (execution_board permission covers the consolidated view)
