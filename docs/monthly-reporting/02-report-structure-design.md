# Monthly Management Report — Structure & Design Document

**Date:** 2026-03-23
**Depends on:** `01-schema-verification-report.md` (schema verification)
**Purpose:** Define the layout, data sources, API design, and UI components for the Monthly Management Report feature.

---

## 1. Overview

The Monthly Management Report is an interactive, exportable report that gives leadership a consolidated view of all project and programme activity for a given calendar month. It is designed for:

- **COO/CEO** — high-level KPIs, financial summary, portfolio health
- **Project Managers** — per-project detail, task progress, risk items
- **Finance** — revenue, COS, margin, cashflow trends
- **Engineering** — deliverable status, stage gate progress

The report is month-scoped (YYYY-MM) and can be viewed in-browser, exported to PDF, or exported to XLSX.

---

## 2. Report Sections

### Section 1: Programme KPI Dashboard

**Purpose:** Single-slide executive summary with headline numbers.

| KPI | Data Source | Query |
|-----|-----------|-------|
| Active Projects | `project_execution_state` | COUNT WHERE `isActive = true` AND phase NOT IN cancelled/archived |
| Total Contract Value | `project_info` | SUM(`contractValue`) for active projects |
| Construction Starts (Month) | `project_execution_state` | COUNT WHERE `constructionStartActual` falls within month |
| Commissionings (Month) | `project_execution_state` | COUNT WHERE `commissioningActual` falls within month |
| PD→PM Handovers (Month) | `project_execution_state` | COUNT WHERE `pdHandoverActual` falls within month |
| Client Handovers (Month) | `project_execution_state` | COUNT WHERE `clientHandoverDate` falls within month |
| Total Revenue (Programme) | `dashboard_program_metrics` or computed | SUM of `totalRevenue` across active projects |
| Total Cost (Programme) | `dashboard_program_metrics` or computed | SUM of `totalCost` across active projects |
| Blended GP Margin | Computed | `(totalRevenue - totalCost) / totalRevenue × 100` |
| Projects at Risk (RAG Red) | `project_execution_state` | COUNT WHERE `ragStatus = 'Red'` |

**UI:** Grid of KPI tiles (reuse existing tile pattern from operational overview). Recharts sparklines for month-over-month trends using `finance_revenue_monthly`.

**Existing code to reuse:** `calculateKPIs()` in `server/report-routes.ts` (lines 71-122).

---

### Section 2: Financial Summary

**Purpose:** Revenue, cost, and margin breakdown across the programme.

#### 2a. Revenue Summary Table

| Column | Source |
|--------|--------|
| Project Name | `project_info.projectName` |
| Contract Value | `project_info.contractValue` |
| Total Invoiced | SUM(`amountExVat`) from `normalizedRevenueLines` WHERE `invoiceDate IS NOT NULL` AND `effectiveTo IS NULL` |
| Total Received | SUM(`amountExVat`) WHERE `paidDate IS NOT NULL` OR `inBankDate IS NOT NULL` |
| Outstanding | Total Invoiced - Total Received |
| Invoiced This Month | SUM(`amountExVat`) WHERE `invoiceDate` falls within report month |
| Received This Month | SUM(`amountExVat`) WHERE `paidDate` falls within report month |

#### 2b. Cost Summary Table

| Column | Source |
|--------|--------|
| Project Name | `project_info.projectName` |
| Budget Total | SUM(`budgetTotal`) from `normalizedCostLines` WHERE `effectiveTo IS NULL` |
| Actual Cost | SUM(`amountExVat`) from `normalizedCostLines` WHERE `effectiveTo IS NULL` |
| COS Realised | SUM(`amountExVat`) WHERE `invoiceDateConfirmed = true` AND `invoiceNumber IS NOT NULL` |
| Paid | SUM(`amountExVat`) WHERE `paidDateConfirmed = true` |
| Variance | Budget Total - Actual Cost |
| Costs This Month | SUM(`amountExVat`) WHERE `invoiceDate` falls within report month |

#### 2c. Gross Profit Summary

