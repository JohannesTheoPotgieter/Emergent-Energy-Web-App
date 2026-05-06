# Emergent Energy Dashboard — Planning Requirements Specification

**Version:** 2.0  
**Date:** 2026-03-03  
**Author:** System Architect  
**Status:** Reflects current implemented functionality

---

## 1. Overview

The Project Plan module provides MS Project-style task management for tracking project schedules within the Emergent Energy Dashboard. It supports hierarchical Work Breakdown Structures (WBS), inline editing, Critical Path Method (CPM) scheduling, Gantt chart visualisation, baseline tracking, and full integration with the Excel Tracker import pipeline and financial modules.

All plan task data is stored in the canonical `work_items` table (workstream = `PM`). Legacy tables (`normalized_plan_tasks`, `project_plan`) are retained as read-only baseline references.

---

## 2. Data Model

### 2.1 Canonical Table: `work_items`

The `work_items` table is the single source of truth for all plan tasks.

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Auto-incrementing primary key |
| `projectId` | integer FK | References `project_info.id` |
| `workstream` | enum | Always `'PM'` for plan tasks |
| `type` | text | `'task'` or `'milestone'` |
| `source` | enum | `'UI'` (manually created) or `'SMART_IMPORT'` (from Excel) |
| `title` | text | Task name |
| `description` | text | Task description/notes |
| `status` | text | `'Not Started'`, `'In Progress'`, `'Complete'`, `'Blocked'`, `'Hold'` |
| `priority` | text | `'Low'`, `'Medium'`, `'High'`, `'Critical'` |
| `startDate` | text | ISO date string — planned or actual start |
| `endDate` | text | ISO date string — planned or actual end |
| `duration` | integer | Duration in working days |
| `percentComplete` | real | 0–100 completion percentage |
| `expectedPctComplete` | real | Computed target % based on today vs start/end |
| `wbsCode` | text | Work Breakdown Structure code (e.g., `'1.2.1'`) |
| `outlineNumber` | text | Hierarchical outline number for display |
| `indentLevel` | integer | Depth in the hierarchy (0 = top level) |
| `parentId` | integer | Self-reference to parent `work_items.id` |
| `isMilestone` | boolean | Whether this task is a milestone (zero duration) |
| `phase` | text | Project phase this task belongs to |
| `ownerUserId` | integer FK | Assigned resource — references `users.id` |
| `sortOrder` | integer | Display ordering within the plan |
| `externalRef` | text | External system reference (e.g., ClickUp ID) |
| `legacyTable` | text | Source legacy table name (if migrated) |
| `legacyId` | integer | Original ID from the legacy table |
| `importRunId` | integer | Links to `smart_import_runs.id` |
| `baselineStart` | text | Original baseline start date |
| `baselineEnd` | text | Original baseline end date |
| `baselineDuration` | integer | Original baseline duration |
| `taskMode` | text | `'auto'` (schedule-driven) or `'manual'` |
| `deletedAt` | timestamp | Soft delete timestamp (null = active) |
| `createdAt` | timestamp | Record creation timestamp |
| `updatedAt` | timestamp | Last modification timestamp |

### 2.2 Override Sidecar: `project_plan_overrides`

Manual edits to Excel-imported tasks are stored separately so the original baseline is preserved.

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Primary key |
| `projectName` | text | Project name |
| `taskId` | integer | References the original task |
| `field` | text | Which field was overridden (e.g., `'startDate'`, `'percentComplete'`) |
| `originalValue` | text | Value before override |
| `overrideValue` | text | User-supplied replacement value |
| `overriddenBy` | text | Username of who made the change |
| `overriddenAt` | timestamp | When the override was made |

### 2.3 Baseline Reference: `project_plan` (Legacy, Read-Only)

Stores the original imported plan data from Excel trackers. Used for baseline comparison and "Reset to Baseline" operations.

### 2.4 Financial Tables

| Table | Purpose |
|---|---|
| `normalized_cost_lines` | All project cost/expense line items (COS data) |
| `normalized_revenue_lines` | All project revenue/inflow line items |

Both tables use the same import pipeline as plan tasks and are refreshed on each Excel import commit.

---

## 3. Frontend Components

### 3.1 UnifiedPlanTab (Primary View)

