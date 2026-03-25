# Schema Verification Report — Monthly Reporting Module

**Date:** 2026-03-23
**Purpose:** Catalogue every database table, column, and relationship relevant to the Monthly Management Report, confirming data availability before UI/API design begins.

---

## 1. Executive Summary

The existing schema fully supports a monthly reporting module. All required financial, project, task, quality, and engineering data is available through well-structured tables with temporal versioning (`effectiveFrom` / `effectiveTo`) on financial lines. No new tables are needed for read-only reporting — only new API endpoints that aggregate existing data.

**Key finding:** A materialized metrics layer already exists (`dashboard_project_metrics`, `dashboard_program_metrics`) via `server/services/dashboard-metrics.ts` that pre-computes revenue, cost, margin, task counts, QC progress, and health scores per project. The monthly report can leverage this for summary KPIs.

---

## 2. Tables by Report Section

### 2.1 Project Overview & Status

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `project_info` | `id`, `projectName`, `sizeKwp`, `pd`, `pm`, `contractValue`, `clientId`, `pmUserId`, `pdUserId` | Master project record; `contractValue` is the signed contract amount |
| `project_execution_state` | `projectId` (FK→project_info), `phase`, `ragStatus`, `ragComment`, `isActive`, `executionPhase`, `constructionStartDate`, `commissioningDate`, `clientHandoverDate`, `constructionStartActual`, `commissioningActual`, `signedStatus`, `signedDate` | One row per project. Phase/RAG drives status reporting. Actual vs planned dates enable milestone variance |
| `clients` | `id`, `clientId`, `name` | Client lookup for grouping reports by client |

**Relationships:**
- `project_execution_state.projectId` → `project_info.id` (1:1)
- `project_info.clientId` → `clients.id` (N:1)

### 2.2 Financial — Revenue

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `normalized_revenue_lines` | `projectId`, `projectName`, `amountExVat`, `invoiceNumber`, `invoiceDate`, `invoiceDateConfirmed`, `expectedPaymentDate`, `paidDate`, `paidDateConfirmed`, `inBankDate`, `status`, `milestoneName`, `effectiveFrom`, `effectiveTo` | Canonical revenue source. Filter `effectiveTo IS NULL` for current rows. Status enum: `PLANNED`, `INVOICED`, `RECEIVED`, etc. |
| `program_inflows` | `projectId`, `milestoneAmount`, `plannedPaymentDate`, `invoiceRaisedDate`, `paymentReceivedDate`, `inBank` | Legacy/imported inflows; `normalizedRevenueLines` is the preferred source |
| `finance_revenue_monthly` | `projectId`, `projectName`, `category`, `monthEndDate`, `value` | Pre-aggregated monthly revenue by category — useful for trend charts |

**Revenue calculation logic** (from `dashboard-metrics.ts`):
```
totalRevenue = SUM(amountExVat) from normalizedRevenueLines WHERE effectiveTo IS NULL
receivedRevenue = SUM(amountExVat) WHERE paidDate IS NOT NULL OR inBankDate IS NOT NULL
outstandingRevenue = totalRevenue - receivedRevenue
```

### 2.3 Financial — Cost of Sales (COS)

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `normalized_cost_lines` | `projectId`, `projectName`, `costCategory`, `counterpartyName`, `amountExVat`, `invoiceNumber`, `invoiceDate`, `invoiceDateConfirmed`, `paidDate`, `paidDateConfirmed`, `poNumber`, `status`, `budgetTotal`, `budgetCos`, `effectiveFrom`, `effectiveTo` | Canonical cost source. Filter `effectiveTo IS NULL` for current rows |
| `program_expense` | `projectId`, `expenseCategory`, `budgetTotal`, `expenseActualTotal`, `expensePaymentDate` | Legacy/imported expenses |

**COS realization logic** (from `report-routes.ts`):
```
COS Realized = invoiceNumber IS NOT NULL AND invoiceDateConfirmed = true
Payment Confirmed = paidDateConfirmed = true
COS Status:
  - "Paid" if paymentConfirmed
  - "Realised" if cosRealized
  - "Committed" if poNumber exists
  - "Planned" otherwise
```

**Cost calculation logic** (from `dashboard-metrics.ts`):
```
totalCost = SUM(amountExVat) from normalizedCostLines WHERE effectiveTo IS NULL
paidCost = SUM(amountExVat) WHERE paidDate IS NOT NULL
outstandingCost = totalCost - paidCost
```

### 2.4 Financial — Gross Profit & Margin