| Column | Source |
|--------|--------|
| Project Name | `project_info.projectName` |
| Revenue | From 2a |
| Cost | From 2b |
| Gross Profit | Revenue - Cost |
| GP Margin % | `(Revenue - Cost) / Revenue × 100` |
| Contract Value | `project_info.contractValue` |
| Margin vs Contract | `GP / Contract Value × 100` |

#### 2d. Revenue Trend Chart

- **Type:** Stacked bar chart (Recharts `<BarChart>`)
- **Data source:** `finance_revenue_monthly` grouped by `category` and `monthEndDate`
- **X-axis:** Month (last 12 months)
- **Y-axis:** Revenue value
- **Series:** One per category

#### 2e. Cashflow Chart

- **Type:** Line chart (Recharts `<LineChart>`)
- **Data source:** `cashflow_points` filtered by `seriesName`
- **X-axis:** Date
- **Y-axis:** Cumulative cashflow value

---

### Section 3: Project Status Overview

**Purpose:** Per-project status matrix showing phase, RAG, progress, and key dates.

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Client | `clients.name` (via `project_info.clientId`) |
| Size (kWp) | `project_info.sizeKwp` |
| Phase | `project_execution_state.phase` |
| RAG | `project_execution_state.ragStatus` |
| RAG Comment | `project_execution_state.ragComment` |
| PM | `project_info.pm` |
| PD | `project_info.pd` |
| Construction Start | `project_execution_state.constructionStartActual` or `.constructionStartDate` |
| Commissioning | `project_execution_state.commissioningActual` or `.commissioningDate` |
| Health Score | `dashboard_project_metrics.healthScore` |
| Tasks Progress | `dashboard_project_metrics.tasksCompleted / taskCount` |
| QC Progress | `dashboard_project_metrics.qcProgressPct` |

**UI:** Sortable/filterable table with RAG colour badges. Click row to expand project detail.

**Existing code to reuse:** Quality report in `report-routes.ts` (lines 454-503).

---

### Section 4: Task & Milestone Summary

**Purpose:** Show task completion rates, overdue items, and milestone achievements for the month.

#### 4a. Programme-level Task Metrics

| Metric | Query |
|--------|-------|
| Tasks Completed This Month | COUNT from `work_items` WHERE `completedAt` falls within month AND `deletedAt IS NULL` |
| Tasks Started This Month | COUNT from `work_item_status_history` WHERE `newStatus = 'In Progress'` AND `changedAt` within month |
| Overdue Tasks | COUNT from `work_items` WHERE `endDate < monthEnd` AND status NOT IN completed statuses |
| Milestones Achieved | COUNT from `work_items` WHERE `isMilestone = true` AND `completedAt` within month |
| Average Completion Rate | AVG(`percentComplete`) from active work items |

#### 4b. Per-Project Task Breakdown

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Total Tasks | COUNT from `work_items` WHERE `projectId` AND `deletedAt IS NULL` |
| Completed | COUNT WHERE status IN completed statuses |
| In Progress | COUNT WHERE status = 'In Progress' |
| Overdue | COUNT WHERE `endDate < today` AND not completed |
| Completion % | `completed / total × 100` |

#### 4c. Resource Utilisation

| Column | Source |
|--------|--------|
| Resource | `work_items.ownerName` |
| Assigned Tasks | COUNT |
| Completed | COUNT completed |
| Projects | DISTINCT project count |

**Existing code to reuse:** Resource allocation report in `report-routes.ts` (lines 506-599).

---

### Section 5: Risk & Issues (RAID)

**Purpose:** Highlight open risks, issues, and blockers across the programme.

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Type | `raid_items.type` (RISK / ASSUMPTION / ISSUE / DEPENDENCY) |
| Title | `raid_items.title` |
| Priority | `raid_items.priority` |
| Status | `raid_items.status` |
| Owner | `users.name` via `raid_items.ownerUserId` |
| Due Date | `raid_items.dueDate` |
| Mitigation | `raid_items.mitigationResponse` |

**Filters:** Show only open items. Group by type. Sort by priority (critical first).

**Additional:** Include `qc_warning` items with status = 'open' as quality-specific risks.

---

### Section 6: Quality & Engineering

**Purpose:** QC checklist progress, deliverable status, and engineering stage gates.