**File:** `client/src/components/tabs/UnifiedPlanTab.tsx`

The main task grid view providing a spreadsheet-style interface.

#### 3.1.1 Grid Columns

| Column | Editable | Description |
|---|---|---|
| Row # | No | Auto-numbered sequential row |
| WBS | Yes | Work Breakdown Structure code, auto-generated from hierarchy |
| Task Name | Yes | Inline text editing with click-to-edit |
| Duration | Yes | Working days (excludes weekends and SA public holidays) |
| Start | Yes | Date picker — updates end date when changed with duration |
| Finish | Yes | Date picker — updates duration when changed with start |
| Predecessors | Yes | Task dependency references (row numbers) |
| Resource | Yes | User assignment via searchable picker |
| % Complete | Yes | Numeric input 0–100 with progress bar |
| Expected % | No | Auto-calculated based on elapsed time vs duration |
| Status | No | Auto-derived RAG indicator from % complete vs expected % |

#### 3.1.2 Inline Editing Behaviour

- **Click-to-edit:** All editable cells activate on click or focus.
- **Save on blur:** Changes persist when the user clicks away or tabs out.
- **Date/Duration auto-calculation:**
  - Changing Start + Duration → End date auto-calculated (working days, excluding SA public holidays).
  - Changing Start + End → Duration auto-calculated.
  - Changing Duration + Start → End auto-calculated.
- **Working days calculation:** Excludes weekends (Saturday, Sunday) and South African public holidays.

#### 3.1.3 WBS & Hierarchy

- Tasks support parent-child relationships via `parentId`.
- Indent level determines visual nesting depth.
- WBS codes auto-generated from hierarchy (e.g., 1 → 1.1 → 1.1.1).
- **Auto-renumber:** POST `/api/project-plan/structure` with `operation: "renumber"` recalculates all WBS codes based on current hierarchy and sort order.
- **Collapsible groups:** Parent tasks can be expanded/collapsed to show/hide child tasks.

#### 3.1.4 Summary Task Rollup

Parent (summary) tasks automatically aggregate child task data:
- **% Complete:** Weighted average of child tasks based on duration.
- **Start Date:** Minimum start date of all children.
- **End Date:** Maximum end date of all children.
- **Duration:** Calculated from rolled-up start to end.

API: `GET /api/planning-tasks/:projectName/summary-rollup`

#### 3.1.5 RAG Status (Auto-Calculated)

| Condition | RAG | Visual |
|---|---|---|
| % Complete >= Expected % | Green | Green dot |
| % Complete < Expected % (within 10%) | Amber | Amber dot |
| % Complete < Expected % (> 10% behind) | Red | Red dot |
| Task complete (100%) | Green | Green filled circle |
| Not started, past start date | Red | Red dot |

#### 3.1.6 Bulk Operations

POST `/api/planning-tasks/bulk`

| Operation | Description |
|---|---|
| `delete` | Soft-delete selected tasks |
| `indent` | Increase indent level, set parent to preceding task |
| `outdent` | Decrease indent level, move up in hierarchy |
| `moveUp` | Move selected tasks up in sort order |
| `moveDown` | Move selected tasks down in sort order |

All bulk operations trigger Excel sync notifications and audit logging.

#### 3.1.7 New Task Creation

- **"+ Add a new task..."** row at the bottom of the grid.
- Creates a new `work_items` record with `workstream: 'PM'`, `source: 'UI'`.
- Inherits project context (projectId, projectName).
- Default status: `'Not Started'`, default % complete: 0.

#### 3.1.8 Milestone Support

- Tasks can be marked as milestones (zero duration, displayed as diamond markers).
- "Virtual Milestones" can be created for key dates.
- Milestones participate in the critical path calculation.

### 3.2 ProjectPlanTab (CPM & Gantt View)

**File:** `client/src/components/tabs/ProjectPlanTab.tsx`

Split-pane view with task grid on the left and Gantt chart on the right.

#### 3.2.1 Critical Path Method (CPM)

- Backend engine: `server/cpmEngine.ts`
- Calculates for each task:
  - **Early Start (ES)** and **Early Finish (EF):** Forward pass
  - **Late Start (LS)** and **Late Finish (LF):** Backward pass
  - **Slack/Float:** `LS - ES` (or `LF - EF`)
