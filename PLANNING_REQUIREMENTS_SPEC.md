# Emergent Energy Dashboard — Planning Requirements Specification

**Version:** 1.0
**Date:** 2026-02-11
**Author:** System Architect

---

## 1. Current State Audit

### 1.1 Existing Pages
| Page | Purpose | Status |
|------|---------|--------|
| Home | Portfolio summary, execution KPIs, financial KPIs | Operational |
| Dashboard | Program-level milestone + financial summary | Operational |
| Projects | Projects summary table with editable fields | Operational |
| Project Detail | Expenditure breakdown (dual-table), revenue tracking | Operational |
| Cashflow | Weekly cashflow grid with manual overrides | Partial — actuals only, no forecasting |
| COS Tracker | Monthly planned/realised/outstanding grid | Partial — aggregated only, no line-item drilldown |
| Revenue (REV Tracker) | Monthly revenue grid with per-project toggle | Operational |
| Admin | Folder upload, refresh, active/historical tracking | Operational |

### 1.2 Imported Data Volume
| Table | Rows | Notes |
|-------|------|-------|
| project_info | 57 | 57 unique projects, includes PM, PD, phase, dates, size_kwp |
| program_expense | 8,052 | 56 unique projects. 4,158 Paid, 8 Invoiced, 4 Committed, 151 Planned |
| program_inflows | 807 | 342 with amounts, 300 with invoice numbers, 345 with payment dates |
| project_plan | 2,230 | Task-level schedule data across projects |
| finance_cos_monthly | 6,931 | Pre-aggregated monthly COS by project+category |
| finance_revenue_monthly | 6,676 | Pre-aggregated monthly revenue by project+category |
| cashflow_points | 187,184 | Time-series cashflow data |

### 1.3 Data Field Coverage (program_expense)
| Field | Populated | % |
|-------|-----------|---|
| expense_actual_total | 4,005 | 50% |
| expense_invoice_number | 3,479 | 43% |
| expense_invoiced_date | 4,244 | 53% |
| expense_payment_date | 4,218 | 52% |
| expense_po_number | 867 | 11% |
| forecast_payment_date | 411 | 5% |
| line_status | 4,321 | 54% |

### 1.4 Data Field Coverage (program_inflows)
| Field | Populated | % |
|-------|-----------|---|
| milestone_amount | 342 | 42% |
| milestone_invoice_number | 300 | 37% |
| invoice_raised_date | 285 | 35% |
| payment_received_date | 345 | 43% |
| planned_payment_date | 331 | 41% |

### 1.5 Gaps Identified
1. **No Region field** — project_info has no region column
2. **No Installer field** — no installer/contractor mapping exists
3. **No Supplier mapping** — expense lines have no normalised supplier field (vendor names are embedded in invoice descriptions)
4. **PM data is inconsistent** — multiple spellings (e.g., "Natasha Watkins Baker" vs "Natasha Watkins-Baker", "Peet" vs "Peet Verenney" vs "Peet Verreynne")
5. **PD field has address data** — some PD values contain addresses instead of person names
6. **No line-item stable IDs** — expense and inflow rows use auto-increment `id` only
7. **No resource capacity tables** — no PM/installer/supplier capacity data exists
8. **forecast_payment_date only populated on 5% of expenses** — forecasting largely missing
9. **line_status only populated on 54% of expenses** — needs recomputation

---

## 2. Feature List

### Feature Set 1: Resource Utilisation + Planning Board
| ID | Feature | Priority |
|----|---------|----------|
| RU-1 | Planning Overrides table (region, PM, installer, supplier per entity) | P0 |
| RU-2 | Planning Board view (filterable project master table) | P0 |
| RU-3 | PM capacity definition + weekly demand heatmap | P1 |
| RU-4 | Installer capacity definition + weekly demand heatmap | P1 |
| RU-5 | Supplier capacity definition + weekly demand heatmap | P2 |
| RU-6 | Over-allocation alerts + float-based project move suggestions | P2 |
| RU-7 | Baseline vs Forecast vs Actual date columns with tags | P1 |