#### 6a. QC Progress per Project

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Checklist Status | `qc_checklist.status` |
| Items Applicable | COUNT from `qc_item_instance` WHERE `isApplicable = true` |
| Items Approved | COUNT WHERE `approved = true` |
| Progress % | `approved / applicable × 100` |
| Open Warnings | COUNT from `qc_warning` WHERE `status = 'open'` |

#### 6b. Engineering Deliverables

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Deliverable | `deliverables.title` |
| Type | `deliverables.deliverableType` |
| Status | `deliverables.status` |
| Version | `deliverables.currentVersion` |
| Owner | `users.name` via `deliverables.ownerUserId` |
| Reviewer | `users.name` via `deliverables.reviewerUserId` |

#### 6c. Stage Gate Progress

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Stage | `eng_stage_templates.name` via `project_eng_stages.stageTemplateId` |
| Status | `project_eng_stages.status` |
| Started | `project_eng_stages.startedAt` |
| Completed | `project_eng_stages.completedAt` |

---

### Section 7: Procurement Summary

**Purpose:** Outstanding procurement items and spend.

| Column | Source |
|--------|--------|
| Project | `project_info.projectName` |
| Item | `procurement_items.title` |
| Category | `procurement_items.category` |
| Expected Cost | `procurement_items.expectedCost` |
| Actual Cost | `procurement_items.actualCost` |
| Supplier | `counterparties.nameCanonical` via `procurement_items.supplierId` |
| Status | `procurement_items.status` |
| Payment Status | `procurement_items.paymentStatus` |

---

## 3. API Design

### 3.1 Main Report Endpoint

```
GET /api/reports/monthly?month=YYYY-MM&projectId=<optional>&format=json|xlsx|pdf
```

**Response structure (JSON):**
```json
{
  "meta": {
    "month": "2026-02",
    "monthLabel": "February 2026",
    "generatedAt": "2026-03-23T10:00:00Z",
    "generatedBy": "user@example.com",
    "activeProjectCount": 25,
    "stalenessThresholdDays": 7
  },
  "kpis": { /* Section 1 data */ },
  "financials": {
    "revenueSummary": [ /* Section 2a rows */ ],
    "costSummary": [ /* Section 2b rows */ ],
    "grossProfit": [ /* Section 2c rows */ ],
    "revenueTrend": [ /* Section 2d chart data */ ],
    "cashflowTrend": [ /* Section 2e chart data */ ]
  },
  "projectStatus": [ /* Section 3 rows */ ],
  "tasks": {
    "programmeMetrics": { /* Section 4a */ },
    "perProject": [ /* Section 4b rows */ ],
    "resourceUtilisation": [ /* Section 4c rows */ ]
  },
  "raidItems": [ /* Section 5 rows */ ],
  "quality": {
    "qcProgress": [ /* Section 6a rows */ ],
    "deliverables": [ /* Section 6b rows */ ],
    "stageGates": [ /* Section 6c rows */ ]
  },
  "procurement": [ /* Section 7 rows */ ]
}
```

### 3.2 Section-specific Endpoints (for lazy loading)

```
GET /api/reports/monthly/kpis?month=YYYY-MM
GET /api/reports/monthly/financials?month=YYYY-MM
GET /api/reports/monthly/project-status?month=YYYY-MM
GET /api/reports/monthly/tasks?month=YYYY-MM
GET /api/reports/monthly/raid?month=YYYY-MM
GET /api/reports/monthly/quality?month=YYYY-MM
GET /api/reports/monthly/procurement?month=YYYY-MM
```

Each supports `?format=xlsx` for section-level Excel export.

### 3.3 PDF Export

```
GET /api/reports/monthly/pdf?month=YYYY-MM
```

Uses `pdfkit` (server-side) to generate a multi-page PDF with:
- Cover page with month, company logo, generation timestamp
- KPI summary page (tiles layout)
- Financial tables
- Project status table
- Charts rendered as embedded images (server-side chart rendering or pre-rendered client-side)

### 3.4 Authentication & Permissions

All endpoints require:
- `requireAuth` middleware (Bearer token or session)
- `requirePermission("reports", "view")` middleware