- **Critical Path:** Tasks where slack <= 0, highlighted in red on the Gantt chart.
- API: `GET /api/projects/:projectName/working-plan`

#### 3.2.2 Gantt Chart

- Visual timeline rendering of all plan tasks.
- **Zoom levels:** Week, Month, Quarter.
- **"Jump to Today"** button centres the view on the current date.
- **"Fit to Project"** scales the view to show the entire project duration.
- Task bars colour-coded by status/RAG.
- Critical path tasks highlighted with distinct colour.
- Dependency arrows drawn between linked tasks.

#### 3.2.3 Dependencies

- Supports four dependency types:
  - **FS (Finish-to-Start):** Default — predecessor must finish before successor starts.
  - **SS (Start-to-Start):** Both tasks start together.
  - **FF (Finish-to-Finish):** Both tasks finish together.
  - **SF (Start-to-Finish):** Predecessor start triggers successor finish.
- **Lag days:** Optional positive or negative offset on any dependency.
- Add/delete dependencies via inline UI or dependency dialog.

#### 3.2.4 Schedule Impact & Change Notices

- When a task on the critical path has its end date extended, the system triggers a **Schedule Impact** warning.
- Saving such a change requires a user note explaining the reason.
- Generates a **Schedule Change Notice** stored via `POST /api/projects/:projectName/change-notices`.
- Change notices include: affected task, old date, new date, impact on project end, user note.

#### 3.2.5 Quality Integration

- Tasks linked to unapproved quality checklist items display a warning icon.
- Cross-references quality module data to surface blockers on the plan view.

---

## 4. API Endpoints

### 4.1 Task CRUD

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/planning-tasks/:projectName` | List all plan tasks for a project (merges work_items + baseline) |
| POST | `/api/planning-tasks` | Create a new plan task |
| PATCH | `/api/planning-tasks/:taskId` | Update a task (dates, status, % complete, etc.) |
| DELETE | `/api/planning-tasks/:taskId` | Soft-delete a task |

#### GET `/api/planning-tasks/:projectName`

Returns a unified list merging:
1. `work_items` where `workstream = 'PM'` and `projectId` matches.
2. `project_plan` baseline records for comparison.

Each task includes a computed `expectedPercentComplete` based on today's date relative to start/end dates.

#### PATCH `/api/planning-tasks/:taskId`

Handles two ID ranges:
- **ID > 0:** Direct update to `work_items` table.
- **ID < 0:** Baseline task — creates/updates an override in `project_plan_overrides` to preserve the original imported value.

Supported fields: `title`, `startDate`, `endDate`, `duration`, `percentComplete`, `status`, `priority`, `ownerUserId`, `wbsCode`, `indentLevel`, `parentId`, `isMilestone`, `baselineStart`, `baselineEnd`, `baselineDuration`, `taskMode`.

### 4.2 Bulk Operations

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/planning-tasks/bulk` | Execute bulk operations (delete, indent, outdent, moveUp, moveDown) |

Request body:
```json
{
  "operation": "indent",
  "taskIds": [123, 124, 125],
  "projectName": "Red Rocket"
}
```

### 4.3 Summary Rollup

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/planning-tasks/:projectName/summary-rollup` | Get computed parent task aggregates |

Returns for each parent task:
- Weighted `percentComplete` from children.
- `minStart` (earliest child start).
- `maxEnd` (latest child end).
- `totalDuration` (computed from min start to max end).

### 4.4 Plan Structure

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/project-plan/structure` | Execute structure operations (renumber WBS) |

### 4.5 CPM & Working Plan

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/:projectName/working-plan` | Get CPM-calculated working plan with ES/EF/LS/LF/Slack |

### 4.6 Schedule Change Notices

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/:projectName/change-notices` | List schedule change notices |
| POST | `/api/projects/:projectName/change-notices` | Create a schedule change notice |

### 4.7 Key Dates

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/key-dates/:projectName` | Extract key milestones by scanning task titles for known patterns |

Returns milestone objects with `plannedDate` (baseline) vs `actualDate` (effective) for high-level tracking. Detected patterns include: Site Establishment, PD Handover, Construction Start, Commissioning, Practical Completion, O&M Handover, Client Handover.

### 4.8 Plan Edit Notifications

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/plan-edit-notifications` | List pending manual plan changes for COO review |
| PATCH | `/api/plan-edit-notifications/:id/resolve` | Acknowledge/resolve a manual change notification |

