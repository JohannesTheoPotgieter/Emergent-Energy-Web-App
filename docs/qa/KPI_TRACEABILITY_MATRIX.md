# KPI TRACEABILITY MATRIX

**Date:** 2026-03-19
**Scope:** All key business metrics displayed on the Project Detail page
**Method:** Source-to-UI tracing via codebase analysis

---

## KPI-01: Revenue Realised %

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Revenue Realised % |
| **Source Table(s)** | `program_inflows` (via `/api/revenue-tab/:projectName` which merges with `revenue_milestone_manual`) |
| **Transformation Logic** | `project-detail.tsx:1128-1131`: Filter milestones where `status === 'inBank'`, sum their `milestoneAmount`. Divide by `contractValue` (from `project_info.contract_value` or sum of all milestone amounts). Multiply by 100 |
| **API Endpoint(s)** | `/api/revenue-tab/:projectName` → returns `{ milestones: [...], reconciliation: {...} }` |
| **UI Component** | `ProjectCommandHeader.tsx` → `StatBlock` with label "Rev Realised" |
| **Computation Location** | **CLIENT-SIDE** (`project-detail.tsx:1128-1131`) |
| **Status** | PROVEN — logic is traceable but client-side aggregation means no server authority |

---

## KPI-02: COS Realised %

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | COS Realised % |
| **Source Table(s)** | `program_expense` (via `/api/program-expenses/:projectName`) |
| **Transformation Logic** | `project-detail.tsx:1107-1111`: A cost line is "realised" if it has both `expenseInvoiceNumber` (non-empty) AND `expenseInvoicedDate` (non-empty). Sum realised `expenseActualTotal`. Divide by `totalExpenses` (or `budgetTotal` if no actuals). Multiply by 100 |
| **API Endpoint(s)** | `/api/program-expenses/:projectName` |
| **UI Component** | `ProjectCommandHeader.tsx` → `StatBlock` with label "COS Realised" |
| **Computation Location** | **CLIENT-SIDE** (`project-detail.tsx:1133-1138`) |
| **Status** | PROVEN — but relies on `isCosRealised()` helper with simple presence check (no date validation) |

---

## KPI-03: Margin Delta

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Margin Delta (Revenue Realised % minus COS Realised %) |
| **Source Table(s)** | Derived from KPI-01 and KPI-02 |
| **Transformation Logic** | `project-detail.tsx:1139`: `marginDelta = revenueRealisedPct - cosRealisedPct` |
| **API Endpoint(s)** | Same as KPI-01 and KPI-02 |
| **UI Component** | `ProjectCommandHeader.tsx` → `StatBlock` with label "Margin Δ" |
| **Computation Location** | **CLIENT-SIDE** |
| **Status** | PROVEN — simple subtraction of two other KPIs |

---

## KPI-04: Project Completion %

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Project Completion % |
| **Source Table(s)** | `projects_summary` view (via `/api/projects-summary`) → `project_pct_complete` field |
| **Transformation Logic** | `project-detail.tsx:1054-1057`: `projectInfo.project_pct_complete * 100`, formatted to 0 decimal places |
| **API Endpoint(s)** | `/api/projects-summary` |
| **UI Component** | `ProjectCommandHeader.tsx` → `StatBlock` with label "Complete" |
| **Computation Location** | **SERVER-SIDE** (computed in summary view/API) |
| **Status** | PROVEN — server-authoritative |

---

## KPI-05: Schedule RAG

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Schedule RAG Status (Green / Amber / Red) |
| **Source Table(s)** | `project_plan` (via `/api/planning-tasks/:projectName`) |
| **Transformation Logic** | `project-detail.tsx:1066-1080`: Count overdue plan tasks (end date < today AND % complete < 100). Thresholds: 0 overdue = green, ≤3 overdue = amber, >3 overdue = red |
| **API Endpoint(s)** | `/api/planning-tasks/:projectName` |
| **UI Component** | `ProjectCommandHeader.tsx` → `RagIndicator` with label "Schedule" |
| **Computation Location** | **CLIENT-SIDE** with hardcoded thresholds |
| **Status** | PROVEN — but thresholds (0/3) are hardcoded, not configurable |

---

## KPI-06: Cost RAG

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Cost RAG Status (Green / Amber / Red) |
| **Source Table(s)** | `program_expense` (via `/api/program-expenses/:projectName`) |
| **Transformation Logic** | `project-detail.tsx:1082-1084`: `costRatio = totalExpenses / budgetTotal`. Thresholds: <0.9 = green, ≤1.0 = amber, >1.0 = red |
| **API Endpoint(s)** | `/api/program-expenses/:projectName` |
| **UI Component** | `ProjectCommandHeader.tsx` → `RagIndicator` with label "Cost" |
| **Computation Location** | **CLIENT-SIDE** with hardcoded thresholds |
| **Status** | PROVEN — but 90%/100% thresholds are hardcoded |

---

## KPI-07: Quality RAG

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Quality RAG Status (Green / Amber / Red) |
| **Source Table(s)** | `qc_checklist` + `qc_item_instance` (via `/api/quality/project/:projectName/summary`) |
| **Transformation Logic** | `project-detail.tsx:1086-1095`: Count quality phases where `applicableItems > 0` AND `approvedItems >= applicableItems` (= gates passed). Green: all gates passed AND total > 0. Amber: some items approved. Red: no checklist OR no items approved |
| **API Endpoint(s)** | `/api/quality/project/:projectName/summary` |
| **UI Component** | `ProjectCommandHeader.tsx` → `RagIndicator` with label "Quality" |
| **Computation Location** | **CLIENT-SIDE** using server-provided summary counts |
| **Status** | PROVEN |