Reuse existing pattern from `report-routes.ts`.

---

## 4. UI Design

### 4.1 Page Location

**Route:** `/reports/monthly`

**Navigation placement:** Add under a new "Reports" top-level section or under the existing "Admin" section:

```typescript
// Option A: New Reports section in app-navigation.ts
{
  label: "Reports",
  path: "/reports",
  match: (pathname) => startsWithAny(pathname, ["/reports"]),
  secondary: [
    { label: "Monthly Report", path: "/reports/monthly" },
    { label: "Programme Reports", path: "/reports/programme" },  // existing page moved
  ],
}
```

### 4.2 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Monthly Management Report          [Feb 2026] [◀] [▶]     │
│  Generated: 23 Mar 2026 10:00       [Export PDF] [Export XLS]│
├─────────────────────────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │ 25  │ │ R42M│ │ 3   │ │ 2   │ │ 1   │ │ 28% │          │
│  │Active│ │Rev  │ │Const│ │Comm │ │Hand │ │GP % │          │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
├─────────────────────────────────────────────────────────────┤
│  [Financial Summary] [Projects] [Tasks] [RAID] [Quality]    │
│  ─────────────────────────────────────────────────────────  │
│  │  Active tab content rendered here                     │  │
│  │  (tables, charts, detail views)                       │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Component Hierarchy

```
MonthlyReportPage
├── ReportHeader (month selector, export buttons)
├── KPIDashboard (tile grid, Section 1)
│   └── KPITile × N (recharts sparkline optional)
├── Tabs
│   ├── FinancialSummaryTab (Section 2)
│   │   ├── RevenueSummaryTable
│   │   ├── CostSummaryTable
│   │   ├── GrossProfitTable
│   │   ├── RevenueTrendChart (recharts BarChart)
│   │   └── CashflowChart (recharts LineChart)
│   ├── ProjectStatusTab (Section 3)
│   │   └── ProjectStatusTable (sortable, filterable)
│   ├── TaskSummaryTab (Section 4)
│   │   ├── ProgrammeTaskMetrics (summary cards)
│   │   ├── PerProjectTaskTable
│   │   └── ResourceUtilisationTable
│   ├── RAIDTab (Section 5)
│   │   └── RAIDTable (grouped by type)
│   ├── QualityTab (Section 6)
│   │   ├── QCProgressTable
│   │   ├── DeliverablesTable
│   │   └── StageGateTable
│   └── ProcurementTab (Section 7)
│       └── ProcurementTable
└── ReportFooter (generation metadata, staleness warnings)
```

### 4.4 Shared Components to Reuse

| Component | From | Purpose |
|-----------|------|---------|
| `StalenessWarning` | `programme-reports.tsx` | Shows data age warning |
| `ManualEditIndicator` | `programme-reports.tsx` | Shows protected field badge |
| `ExportButton` | `programme-reports.tsx` | XLSX download trigger |
| `ReportMeta` | `programme-reports.tsx` | Record count + last import info |
| `Card`, `Tabs`, `Badge`, `Button` | `@/components/ui/*` | UI primitives |
| `exportToXlsx()` | `report-routes.ts` | Server-side XLSX generation helper |

---

## 5. Data Flow

```
                     ┌─────────────────────┐
                     │   Monthly Report     │
                     │   Page (React)       │
                     └────────┬────────────┘
                              │ useQuery() per section
                              ▼
                     ┌─────────────────────┐
                     │   /api/reports/      │
                     │   monthly/*          │
                     └────────┬────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ dashboard_   │  │ normalized   │  │ work_items   │
   │ project_     │  │ revenue/cost │  │ raid_items   │
   │ metrics      │  │ _lines       │  │ qc_*         │
   │ (pre-computed)│  │ (temporal)   │  │ deliverables │
   └──────────────┘  └──────────────┘  └──────────────┘
```

**Strategy:**
1. **KPIs & project status** → read from `dashboard_project_metrics` (fast, pre-computed)
2. **Financial detail** → query `normalizedRevenueLines` / `normalizedCostLines` with `effectiveTo IS NULL`
3. **Monthly activity** → query `work_item_status_history`, `work_items.completedAt` with month boundary filters
4. **Trends** → query `finance_revenue_monthly` and `cashflow_points`
5. **Quality/Engineering** → query `qc_*` and `deliverables` tables directly