Non-admin users editing plan tasks trigger notifications to the COO/CEO to ensure visibility of schedule changes.

---

## 5. Excel Import Integration (Smart Import)

### 5.1 Import Flow

1. **Upload:** `POST /api/smart-import/upload` — Accepts an Excel file (`.xlsx` / `.xlsm`), auto-detects sections (Plan, Revenue, Cost).
2. **Preview:** Returns detected data with column mappings and row previews for user confirmation.
3. **Mapping:** `PATCH /api/smart-import/:runId/mapping` — Allows manual column mapping if auto-detection fails.
4. **Commit:** `POST /api/smart-import/:runId/commit` — Persists imported data to the database.

### 5.2 Plan Task Detection

The import system detects plan tasks by matching sheet/column patterns:
- Sheet names containing "plan", "programme", "schedule", "gantt", "tracker".
- Column headers: "Task Name", "Activity", "WBS", "Duration", "Start", "Finish", "% Complete".
- Hierarchical structure detection via outline levels or indent patterns.
- Milestone detection via zero-duration tasks or specific keywords.

### 5.3 Import Protection (Override Preservation)

Before applying plan task updates from a new import:
1. System checks `project_plan_overrides` for any manual changes.
2. Manual override values are **preserved** — they are not overwritten by the import data.
3. Preserved overrides are logged in the commit summary so users know which fields were kept.

### 5.4 Data Flow on Commit

```
Excel File -> Smart Import Parser
  |-> Plan Tasks     -> work_items (workstream='PM', source='SMART_IMPORT')
  |-> Revenue Lines  -> normalized_revenue_lines
  |-> Cost Lines     -> normalized_cost_lines
```

Existing records for the project are cleared and replaced on each import (except for overridden fields and UI-created tasks).

---

## 6. Baseline Tracking

### 6.1 Concept

The system maintains a distinction between:
- **Baseline:** The original imported schedule from the Excel tracker.
- **Working Plan:** The current live schedule including manual edits.

### 6.2 Baseline Storage

- `baselineStart`, `baselineEnd`, `baselineDuration` columns on `work_items` store the original imported values.
- The `project_plan` table (legacy) retains the raw imported data for reference.
- `project_plan_overrides` tracks individual field-level changes.

### 6.3 Reset to Baseline

Users can reset a task or the entire plan back to baseline values, discarding manual overrides.

### 6.4 Baseline Comparison

The frontend can display both baseline and working dates side-by-side:
- Slippage indicators show when the working date exceeds the baseline.
- Portfolio Gantt chart shows baseline bars alongside actual progress bars.

---

## 7. Financial Integration

### 7.1 Plan-to-Finance Linking

Plan tasks can be linked to:
- **Revenue line items** (from `normalized_revenue_lines`).
- **Expenditure line items** (from `normalized_cost_lines`).

### 7.2 Financial Impact Notifications

When a plan task linked to a financial item is edited (especially date changes), the system:
1. Identifies the linked financial items.
2. Generates a notification to COO/CEO/Finance Manager.
3. The notification includes: task name, old dates, new dates, linked financial item, and estimated cashflow impact.

### 7.3 Excel Sync Notifications

Since Excel trackers are often the "source of truth" for financial data:
- Any web-based plan edit generates a notification reminding the PM to update the corresponding Excel file.
- Notifications are deduplicated to avoid spam.

---

## 8. Working Days & Holiday Calendar

### 8.1 Working Day Calculation

Duration fields use **working days** that exclude:
- **Weekends:** Saturday and Sunday.
- **South African Public Holidays:** Dynamically calculated per year.

### 8.2 SA Public Holidays

The system includes the following annual holidays:
- New Year's Day (1 Jan)
- Human Rights Day (21 Mar)
- Good Friday (calculated)
- Family Day (calculated — Monday after Easter)
- Freedom Day (27 Apr)
- Workers' Day (1 May)
- Youth Day (16 Jun)
- National Women's Day (9 Aug)
- Heritage Day (24 Sep)
- Day of Reconciliation (16 Dec)
- Christmas Day (25 Dec)
- Day of Goodwill (26 Dec)

