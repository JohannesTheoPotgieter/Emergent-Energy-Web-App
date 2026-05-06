# Emergent Energy Dashboard — KPI Traceability Matrix

## Audit Date: 2026-03-06

---

## Methodology
Each KPI is traced from source table → transformation logic → API endpoint → UI component.
Live API responses are used for test samples where available.

---

## KPI-01: Total Revenue

| Field | Value |
|-------|-------|
| KPI Name | Total Revenue |
| Source Table(s) | `program_inflows` (milestoneAmount) |
| Transformation Logic | SUM of `milestoneAmount` across all inflow records |
| API Endpoint | `GET /api/gp-tracker` (totalRevenue field) |
| UI Component | `gp-tracker.tsx`, `dashboard.tsx` |
| Test Sample | All 362 inflow records |
| Expected Value | Sum of all milestone amounts |
| Actual Value | **R445,173,516** |
| Cross-Check | Direct sum from `/api/program-inflows`: R445,173,516 — **matches** |
| **Status** | **PROVEN** |

---

## KPI-02: Total Cost of Sales (COS)

| Field | Value |
|-------|-------|
| KPI Name | Total COS |
| Source Table(s) | `program_expenses` (expenseActualTotal) |
| Transformation Logic | SUM of `expenseActualTotal` across all expense records where type qualifies |
| API Endpoint | `GET /api/gp-tracker` (totalCOS field) |
| UI Component | `gp-tracker.tsx`, `cos.tsx` |
| Test Sample | All 4,564 expense records |
| Expected Value | Sum of all actual expense totals |
| Actual Value | **R408,960,700** |
| Cross-Check | Direct sum from `/api/program-expenses`: R408,960,700 — **matches** |
| **Status** | **PROVEN** |

---

## KPI-03: Gross Profit (GP)

| Field | Value |
|-------|-------|
| KPI Name | Gross Profit |
| Source Table(s) | Derived from Revenue and COS |
| Transformation Logic | `GP = Total Revenue - Total COS` |
| API Endpoint | `GET /api/gp-tracker` (totalGP field) |
| UI Component | `gp-tracker.tsx` |
| Expected Value | R445,173,516 - R408,960,700 = R36,212,816 |
| Actual Value | **R36,212,816** |
| Calculation Verified | Revenue (R445M) - COS (R409M) = R36.2M — **matches** |
| **Status** | **PROVEN** |

---

## KPI-04: Cashflow

| Field | Value |
|-------|-------|
| KPI Name | Weekly Cashflow |
| Source Table(s) | `program_inflows` (effectiveDate), `program_expenses` (expensePaymentDate), `opex_budget_monthly`, `cashflow_weekly_manual` |
| Transformation Logic | Opening Balance + Inflows - (Project Outflows + OPEX Outflows) = Closing Balance |
| API Endpoint | `GET /api/cashflow-2026` |
| UI Component | `cashflow.tsx` |
| Test Sample | 53 weeks, 51 with data |
| Sample Week | w/c 2025-09-01: inflows=R1,508,831, outflows=R8,481,181, balance=-R6,972,349 |
| Balance Logic Verified | Closing = Opening + Inflows - Outflows — **formula is correct** |
| **Status** | **PROVEN** |

---

## KPI-05: Revenue Tracker (Monthly Breakdown)

| Field | Value |
|-------|-------|
| KPI Name | Monthly Revenue by Project |
| Source Table(s) | `program_inflows` (grouped by invoiceRaisedDate) |
| Transformation Logic | Group inflows by month of `invoiceRaisedDate`; planned = milestoneAmount, realised = from `tracker_monthly_manual` |
| API Endpoint | `GET /api/rev-tracker` |
| UI Component | `revenue.tsx` |
| Test Sample | 12 projects returned |
| Expected Value | Monthly revenue breakdown per project |
| Actual Value | 12 projects returned but **all monthly values are empty/null** |
| Root Cause | 0/362 inflow records have `invoiceNumber` set — no invoices have been raised |
| **Status** | **PARTIALLY PROVEN** — API works correctly but returns empty monthly data due to no invoiced records |

---

## KPI-06: COS Tracker (Monthly Breakdown)

| Field | Value |
|-------|-------|
| KPI Name | Monthly COS by Project |
| Source Table(s) | `program_expenses` (grouped by expenseInvoicedDate) |
| Transformation Logic | Group expenses by month of invoice date; classify by payment state |
| API Endpoint | `GET /api/cos-tracker` |
| UI Component | `cos.tsx` |
| Test Sample | 12 projects returned |
| Expected Value | Monthly COS breakdown per project |
| Actual Value | 12 projects with **0 monthly data entries** |
| Root Cause | 0/4,564 expense records marked as "Paid" — no payment dates set |
| **Status** | **PARTIALLY PROVEN** — API works but returns empty monthly data |