---

## 6. Export Formats

### 6.1 PDF Export

Multi-page PDF generated server-side via `pdfkit`:

| Page | Content |
|------|---------|
| 1 | Cover: "Emergent Energy — Monthly Management Report — {Month Year}" |
| 2 | KPI Dashboard (tile grid) |
| 3-4 | Financial Summary (revenue, cost, GP tables) |
| 5 | Revenue Trend Chart (embedded as PNG) |
| 6 | Project Status Table |
| 7 | Task Summary |
| 8 | RAID Summary (open items only) |
| 9 | Quality & Engineering Overview |

**Branding:** Use existing EE brand colours (`#1a5c3a` green, white) matching operational overview PDF style.

### 6.2 XLSX Export

Multi-sheet workbook via `exceljs`:

| Sheet | Content |
|-------|---------|
| Summary KPIs | Key metrics in formatted cells |
| Revenue | Revenue summary table (Section 2a) |
| Costs | Cost summary table (Section 2b) |
| Gross Profit | GP table (Section 2c) |
| Project Status | Full project matrix (Section 3) |
| Tasks | Per-project task breakdown (Section 4b) |
| Resource Allocation | Resource utilisation (Section 4c) |
| RAID | Open risk/issue items (Section 5) |
| Quality | QC progress + deliverables (Section 6) |
| Procurement | Procurement items (Section 7) |

---

## 7. Implementation Plan

### Phase 1: API Layer
1. Create `server/monthly-report-routes.ts` with section-specific endpoints
2. Implement month-boundary query helpers (reuse `parseMonth()` from report-routes.ts)
3. Add XLSX export for each section (reuse `exportToXlsx()` helper)
4. Register routes in main app

### Phase 2: UI — KPI Dashboard + Financial Summary
1. Create `client/src/pages/monthly-report.tsx`
2. Add route in app router
3. Add navigation entry in `app-navigation.ts`
4. Implement KPI tile grid with month selector
5. Implement financial summary tables with Recharts charts

### Phase 3: UI — Remaining Tabs
1. Project Status tab
2. Task Summary tab
3. RAID tab
4. Quality & Engineering tab
5. Procurement tab

### Phase 4: PDF Export
1. Implement server-side PDF generation with pdfkit
2. Add cover page, KPI page, financial tables, charts
3. Wire up "Export PDF" button

### Phase 5: Polish & Permissions
1. Add `requirePermission("reports", "view")` to all endpoints
2. Add staleness warnings and data freshness indicators
3. Test with real data
4. Performance optimisation (lazy loading tabs, pagination)

---

## 8. File Structure

```
server/
  monthly-report-routes.ts          # New: API endpoints
  services/
    monthly-report-service.ts       # New: Business logic & queries
    monthly-report-pdf.ts           # New: PDF generation

client/src/
  pages/
    monthly-report.tsx              # New: Main report page
  components/
    reports/
      kpi-dashboard.tsx             # New: KPI tile grid
      financial-summary.tsx         # New: Revenue/cost/GP tables + charts
      project-status-table.tsx      # New: Project overview table
      task-summary.tsx              # New: Task metrics + tables
      raid-summary.tsx              # New: RAID table
      quality-summary.tsx           # New: QC + deliverables
      procurement-summary.tsx       # New: Procurement table
      report-header.tsx             # New: Month selector + export buttons
```

---

## 9. Open Questions

1. **Snapshot persistence:** Should generated reports be stored for historical access, or always recomputed on-the-fly? If stored, a `monthly_report_snapshots` table is needed.
2. **Scheduled generation:** Should reports auto-generate on the 1st of each month (via cron)? No cron infrastructure currently exists.
3. **Approval workflow:** Should reports have a "draft → reviewed → approved" lifecycle?
4. **Per-project detail pages:** Should clicking a project in the report navigate to a dedicated project monthly summary?
5. **Comparison mode:** Should the report support "compare this month vs last month" side-by-side?