When a holiday falls on a Sunday, the following Monday is observed.

---

## 9. Audit & Notifications

### 9.1 Audit Logging

All plan task operations are logged via the centralised audit system:
- Create, update, delete, bulk operations, structure changes.
- Logged fields: entity type (`planning_task`), entity ID, action, user, timestamp, before/after values.
- API: `POST /api/audit` (internal), `GET /api/audit?entity=planning_task` (retrieval).

### 9.2 Plan Edit Notifications

- Non-admin users editing plan tasks trigger deduped notifications to COO/admin.
- Notifications include: project name, task name, field changed, old value, new value, editor name.
- Admins can acknowledge/resolve notifications via `/api/plan-edit-notifications/:id/resolve`.

---

## 10. Permission & Access Control

### 10.1 Role-Based Access

| Permission | Roles |
|---|---|
| View project plan | All authenticated users with project access |
| Edit plan tasks | PM, COO, CEO, Program Manager |
| Bulk operations | PM, COO, CEO, Program Manager |
| Delete tasks | PM, COO, CEO |
| Reset to baseline | COO, CEO |
| Resolve plan notifications | COO, CEO (admin roles) |

### 10.2 Edit Tracking

- Non-admin edits trigger plan change notifications.
- All edits generate audit log entries.
- Override history preserved for imported tasks.

---

## 11. Key Dates Panel

### 11.1 Automatic Milestone Detection

**File:** `client/src/components/KeyDatesPanel.tsx`  
**API:** `GET /api/key-dates/:projectName`

The system automatically identifies key project milestones by scanning task titles for known patterns:

| Milestone | Title Patterns |
|---|---|
| PD Handover | "pd handover", "handover to pm" |
| Construction Start | "construction start", "site establishment" |
| Commissioning | "commissioning", "testing" |
| Practical Completion | "practical completion", "pc" |
| O&M Handover | "o&m handover", "operations handover" |
| Client Handover | "client handover", "handover to client" |

Each milestone shows:
- **Planned Date:** From baseline data.
- **Actual/Effective Date:** From the working plan.
- **Status:** On Track / Behind / Complete.

---

## 12. Purchase Order Generator

### 12.1 Overview

Dialog-based Purchase Order (PO) generator accessible from the project detail page header. Creates professional PDFs matching the Emergent Energy corporate template.

### 12.2 PO Reference Format

```
PO{sequence}-{PROJECT_CODE}-{YYYYMMDD}-{SupplierName}
```

Example: `PO3800-REDR-20260303-Menlo`

- Sequence: Auto-incrementing from `po_number_seq` (starts at 3800).
- Project Code: First letters of project name words (max 4 chars, uppercase).
- Date: Generation date in YYYYMMDD format.
- Supplier: First 10 alpha characters of supplier name.

### 12.3 PO Form Fields

| Field | Required | Description |
|---|---|---|
| Supplier Name | Yes | Name of the supplier |
| Supplier VAT | No | Supplier VAT number |
| Supplier Address | No | Full supplier address |
| Supplier Contact | No | Contact person name and phone |
| Line Items | Yes (min 1) | Description, Part Number, Qty, Unit, Price per Unit |
| Payment Terms | No | Default: "All invoicing to accounts@emergy.co.za" |
| Delivery Date | No | Expected delivery date |
| Delivery Address | No | Delivery location |
| Site Contact | No | On-site contact person and phone |
| Comments | No | Additional notes for the supplier |

### 12.4 Financial Calculation

- **Sub-Total:** Sum of (Qty x Price per Unit) for all line items.
- **VAT:** 15% of Sub-Total.
- **Total:** Sub-Total + VAT.

### 12.5 PDF Output

Generated using `pdfkit` with Emergent Energy branding:
- Company header: name, telephone, email, physical addresses (CPT + JHB), postal address, VAT number.
- Supplier details and PO reference.
- Line items table with item numbers, descriptions, part numbers, quantities, unit prices, subtotals.
- Financial summary (Sub-Total, VAT, Total).
- Payment terms, delivery instructions, comments sections.
- Project manager name and date.