No dedicated table — computed from revenue and cost lines.

**Gross margin formula** (from `dashboard-metrics.ts`):
```
marginPct = (totalRevenue - totalCost) / totalRevenue   [when totalRevenue > 0]
```

**Health score composite** (from `dashboard-metrics.ts`):
```
healthScore = (marginRate × 40) + (taskCompletionRate × 30) + (qcRate × 30)
```

### 2.5 Financial — Cashflow

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `cashflow_points` | `projectId`, `projectName`, `seriesName`, `pointDate`, `value` | Time-series cashflow data per project per series |
| `cashflow_balance_history` | `weekStartDate`, `previousValue`, `newValue`, `delta` | Weekly cashflow balance tracking |
| `cashflow_weekly_manual` | `weekStartDate`, `opexAmount` | Manual weekly opex overrides |
| `available_payment_overrides` | `weekStartDate`, `overrideValue`, `reason` | Manual overrides for available payments |

### 2.6 Financial — Budgets & Forecasts

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `fye_budgets` | `projectId`, `projectName`, `fye`, `monthKey`, `budgetType`, `amount` | Fiscal-year-end budgets by month and type |
| `opex_budget_monthly` | `monthKey`, `amount` | Monthly OPEX budget figures |
| `forecast_pipeline` | `projectId`, `projectName`, `fyeYear`, `dealProbabilityPct`, `solarRevenue`, `bessRevenue`, `forecastGpPct`, `status` | Pipeline forecast for revenue planning |

### 2.7 Tasks & Work Items

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `work_items` | `id`, `projectId`, `workstream`, `title`, `status`, `priority`, `startDate`, `endDate`, `percentComplete`, `ownerName`, `ownerUserId`, `phase`, `isMilestone`, `completedAt`, `trackingRag`, `deletedAt` | Unified task table. Filter by `workstream` (PM, ENG, QC, etc.) and `deletedAt IS NULL` |
| `work_item_assignments` | `workItemId`, `userId`, `role`, `allocationPct` | Multi-assignment support |
| `work_item_status_history` | `workItemId`, `oldStatus`, `newStatus`, `changedAt`, `reason` | Status change audit trail — useful for "tasks completed this month" |
| `task_time_entries` | `workItemId`, `userId`, `durationMinutes`, `date` | Time tracking for resource utilisation |

**Task status aggregation** (from `dashboard-metrics.ts`):
```
Completed = status IN ('COMPLETE', 'COMPLETED', 'DONE')
In Progress = status = 'IN PROGRESS'
Overdue = endDate < today AND status NOT IN completed/cancelled statuses
```

### 2.8 Quality Management

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `qc_checklist` | `projectId`, `templateId`, `status` | One checklist per project |
| `qc_item_instance` | `checklistId`, `approved`, `isApplicable`, `qmStatus`, `assigneeUserId` | Individual QC items; approved/applicable drives QC progress % |
| `qc_warning` | `projectId`, `severity`, `warningType`, `title`, `status` | Open warnings = risk indicators |
| `qc_postmortem` | `projectId`, `completedAt` | Post-project quality review |
| `qc_postmortem_summary` | `postmortemId`, `contractorQualityScore`, `engineeringQualityScore`, `redFlag` | Quality scores for completed projects |
| `raid_items` | `projectId`, `type` (RISK/ASSUMPTION/ISSUE/DEPENDENCY), `title`, `status`, `priority`, `dueDate` | RAID log items |

**QC progress formula** (from `dashboard-metrics.ts`):
```
qcProgressPct = COUNT(approved AND isApplicable) / COUNT(isApplicable)
```

### 2.9 Engineering Deliverables

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `deliverables` | `projectId`, `deliverableType`, `title`, `status`, `currentVersion`, `ownerUserId`, `reviewerUserId` | Engineering deliverable tracking |
| `deliverable_versions` | `deliverableId`, `versionNumber`, `status` | Version history per deliverable |
| `project_eng_stages` | `projectId`, `stageTemplateId`, `status` | Engineering stage gate progress |
| `commissioning_items` | `projectId`, `title`, `status`, `category`, `dueDate` | Commissioning checklist items |

### 2.10 Procurement

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `procurement_items` | `projectId`, `title`, `category`, `expectedCost`, `actualCost`, `supplierId`, `status`, `paymentStatus` | Procurement line items |
| `counterparties` | `id`, `nameCanonical`, `typeDefault`, `isCore` | Supplier/counterparty master data |