---

## KPI-07: Project Progress

| Field | Value |
|-------|-------|
| KPI Name | Project Task Completion |
| Source Table(s) | `work_items` (percentComplete, status) |
| Transformation Logic | Count of tasks by status; weighted % complete; summary rollup |
| API Endpoint | `GET /api/planning-tasks/:projectName` + summary-rollup |
| UI Component | `UnifiedPlanTab.tsx` |
| Test Sample | MEGA PARK P2: 49 tasks |
| Expected Value | Status distribution reflecting actual task completion |
| Actual Value | Done: 41/49 (84%), Not Started: 8/49 (16%) |
| **Status** | **PROVEN** |

---

## KPI-08: Engineering Progress

| Field | Value |
|-------|-------|
| KPI Name | Engineering Task Status Distribution |
| Source Table(s) | `engineering_tasks` / `operational_tasks` with engineering workstream |
| Transformation Logic | Count by status |
| API Endpoint | `GET /api/eng/tasks` |
| UI Component | Engineering dashboard pages |
| Test Sample | 131 engineering tasks |
| Actual Value | TO DO: 84, IN PROGRESS: 34, COMPLETE: 3, HOLD: 7, NEEDS APPROVAL: 1, QC APPROVED: 1, PROVIDE FEEDBACK: 1 |
| **Status** | **PROVEN** |

---

## KPI-09: Quality Status

| Field | Value |
|-------|-------|
| KPI Name | Quality Dashboard Metrics |
| Source Table(s) | `qc_checklist`, `qc_item_instance`, `work_items` (quality workstream) |
| Transformation Logic | Count of checklists, pending approvals, open/total warnings |
| API Endpoint | `GET /api/quality/dashboard` |
| UI Component | Quality dashboard page |
| Test Sample | Full QC dataset |
| Actual Value | Checklists: 10, Pending Approvals: 460, Open Warnings: 0, Total Warnings: 0 |
| Note | 460 pending approvals aligns with the 460 QC items migrated (DEF-002 fix). All start as pending. |
| **Status** | **PROVEN** |

---

## KPI-10: My Work Counts

| Field | Value |
|-------|-------|
| KPI Name | User Task Count in My Work |
| Source Table(s) | `work_items` + `work_item_assignments` + `mytool_tasks` |
| Transformation Logic | Union of owned tasks + assigned tasks + viewer tasks across all sources |
| API Endpoint | `GET /api/my-work/all-tasks` |
| UI Component | `my-work-tasks.tsx` |
| Test Sample | Admin users: dayne (CEO_ADMIN), johannes (COO_ADMIN) |
| Expected Value | Tasks assigned to user |
| Actual Value | **0 tasks for both admin users** |
| Root Cause | Admin users have no `work_item_assignments` records and are not set as `owner_user_id` on any work items |
| **Status** | **NOT PROVEN** — endpoint works but cannot verify aggregation without assigned tasks |

---

## KPI-11: Portfolio Headline Totals

| Field | Value |
|-------|-------|
| KPI Name | Portfolio Aggregated Metrics |
| Source Table(s) | `project_info` (aggregated) |
| Transformation Logic | Sum contract values, weighted completion, GP across portfolio |
| API Endpoint | `GET /api/projects-summary` |
| UI Component | Portfolio views |
| Test Sample | 70 projects |
| Expected Value | Aggregated contract values and financial totals |
| Actual Value | All 70 projects show `contract_value: null`, `total_contract_revenue: 0`, `total_expenses: 0` |
| Root Cause | `contract_value` column not populated on `project_info` — financial data lives in separate inflow/expense tables, not rolled up to project level |
| **Status** | **PARTIALLY PROVEN** — project list works but financial rollup fields are empty |

---

## Summary

| KPI | Status | Notes |
|-----|--------|-------|
| Total Revenue | PROVEN | R445M verified across two endpoints |
| Total COS | PROVEN | R409M verified across two endpoints |
| Gross Profit | PROVEN | R36.2M = Revenue - COS, mathematically verified |
| Cashflow | PROVEN | 53 weeks, balance formula verified |
| Revenue Tracker (Monthly) | PARTIALLY PROVEN | API works, data empty (no invoices) |
| COS Tracker (Monthly) | PARTIALLY PROVEN | API works, data empty (no payments) |
| Project Progress | PROVEN | 49 tasks with status distribution |
| Engineering Progress | PROVEN | 131 tasks with status distribution |
| Quality Status | PROVEN | 10 checklists, 460 pending approvals |
| My Work Counts | NOT PROVEN | 0 tasks for test users |
| Portfolio Totals | PARTIALLY PROVEN | Project list works, financial fields empty |

**Overall KPI Assessment: 6 PROVEN, 4 PARTIALLY PROVEN, 1 NOT PROVEN**