### 12.6 PO Status Lifecycle

```
draft -> sent -> approved
  |                |
  v                v
cancelled      cancelled
```

- **Draft:** Initial state on generation. Can be edited or deleted.
- **Sent:** Marked when PO is dispatched to supplier. Records `sent_at` timestamp.
- **Approved:** Final accepted state.
- **Cancelled:** Terminated at any stage.

### 12.7 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/po/:projectName` | List all POs for a project |
| POST | `/api/po/generate` | Create PO, generate PDF, return PDF as base64 |
| GET | `/api/po/:projectName/:poId/pdf` | Download PO PDF |
| PATCH | `/api/po/:poId/status` | Update PO status |
| DELETE | `/api/po/:poId` | Delete a draft PO |

### 12.8 Database Table: `purchase_orders`

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Primary key |
| `po_ref` | text UNIQUE | Generated PO reference |
| `po_number` | integer | Sequence number |
| `project_name` | text | Project name |
| `project_id` | integer FK | References `project_info.id` |
| `supplier_name` | text | Supplier name |
| `supplier_vat` | text | Supplier VAT number |
| `supplier_address` | text | Supplier address |
| `supplier_contact` | text | Supplier contact details |
| `line_items` | jsonb | Array of line item objects |
| `subtotal` | decimal(15,2) | Sum of line item totals |
| `vat_amount` | decimal(15,2) | VAT at 15% |
| `total` | decimal(15,2) | Grand total including VAT |
| `payment_terms` | text | Payment terms text |
| `delivery_date` | text | Expected delivery date |
| `delivery_address` | text | Delivery location |
| `site_contact` | text | On-site contact details |
| `comments` | text | Additional notes |
| `project_manager` | text | PM who generated the PO |
| `status` | text | draft/sent/approved/cancelled |
| `created_by` | integer | User ID who created the PO |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |
| `sent_at` | timestamp | When PO was marked as sent |
| `pdf_data` | bytea | Stored PDF binary |

---

## 13. Quality Management Integration

### 13.1 Quality Dashboard

**File:** `client/src/pages/qm-dashboard.tsx`

Portfolio-level quality overview with:
- **KPI Strip:** Total Projects with Checklists, Items Passed, Active Warnings, Average QM Score.
- **View Toggle:** Projects view (card-based) and Items view (flat sortable table).
- **Projects View:** Cards showing project name, completion %, phase breakdown, warning count.
- **Items View:** All QC items across all projects from `GET /api/quality/all-items` with columns: Item Name, Project, Phase, Group, Status, Assignee, Evidence count. Sortable by all columns.
- **Warnings Section:** Collapsible card showing active warnings grouped by severity (High, Medium, Low).
- **Start Quality Process:** Dialog to initialise quality checklists for new projects.

### 13.2 Quality Tab (Project Detail)

**File:** `client/src/components/tabs/QualityTab.tsx`

Per-project quality checklist management within the project detail page:
- **Phase Navigation:** Horizontal tab strip with progress indicators showing completion percentage per phase.
- **Phase Summary Card:** Total items, passed, failed, in review, overall % complete.
- **Group Accordions:** Collapsible groups within each phase, showing group-level progress bars.
- **Item Cards:** Each checklist item displays status dot, name, description, assignee, date range, evidence count badge.
- **Quick Status Buttons:** Inline Pass/Fail/Review/N/A buttons for rapid status changes.
- **Expanded Details:** Evidence list, approval info, notes, linked tasks.
- **Evidence Upload:** Inline drag-and-drop area for attaching evidence files.
- **Approval Flow:** "Send for Approval" button with assignee picker. Self-approval prevention enforced.
- **Bulk Actions:** Select multiple items for bulk status change.
- **Risk Questions:** Collapsible section per phase for risk assessment.

### 13.3 Quality API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/quality/checklists` | List all quality checklists |
| GET | `/api/quality/all-items` | Flat list of all QC items across projects (filterable) |
| GET | `/api/quality/warnings` | Quality warnings (filterable by status) |
| GET | `/api/quality/project/:projectName/checklist` | Get quality checklist for a project |
| POST | `/api/quality/project/:projectName/item/:id` | Update item status |
| POST | `/api/quality/project/:projectName/item/:id/approve` | Submit item for approval |
| POST | `/api/quality/project/:projectName/item/:id/evidence/upload` | Upload evidence file |
| DELETE | `/api/quality/project/:projectName/item/:id/evidence/:evidenceId` | Delete evidence |