---

## KPI-08: Contract Value

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Contract Value |
| **Source Table(s)** | `project_info.contract_value` OR sum of `program_inflows.milestoneAmount` |
| **Transformation Logic** | `project-detail.tsx:1062`: Prefers `project_info.contract_value`; falls back to sum of all revenue milestone amounts |
| **API Endpoint(s)** | `/api/projects-summary` (provides `contract_value` field) |
| **UI Component** | `ProjectCommandHeader.tsx` → `StatBlock` with label "Contract" |
| **Computation Location** | **CLIENT-SIDE** (fallback logic) |
| **Status** | PROVEN — but dual-source (project_info vs computed) could diverge |

---

## KPI-09: Engineering Progress

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Engineering Task/Stage Completion |
| **Source Table(s)** | `engineering_tasks` (via `/api/projects/:id/eng-tasks`) + engineering stages (via `/api/projects/:id/eng-stages`) |
| **Transformation Logic** | `project-detail.tsx:1177-1189`: Combines eng stage tasks + eng board tasks. `engCompletedTasks / engTotalTasks * 100`. Stages: count where `status === "complete"`. Board: count where `status === "COMPLETE"` |
| **API Endpoint(s)** | `/api/projects/:id/eng-tasks`, `/api/projects/:id/eng-stages` |
| **UI Component** | `EngTasksTab` inline component — shows Total/Open/Completed/Overdue stats |
| **Computation Location** | **CLIENT-SIDE** |
| **Status** | PROVEN — but note different status casing: stages use "complete" (lowercase), board uses "COMPLETE" (uppercase) |

---

## KPI-10: Cashflow

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Cashflow Time Series |
| **Source Table(s)** | `cashflow_points` (via `/api/cashflow?project=X`) + `cashflow_planning_overrides` |
| **Transformation Logic** | Server-side: returns time-series with series names ("Planned Revenue", "ACTUAL CashFlow", etc.). Client renders chart |
| **API Endpoint(s)** | `/api/cashflow?project=X` |
| **UI Component** | `CashflowTab.tsx` — chart visualization |
| **Computation Location** | **SERVER-SIDE** (data retrieval); **CLIENT-SIDE** (chart rendering) |
| **Status** | PROVEN |

---

## KPI-11: GP (Gross Profit)

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | Gross Profit |
| **Source Table(s)** | Derived from revenue (`program_inflows` / `normalized_revenue_lines`) minus costs (`program_expense` / `normalized_cost_lines`) |
| **Transformation Logic** | `GpTrackerTab.tsx` computes planned vs actual GP from revenue and expenditure data |
| **API Endpoint(s)** | `/api/revenue-tab/:projectName` + `/api/expenditure-breakdown/:projectName` |
| **UI Component** | `GpTrackerTab.tsx` |
| **Computation Location** | **CLIENT-SIDE** |
| **Status** | PROVEN — but dependent on both revenue and expenditure queries succeeding |

---

## KPI-12: My Work Task Counts

| Attribute | Detail |
|-----------|--------|
| **KPI Name** | My Work — task counts by source |
| **Source Table(s)** | `mytool_tasks`, `operational_tasks`, `work_items`, `engineering_tasks`, `qc_item_instance`, `deliverables`, `ms_objects` |
| **Transformation Logic** | `/api/my-work/all-tasks` aggregates 9 task sources for current user. Counts computed client-side per source type |
| **API Endpoint(s)** | `/api/my-work/all-tasks` |
| **UI Component** | My Work pages (`my-work-tasks.tsx`) |
| **Computation Location** | **SERVER-SIDE** (aggregation) + **CLIENT-SIDE** (filtering/counting) |
| **Status** | PROVEN |

---

## Summary

| KPI | Source | Computation | Status |
|-----|--------|-------------|--------|
| Revenue Realised % | program_inflows + revenue_milestone_manual | Client-side | PROVEN |
| COS Realised % | program_expense | Client-side | PROVEN |
| Margin Delta | Derived | Client-side | PROVEN |
| Project Completion % | projects_summary view | Server-side | PROVEN |
| Schedule RAG | project_plan tasks | Client-side (hardcoded thresholds) | PROVEN |
| Cost RAG | program_expense | Client-side (hardcoded thresholds) | PROVEN |
| Quality RAG | qc_item_instance | Client-side (server summary) | PROVEN |
| Contract Value | project_info OR computed | Client-side (dual source) | PROVEN |
| Engineering Progress | engineering_tasks + eng_stages | Client-side | PROVEN |
| Cashflow | cashflow_points | Server-side data, client chart | PROVEN |
| GP | Revenue minus Costs | Client-side | PROVEN |
| My Work Counts | 9 task tables aggregated | Server + Client | PROVEN |

### Key Findings

1. **8 of 12 KPIs are computed client-side** — no single server-authoritative endpoint for project health summary
2. **RAG thresholds are hardcoded** — Schedule (0/3 overdue), Cost (90%/100%), Quality (all-or-nothing gates)
3. **Contract Value has dual source** — `project_info.contract_value` vs sum of milestones; could diverge if import doesn't update project_info
4. **Engineering status casing inconsistency** — stages use "complete", board uses "COMPLETE"
5. **All KPIs are individually traceable** — every number can be traced from source table → API → client computation → UI display
