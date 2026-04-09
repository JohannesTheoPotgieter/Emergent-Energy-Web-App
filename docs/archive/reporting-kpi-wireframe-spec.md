# Reporting Function Wireframe + KPI Calculation Spec

Date: 2026-04-01
Owner: Reporting / PMO / Finance / Engineering

---

## 1) Design goals

1. Make KPI meaning obvious (planned vs actual vs realised).
2. Keep one KPI definition per metric across all report surfaces.
3. Preserve monthly snapshot governance (Draft → Reviewed → Published).
4. Ensure each KPI has drilldown rows tied to source tables.

---

## 2) Information architecture (screens)

1. **Report Center** (`/reports/center`)
2. **Operational Overview (Admin)** (`/api/admin/reports/operational-overview` + UI wrapper)
3. **PM Monthly Report** (`/reports/pm/monthly`)
4. **Engineering Monthly Report** (`/reports/engineering/monthly`)
5. **Compare View** (month A vs month B deltas)
6. **History View** (generated snapshots and statuses)

---

## 3) Global page wireframe (all monthly report pages)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Breadcrumbs] Reports > PM Monthly                                          │
│                                                                              │
│ [Title] PM Monthly Report                       [Status: Draft/Reviewed/Pub] │
│ [Month Picker: YYYY-MM] [Regenerate] [Review] [Publish] [Export PDF/XLSX]  │
│ [Data Freshness: last import + stale badge]                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI STRIP (10 cards max, actionable first)                                  │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │ KPI 1        │ │ KPI 2        │ │ KPI 3        │ │ KPI 4        │         │
│ │ value        │ │ value        │ │ value        │ │ value        │         │
│ │ Δ vs prev    │ │ Δ vs prev    │ │ Δ vs prev    │ │ Δ vs prev    │         │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘         │
├──────────────────────────────────────────────────────────────────────────────┤
│ TABS                                                                         │
│ [Executive Summary] [Financials] [Delivery] [Quality] [Procurement]         │
│ [Risks/RAID] [Drilldown Table]                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Main visual section (charts + top exceptions)                                │
│ - Trend chart(s)                                                             │
│ - Distribution chart(s)                                                      │
│ - Top 5 attention list                                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Drilldown Drawer (opens on KPI click)                                        │
│ [filters] [export csv/xlsx] [source table tags]                              │
│ Row-level table with aggregates + links                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4) Admin Operational Overview wireframe + KPIs

### 4.1 Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Operational Overview (Admin) - Month: [YYYY-MM]                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI Row 1: [Active PM Projects] [Construction Starts] [PD→PM Handovers]     │
│ KPI Row 2: [Commissionings] [Client Handovers Planned] [Client Handovers Act]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Milestone funnel (PD→PM→Construction→Commissioning→Client HO)               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Exceptions                                                                    │
│ - Past planned client handover but no actual handover                        │
│ - Construction started without PD→PM handover date                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 KPI spec

| KPI | Definition | Formula | Source fields/tables | Drilldown filter |
|---|---|---|---|---|
| Active PM Projects | Projects in PM execution window | Count distinct projects where `pdHandoverActual` exists AND (`clientHandoverActual` is null OR `clientHandoverActual > monthEnd`) | `project_info`, `project_execution_state` | project list in PM window |
| Construction Starts | Started this month | Count distinct `projectId` where `constructionStartActual ∈ month` | `project_execution_state.constructionStartActual` | month date filter |
| PD→PM Handovers | Handed to PM this month | Count distinct `projectId` where `pdHandoverActual ∈ month` | `project_execution_state.pdHandoverActual` | month date filter |
| Commissionings | Commissioned this month | Count distinct `projectId` where `commissioningActual ∈ month` | `project_execution_state.commissioningActual` | month date filter |
| Client Handovers Planned | Planned to hand over this month | Count distinct `projectId` where `clientHandoverDate ∈ month` | `project_execution_state.clientHandoverDate` | month date filter |
| Client Handovers Actual | Actually handed over this month | Count distinct `projectId` where `clientHandoverActual ∈ month` | `project_execution_state.clientHandoverActual` | month date filter |

---

## 5) PM Monthly wireframe + KPIs

### 5.1 KPI strip (recommended order)

1. Active PM Projects
2. Actual Realised Revenue (Month)
3. Planned Revenue (Month)
4. Planned Cost/COS (Month)
5. Planned GP Margin % (Month)
6. Projects At Risk
7. Overdue Tasks
8. Open RAID (High/Critical)
9. Open Quality Warnings
10. Procurement At Risk

### 5.2 Wireframe (PM)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PM Monthly Report                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI strip (10) + deltas                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Executive Summary                                                            │
│ - Top 5 intervention actions                                                 │
│ - Margin movers                                                              │
│ - At-risk projects                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Financials tab                                                               │
│ [Revenue trend: planned vs realised] [Cost trend: planned vs paid]           │
│ [GP bridge chart]                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Delivery tab                                                                 │
│ [Task completion by project] [overdue heatmap]                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ RAID / Quality / Procurement exception tables                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 KPI calculation spec (PM)