### 2.11 Users & Permissions

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `users` | `id`, `username`, `email`, `name`, `role`, `department` | User lookup for owner/assignee names |
| `role_permissions` | `role`, `sections`, `entityPermissions` | Controls report access via `requirePermission("reports", "view")` |

### 2.12 Pre-computed Metrics (Materialized)

| Table | Key Columns for Reporting | Notes |
|-------|--------------------------|-------|
| `dashboard_project_metrics` | `projectId`, `totalRevenue`, `receivedRevenue`, `outstandingRevenue`, `totalCost`, `paidCost`, `outstandingCost`, `marginPct`, `taskCount`, `tasksCompleted`, `tasksInProgress`, `tasksOverdue`, `openWarnings`, `qcProgressPct`, `healthScore`, `phase`, `ragStatus`, `lastRefreshedAt` | Pre-computed per-project summary — refreshed by `dashboard-metrics.ts` service |
| `dashboard_program_metrics` | Program-level aggregates | Aggregated across all active projects |

---

## 3. Temporal Versioning Pattern

Financial tables use soft-delete temporal versioning:
- `effectiveFrom`: timestamp when row became current
- `effectiveTo`: timestamp when row was superseded (NULL = current)
- `snapshotRunId`: links to import batch

**Query pattern for current data:**
```sql
SELECT * FROM normalized_cost_lines WHERE effective_to IS NULL
```

**Query pattern for point-in-time (e.g., month-end snapshot):**
```sql
SELECT * FROM normalized_cost_lines
WHERE effective_from <= '2026-02-28T23:59:59'
  AND (effective_to IS NULL OR effective_to > '2026-02-28T23:59:59')
```

---

## 4. Existing Report Infrastructure

### 4.1 Server-side (`server/report-routes.ts`)
- **Operational Overview KPIs** — `GET /api/admin/reports/operational-overview?month=YYYY-MM`
- **Operational Overview PDF** — `GET /api/admin/reports/operational-overview/pdf?month=YYYY-MM` (returns HTML slide)
- **Project Plan Report** — `GET /api/reports/project-plan` (JSON + XLSX export)
- **Cost Report** — `GET /api/reports/cost` (JSON + XLSX, includes COS status logic)
- **Quality Report** — `GET /api/reports/quality` (JSON + XLSX)
- **Resource Allocation** — `GET /api/reports/resource-allocation` (JSON + XLSX)

### 4.2 Client-side (`client/src/pages/programme-reports.tsx`)
- Tabbed report viewer (Project Plan, Cost, Quality, Resource Allocation)
- Excel export via fetch + blob download
- Staleness warnings and protected-field indicators

### 4.3 Libraries Available
| Library | Version | Purpose |
|---------|---------|---------|
| `exceljs` | 4.4.0 | XLSX generation (server-side) |
| `pdfkit` | 0.17.2 | PDF generation (server-side) |
| `jspdf` | 4.1.0 | PDF generation (client-side) |
| `recharts` | 2.15.4 | Charts (client-side) |

### 4.4 Navigation
Reports would fit under an existing or new top-level section. Current navigation structure in `client/src/config/app-navigation.ts` has sections: Home, Project Lifecycle, PD, PM, Engineering, Quality, Finance, Knowledge, Admin.

---

## 5. Data Gaps & Recommendations

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No `monthly_reports` table for persisted snapshots | Reports are currently computed on-the-fly | Consider adding a `monthly_report_snapshots` table to store generated report data for historical comparison |
| No dedicated "report period" concept | Month boundaries computed at query time | Reuse the existing `parseMonth()` helper from report-routes.ts |
| `finance_revenue_monthly` has pre-aggregated monthly data | Could accelerate monthly trend charts | Use as data source for revenue trend sparklines |
| `fye_budgets` has monthly budget breakdowns | Enables budget-vs-actual comparison | Join with actual revenue/cost aggregates for variance reporting |
| Temporal queries need care | Point-in-time queries must use `effectiveFrom`/`effectiveTo` window | Standardise a shared helper for month-end snapshots |

---

## 6. Conclusion

All data required for a comprehensive monthly management report is available in the existing schema. The `normalizedRevenueLines` and `normalizedCostLines` tables are the canonical financial sources. The `dashboard_project_metrics` materialized table provides pre-computed KPIs. The existing `report-routes.ts` infrastructure provides reusable patterns for data aggregation, XLSX export, and staleness tracking.

No schema migrations are required for read-only reporting. A new `monthly_report_snapshots` table is recommended only if the business requires persisted historical report data (e.g., "show me last October's report exactly as it was generated").