### Feature Set 2: Cashflow Planning + Forecasting (Weekly)
| ID | Feature | Priority |
|----|---------|----------|
| CF-1 | Line-item-driven weekly cashflow (inflows + outflows) | P0 |
| CF-2 | Forecast inflows: invoice+terms, planned milestone dates | P0 |
| CF-3 | Forecast outflows: invoice+terms, PO+lead time, planned COS curve | P0 |
| CF-4 | Configurable payment terms (by supplier/category/client) | P1 |
| CF-5 | Weekly drilldown side panel (inflow + outflow line items) | P0 |
| CF-6 | Confidence scoring (High/Medium/Low) per forecast line | P1 |
| CF-7 | Conservative vs Aggressive toggle | P1 |
| CF-8 | Opening balance, closing balance, runway calculation | P0 |
| CF-9 | OPEX budget weekly allocation | P1 |
| CF-10 | Minimum balance threshold alerts | P1 |

### Feature Set 3: COS Realisation + Line-Item State Machine
| ID | Feature | Priority |
|----|---------|----------|
| COS-1 | Line-item state machine (Planned/Committed/Invoiced/Paid) | P0 |
| COS-2 | COS Control Dashboard (KPI cards: planned, committed, invoiced, paid, outstanding) | P0 |
| COS-3 | COS by Project table with state breakdown | P0 |
| COS-4 | COS timeline (weekly/monthly stacked actuals vs forecast) | P1 |
| COS-5 | Invoice-level rollup view (group by invoice number) | P1 |
| COS-6 | PO-level rollup view (group by PO number) | P1 |
| COS-7 | Forecast COS realisation (per line item, using terms) | P0 |
| COS-8 | Line-item manual overrides with audit trail | P1 |

### Cross-Cutting
| ID | Feature | Priority |
|----|---------|----------|
| XC-1 | Data Quality panel (missing fields, duplicates, anomalies) | P0 |
| XC-2 | Line-item stable IDs (hash-based) | P0 |
| XC-3 | Reconciliation tests (totals == sum of line items) | P0 |
| XC-4 | Planning Overrides table with audit trail | P0 |
| XC-5 | Calculation engine module (centralised, not in UI) | P0 |

---

## 3. Data Model Changes

### 3.1 New Table: `planning_overrides`
Stores planning dimension overrides without modifying imported data.

```
planning_overrides
  id              SERIAL PRIMARY KEY
  entity_type     TEXT NOT NULL        -- 'project' | 'task' | 'expense' | 'milestone'
  entity_id       TEXT NOT NULL        -- project_name or row id
  field_name      TEXT NOT NULL        -- 'region' | 'pm' | 'installer' | 'supplier' | 'baseline_start' | 'baseline_end' | 'forecast_start' | 'forecast_end' | etc.
  value           TEXT
  effective_from  TEXT                 -- optional date
  effective_to    TEXT                 -- optional date
  created_by      TEXT NOT NULL
  created_at      TIMESTAMP DEFAULT NOW()
```

### 3.2 New Table: `resource_capacity`
Defines weekly capacity per resource.

```
resource_capacity
  id              SERIAL PRIMARY KEY
  resource_type   TEXT NOT NULL        -- 'pm' | 'installer' | 'supplier'
  resource_name   TEXT NOT NULL        -- PM name / installer team name / supplier name
  week_start      TEXT NOT NULL        -- ISO date of week start
  capacity_value  DECIMAL(12,2)       -- units (projects for PM, kWp for installer, R for supplier)
  capacity_unit   TEXT                 -- 'projects' | 'kwp_week' | 'rand_week'
  created_by      TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
```

### 3.3 New Table: `payment_terms`
Configurable payment terms by supplier/client/category.

```
payment_terms
  id              SERIAL PRIMARY KEY
  entity_type     TEXT NOT NULL        -- 'supplier' | 'client' | 'category'
  entity_name     TEXT NOT NULL        -- supplier name / client name / category name
  terms_days      INTEGER NOT NULL     -- default payment terms in days
  scenario        TEXT DEFAULT 'base'  -- 'conservative' | 'aggressive' | 'base'
  created_by      TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
```

### 3.4 New Table: `line_item_overrides`
Per-line-item forecast overrides with audit trail.

```
line_item_overrides
  id                      SERIAL PRIMARY KEY
  line_type               TEXT NOT NULL        -- 'expense' | 'inflow'
  line_id                 INTEGER NOT NULL     -- program_expense.id or program_inflows.id
  override_forecast_date  TEXT                 -- overridden forecast date
  override_terms_days     INTEGER              -- overridden terms days
  override_amount         DECIMAL(15,2)        -- overridden amount (locked by default)
  override_reason         TEXT NOT NULL        -- required explanation
  created_by              TEXT NOT NULL
  created_at              TIMESTAMP DEFAULT NOW()
```