| KPI | Formula (for selected month M) | Notes |
|---|---|---|
| Active PM Projects | `COUNT(DISTINCT p.id WHERE pdHandoverActual IS NOT NULL AND (clientHandoverActual IS NULL OR clientHandoverActual > monthEnd))` | PM lifecycle window |
| Actual Realised Revenue (Month) | `SUM(finance_revenue_monthly.value WHERE category in ('actual','received','realised') AND monthEndDate in M)` | Use finance tracker month pivot as primary source |
| Planned Revenue (Month) | `SUM(normalized_revenue_lines.amountExVat WHERE expectedPaymentDate in M)` | If expected date null, fallback to approved/invoice date by approved hierarchy |
| Planned Cost/COS (Month) | `SUM(normalized_cost_lines.amountExVat WHERE approvedDate or forecastPaymentDate in M)` | Planned spend for month |
| Planned GP Margin % (Month) | `((plannedRevenueMonth - plannedCostMonth) / plannedRevenueMonth) * 100` | Null/0 guard |
| Projects At Risk | `COUNT(DISTINCT projectId WHERE ragStatus in ('RED','AMBER','AT RISK'))` | Match dashboard parity |
| Overdue Tasks | `COUNT(work_items WHERE endDate < monthEnd AND status not in complete/cancelled)` | Snapshot at month end |
| Open RAID (High/Critical) | `COUNT(raid_items WHERE status='open' AND priority in ('high','critical'))` | Actionable risk count |
| Open Quality Warnings | `COUNT(qc_warning WHERE status='open')` | Safety/quality signal |
| Procurement At Risk | `COUNT(procurement_items WHERE status in ('late','blocked') OR approvalState='blocked')` | Execution blockage indicator |

---

## 6) Engineering Monthly wireframe + KPIs

### 6.1 KPI strip (recommended order)

1. Total Engineering Tasks
2. Tasks Completed (Month)
3. Monthly Completion %
4. Cumulative Completion %
5. Deliverables Submitted
6. Deliverables Approved
7. Deliverables Rejected
8. Open Blockers
9. Overdue Approvals
10. Stage Gates Blocked

### 6.2 Wireframe (Engineering)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Engineering Monthly Report                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI strip + deltas                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Task Completion chart (per project)                                          │
│ Deliverable status chart (submitted/approved/rejected/pending)               │
│ Resource workload chart (assigned, overdue, project count)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Exception panels                                                             │
│ - Projects with >=3 overdue tasks                                            │
│ - Pending approvals >7 days                                                  │
│ - Blocked stage gates                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 KPI calculation spec (Engineering)

| KPI | Formula | Notes |
|---|---|---|
| Total Engineering Tasks | `COUNT(work_items WHERE workstream='ENG' AND not deleted AND project in scope)` | Scope filter required |
| Tasks Completed (Month) | `COUNT(work_items WHERE completedAt in M)` | Month completion count |
| Monthly Completion % | `tasksCompletedInMonth / tasksPlannedToCompleteInMonth * 100` | Prefer this denominator over current active-task denominator |
| Cumulative Completion % | `tasksCompletedToDate / totalTasksToDate * 100` | Portfolio progress |
| Deliverables Submitted | `COUNT(deliverables where firstSubmittedAt in M)` | Prefer transition timestamp over current-state + createdAt |
| Deliverables Approved | `COUNT(deliverable approval events in M)` | Event-based to avoid drift |
| Deliverables Rejected | `COUNT(deliverable rejection events in M)` | Event-based |
| Open Blockers | `COUNT(ENG tasks overdue and not completed/cancelled at month end)` | Period close exception |
| Overdue Approvals | `COUNT(project_eng_approvals where status='pending' and ageDays>7)` | SLA signal |
| Stage Gates Blocked | `COUNT(project_eng_stages where status='blocked')` | Gate control |

---

## 7) Comparison + history wireframe

```text
Compare View
┌──────────────────────────────────────────────────────────────────────────────┐
│ Month A [YYYY-MM] vs Month B [YYYY-MM]                                      │
│ KPI delta table: valueA, valueB, delta, delta%                              │
│ Waterfall for revenue/cost/margin movement                                  │
└──────────────────────────────────────────────────────────────────────────────┘

History View
┌──────────────────────────────────────────────────────────────────────────────┐
│ Snapshot list: Month | Status | Generated | Reviewed By | Published By       │
│ Actions: Open | Export | Regenerate (draft only)                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 8) Data contracts (proposed payload naming)

```ts
kpis: {
  activePmProjects: number;
  actualRealisedRevenueMonth: number;
  plannedRevenueMonth: number;
  plannedCostMonth: number;
  plannedGpMarginPctMonth: number | null;
  projectsAtRisk: number;
  overdueTasks: number;
  openRaidHighCritical: number;
  openQualityWarnings: number;
  procurementAtRisk: number;
}
```

Engineering payload keeps domain-specific keys but should standardize month suffixes where appropriate.

---

## 9) Acceptance criteria

1. Every KPI tile has one formula, one source, one drilldown.
2. Planned and realised KPIs are never mixed in same tile without explicit label.
3. Monthly report KPIs are month-scoped unless explicitly marked cumulative.
4. Compare view uses stored snapshot KPI payload (not re-query recompute by default).
5. Exported PDF/XLSX shows the same KPI values as on-screen tiles for the same snapshot.