---

## 14. Microsoft 365 Integration

### 14.1 SSO & Token Management

- Azure AD SSO via `@azure/msal-node`.
- Each user's SSO token is used to fetch their own Microsoft 365 data.
- Token refresh via MSAL `acquireTokenSilent` with persisted token cache.
- `resolveUserToken` function enforces user-scoped access — blocks shared connector for `/me/*` endpoints.

### 14.2 SSO Unavailable Handling

When Microsoft 365 SSO is not configured for a user:
- **Outlook Email page** (`collab-email.tsx`): Shows blue info banner with shield icon explaining that Microsoft 365 integration is not available. Empty state shows informative message instead of error.
- **Teams Activity page** (`teams-chats.tsx`): Same blue info banner pattern. Sync mutation detects `ms_sso_required` response and sets `ssoUnavailable` state.
- Banner replaces previous destructive toast notifications with persistent, informative UI.

### 14.3 Data Sync

- Periodic sync every 15 minutes for calendar, email, and Teams data.
- All syncs user-scoped — each user sees their own data.
- Manual "Sync Now" button available on email and Teams pages.

---

## 15. Integration Points

| System | Integration | Description |
|---|---|---|
| Excel Tracker | Smart Import | Two-way sync of plan data via upload/import |
| Financial Module | Revenue & Cost Linking | Tasks linked to financial line items for cashflow impact |
| Quality Module | QC Item Cross-reference | Tasks linked to quality checklist items show approval status |
| PO Generator | Project Procurement | Purchase orders generated from project detail page |
| Notification System | Plan Edit Alerts | Changes trigger notifications to admins |
| Audit System | Full History | All changes logged with before/after values |
| Portfolio Gantt | Aggregation | Plan data feeds into portfolio-level Gantt chart |
| Execution Dashboard | Task Cards | Plan tasks surface on the execution dashboard |
| My Work | Task Aggregation | Plan tasks appear in the unified "My Work" task list |
| PM On-The-Go | Mobile Updates | Site managers can update % complete from mobile interface |
| Microsoft 365 | Calendar/Email/Teams | User-scoped sync of Outlook calendar, email, and Teams data |

---

## 16. COS & Financial Tracking

### 16.1 COS Realised Logic

- Font color takes precedence over `invoiceDateConfirmed` boolean.
- Red font = NOT confirmed regardless of boolean value.
- Manual date overrides do NOT auto-set `invoiceDateConfirmed=true`.
- Only explicit font color toggle (to black) confirms a date.

### 16.2 Financial Year

- Financial year runs September to August (e.g., FY25/26 = Sep 2025 – Aug 2026).
- All financial calculations and reporting align to this fiscal calendar.

### 16.3 Revenue Tracking

- KPI summary strip with key revenue metrics.
- Table with sticky headers, status badges, inline editing, override indicators.
- Full audit logging on all revenue changes.
- "Actual vs Costed" terminology used throughout.

### 16.4 Expenditure Breakdown

- KPI cards summarising expenditure metrics.
- Table with collapsible category grouping.
- Status badges, override indicators, inline editing.
- Task linking to connect expenses to plan tasks.

### 16.5 Cashflow

- Weekly cashflow grid.
- Actual inflows and outflows tracked.
- Project-level and portfolio-level views.

---

## 17. Data Quality & Assumptions

### 17.1 Known Data Constraints

- PM name spellings may be inconsistent across imported data (e.g., "Natasha Watkins Baker" vs "Natasha Watkins-Baker").
- PD field occasionally contains address data instead of person names.
- Forecast payment dates populated on approximately 5% of expenses.
- Line status populated on approximately 54% of expenses.

### 17.2 Default Assumptions

- Working days exclude weekends and SA public holidays.
- VAT rate: 15% (South African standard).
- PO sequence starts at 3800 to avoid conflicts with existing manually-created POs.
- Default payment terms: "All invoicing is to be sent to accounts@emergy.co.za".