### 3.5 Add Columns to `program_expense`
| Column | Type | Purpose |
|--------|------|---------|
| `expense_line_hash` | TEXT | Stable hash ID for line-item tracking |
| `computed_state` | TEXT | Computed: Planned/Committed/Invoiced/Paid |
| `computed_forecast_payment_date` | TEXT | System-computed forecast payment date |
| `supplier_name` | TEXT | Normalised supplier name (extracted or mapped) |

### 3.6 Add Columns to `program_inflows`
| Column | Type | Purpose |
|--------|------|---------|
| `inflow_line_hash` | TEXT | Stable hash ID for line-item tracking |
| `computed_forecast_receipt_date` | TEXT | System-computed forecast receipt date |

---

## 4. Calculation Engine

All calculations will live in `server/lib/calculations/` as pure functions, testable independently of routes or UI.

### 4.1 Line-Item State Classification (`classifyExpenseState`)
```
Input: expense line (PO, invoice number, invoiced date, payment date)
Output: 'Planned' | 'Committed' | 'Invoiced' | 'Paid'

Rules:
  IF payment_date exists AND payment_date != '' → Paid
  ELSE IF invoice_number exists AND invoice_number != '' → Invoiced
  ELSE IF po_number exists AND po_number != '' → Committed
  ELSE → Planned
```

### 4.2 Expense Forecast Date (`forecastExpensePaymentDate`)
```
Input: expense line, payment_terms config, scenario
Output: forecast payment date

Rules:
  IF payment_date exists → actual (no forecast needed)
  ELSE IF invoiced_date exists → invoiced_date + terms_days(supplier, scenario)
  ELSE IF po_number exists → po_date_estimate + lead_time + terms_days
  ELSE IF forecast_payment_date (imported) exists → use it
  ELSE → allocate across project construction window (linear)
```

### 4.3 Inflow Forecast Date (`forecastInflowReceiptDate`)
```
Input: inflow line, payment_terms config, scenario
Output: forecast receipt date

Rules:
  IF payment_received_date exists → actual (no forecast needed)
  ELSE IF invoice_raised_date exists → invoice_raised_date + terms_days(client, scenario)
  ELSE IF planned_payment_date exists → planned_payment_date
  ELSE → derive from project milestone schedule
```

### 4.4 Weekly Cashflow Aggregation (`computeWeeklyCashflow`)
```
Input: all expense lines, all inflow lines, week boundaries, opening balance
Output: per-week { inflows_actual, inflows_forecast, outflows_actual, outflows_forecast, opening, closing }

Rules:
  For each week [monday..sunday]:
    inflows_actual = SUM(inflow.amount WHERE payment_received_date IN week)
    inflows_forecast = SUM(inflow.amount WHERE forecast_receipt_date IN week AND no actual payment)
    outflows_actual = SUM(expense.amount WHERE payment_date IN week)
    outflows_forecast = SUM(expense.amount WHERE forecast_payment_date IN week AND no actual payment)
    opening = previous_week.closing (or manual opening for week 1)
    closing = opening + inflows_actual + inflows_forecast - outflows_actual - outflows_forecast
```

### 4.5 Confidence Scoring (`scoreConfidence`)
```
Input: line item (expense or inflow)
Output: 'High' | 'Medium' | 'Low'

Rules:
  High: invoice exists (invoice number + invoiced date both present)
  Medium: PO or planned date exists (for expenses) OR milestone has planned date (for inflows)
  Low: allocation-curve-based (no concrete date anchors)
```

### 4.6 Resource Demand (`computeResourceDemand`)
```
Input: projects with dates, PM assignments, size_kwp
Output: per-resource per-week demand

Rules:
  PM demand: 1 unit per active project per week (project active = between construction_start and client_handover)
  Installer demand: size_kwp / duration_weeks per week during construction phase
  Supplier demand: planned expense spend allocated per week during procurement window
```

### 4.7 COS Aggregation (`aggregateCOS`)
```
Input: all expense lines with states
Output: { totalPlanned, totalCommitted, totalInvoiced, totalPaid, totalOutstanding, forecastNext4w, forecastNext8w, forecastNext12w }

Rules:
  totalPlanned = SUM(amount WHERE state == 'Planned')
  totalCommitted = SUM(amount WHERE state == 'Committed')
  totalInvoiced = SUM(amount WHERE state == 'Invoiced')
  totalPaid = SUM(amount WHERE state == 'Paid')
  totalOutstanding = totalCommitted + totalInvoiced
  forecastNextNw = SUM(amount WHERE forecast_payment_date within next N weeks AND state != 'Paid')
```

---

## 5. UI Screens & Interactions

### 5.1 Planning Board (`/planning`)
- **Filter Bar**: FY, Region, PM, Installer, Phase, Project name search, Date range
- **Main Table**: One row per project
  - Project Name, Region, PM, Installer, Top 3 Suppliers
  - Construction Start (baseline / forecast / actual)
  - Commissioning (baseline / forecast / actual)
  - Client Handover (baseline / forecast / actual)
  - % Complete, Expected %, Delta
  - Risk Flags (icons: missing dates, missing PM, negative float, behind schedule)
- **Inline Edit**: Region, PM, Installer via Planning Overrides (logged)
- **Export**: CSV download

### 5.2 Resource Utilisation (`/resources`)
- **Tab Bar**: PM | Installers | Suppliers
- **Each Tab**:
  - Weekly timeline grid (columns = weeks, rows = resource names)
  - Capacity line (configurable)
  - Demand bars (stacked by project)
  - Red highlight for overloaded weeks
  - Click week → side panel showing contributing projects
  - "Move Forecast" button → adjust project forecast dates (logged)
- **Settings Panel**: Edit capacity per resource per week

### 5.3 Cashflow Forecast (`/cashflow-forecast`)
- **Top Controls**: Toggle Actual/Forecast, Conservative/Aggressive, Date range
- **KPI Cards**: Opening Balance, Total Inflows, Total Outflows, Closing Balance, Runway (weeks)
- **Weekly Grid**: Rows = weeks, Columns = Opening | Actual In | Forecast In | Actual Out | Forecast Out | Closing
  - Click any row → **Side Panel** with tabs: "Inflows" | "Outflows"
  - Each tab: searchable, sortable line-item table with all fields
  - Totals at bottom reconcile to weekly summary
  - Filters: Project, Category, Invoice#, PO#, Supplier, Confidence
  - Quick search: Invoice#/PO#/TrackerLocator
- **Chart**: Stacked bar (actual in/out) + line (forecast closing) + threshold line
- **Alert**: Red banner when any future week closing < threshold

### 5.4 COS Control Tower (`/cos-control`)
- **KPI Cards**: Total Planned | Committed | Invoiced | Paid | Outstanding | Forecast Next 4/8/12 Weeks
- **COS by Project Table**: Project, Planned, Committed, Invoiced, Paid, Outstanding, Forecast 4w, GP Impact
  - Click project → expand to show line items
- **COS Timeline**: Monthly stacked chart (Paid actual vs Forecast)
- **Line-Item Explorer**:
  - Full table of all expense lines with state, dates, amounts, supplier, confidence
  - Filters: Project, State, Category, Supplier, Invoice#, PO#, Date range
  - Inline: Override forecast date (with reason, logged)
- **Invoice View**: Group by invoice number, expandable to line items
- **PO View**: Group by PO number, expandable to line items
- **Data Gaps Panel**: Counts and links for missing fields, duplicates, anomalies

### 5.5 Data Quality (`/data-quality` or panel within pages)
- Missing TrackerLocator count + list
- Invoices without invoice date
- Payment dates before invoice dates
- Duplicate invoice numbers
- Missing supplier mapping where PO/invoice exists
- Negative or zero amounts
- Missing PM/Region/Installer assignments

---

## 6. Data Quality Rules

| Rule ID | Description | Severity |
|---------|-------------|----------|
| DQ-1 | Expense line missing expense_actual_total where invoice exists | Error |
| DQ-2 | Payment date earlier than invoiced date | Warning |
| DQ-3 | Duplicate invoice numbers across different projects | Warning |
| DQ-4 | Expense with PO but no invoice and > 90 days old | Warning |
| DQ-5 | Inflow milestone with invoice raised but no payment > terms+30 days | Warning |
| DQ-6 | Project missing PM assignment | Warning |
| DQ-7 | Project missing construction start date | Error |
| DQ-8 | Project missing commissioning date | Error |
| DQ-9 | Expense line with zero or negative amount | Info |
| DQ-10 | Invoice number blank where invoiced date exists | Error |
| DQ-11 | Project missing region assignment | Info |
| DQ-12 | Inconsistent PM name spellings | Info |

---

## 7. API Endpoints

### Planning Board & Resources
```
GET    /api/planning-board          — filtered project master data with overrides
POST   /api/planning-overrides      — create/update planning override
GET    /api/planning-overrides      — list all overrides
GET    /api/resource-demand/:type   — weekly demand for PM/installer/supplier
GET    /api/resource-capacity/:type — weekly capacity for PM/installer/supplier
POST   /api/resource-capacity       — set capacity for resource
```

### Cashflow Forecast
```
GET    /api/cashflow-forecast                — weekly cashflow with actuals + forecasts
GET    /api/cashflow-forecast/:weekStart/lines — line-item drilldown for a week
GET    /api/cashflow-forecast/search          — search by invoice/PO/locator
POST   /api/payment-terms                     — set payment terms
GET    /api/payment-terms                      — list payment terms
```

### COS Control
```
GET    /api/cos-control/summary              — KPI totals
GET    /api/cos-control/by-project           — COS breakdown per project
GET    /api/cos-control/timeline             — monthly/weekly COS timeline
GET    /api/cos-control/lines                — all expense line items with states
GET    /api/cos-control/invoices             — grouped by invoice number
GET    /api/cos-control/pos                  — grouped by PO number
POST   /api/line-item-overrides              — create forecast override
GET    /api/line-item-overrides              — list all overrides
```

### Data Quality
```
GET    /api/data-quality                     — all data quality issues
GET    /api/data-quality/:ruleId/items       — affected items for a rule
```

---

## 8. Tests

### 8.1 Unit Tests (Calculation Engine)
| Test | Description |
|------|-------------|
| state-classification | classifyExpenseState returns correct state for all 4 combinations |
| forecast-expense | forecastExpensePaymentDate applies correct terms by scenario |
| forecast-inflow | forecastInflowReceiptDate applies correct terms by scenario |
| confidence-scoring | scoreConfidence returns High/Medium/Low correctly |
| weekly-cashflow | computeWeeklyCashflow totals match sum of included lines |
| cos-aggregation | aggregateCOS totals match sum of state-classified lines |
| resource-demand | computeResourceDemand produces correct weekly demand |

### 8.2 Integration Tests (API)
| Test | Description |
|------|-------------|
| cashflow-reconciliation | Weekly totals == SUM(drilldown inflow lines) + SUM(drilldown outflow lines) |
| cos-reconciliation | Monthly COS totals == SUM(line items by payment date bucket) |
| invoice-reconciliation | Invoice rollup totals == SUM(constituent line items) |
| planning-override-audit | Override creates audit record with user + timestamp |
| payment-terms-cascade | Changing terms recalculates all affected forecasts |

### 8.3 Data Quality Tests
| Test | Description |
|------|-------------|
| no-orphan-totals | Every summary number has line-item provenance |
| hash-stability | Same input row always produces same hash ID |
| date-consistency | No payment dates before invoice dates pass validation |

---

## 9. Implementation Plan (Incremental)

### Phase 1: Foundation (P0)
1. Create calculation engine module (`server/lib/calculations/`)
2. Add new DB tables (planning_overrides, resource_capacity, payment_terms, line_item_overrides)
3. Add hash columns + computed state to program_expense and program_inflows
4. Implement line-item state machine + forecast engine
5. Implement data quality scanner
6. Build COS Control Tower (KPI cards + line-item explorer + state machine)
7. Build Cashflow Forecast (weekly grid + line-item drilldown)

### Phase 2: Planning & Resources (P1)
8. Build Planning Board (filterable project table with overrides)
9. Build Resource Utilisation (PM tab first)
10. Add confidence scoring to forecasts
11. Add Conservative/Aggressive toggle
12. Build Invoice and PO rollup views
13. Baseline vs Forecast vs Actual date tracking

### Phase 3: Advanced (P2)
14. Installer and Supplier resource tabs
15. Over-allocation alerts + move suggestions
16. Advanced data quality reporting
17. Export capabilities

---

## 10. Assumptions & Limitations

### What The Dashboard Cannot Know (Without Manual Input)
1. **Region** — must be assigned per project via Planning Overrides
2. **Installer teams** — must be assigned per project/phase via Planning Overrides
3. **Supplier names** — must be extracted from invoice descriptions or manually mapped
4. **Payment terms** — must be configured per supplier/client (defaults can be set)
5. **Resource capacity** — must be manually defined per PM/installer/supplier per week
6. **Baseline dates** — if not in imported data, must be entered as Planning Overrides
7. **Future milestone dates** — if not in ProgramPlan, must be entered as overrides

### Default Assumptions
- Default payment terms: 30 days (base), 45 days (conservative), 21 days (aggressive)
- PM capacity: 5 active projects per PM per week
- Installer capacity: project_size_kwp / project_duration_weeks per team per week
- COS forecast allocation: linear distribution across remaining construction window
