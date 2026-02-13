# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed to track and manage renewable energy projects. It ingests project data from Excel tracker files to provide comprehensive views of project metrics, financial performance (cashflow, budget, cost of sales), and scheduling. The application aims to offer real-time insights into project progress and financial health for FY26, supporting decision-making and project oversight.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state, React Context for local state
- **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4
- **Mobile Responsive**: Full mobile-first responsive design with overlay sidebar drawer, responsive grids/padding/typography, horizontal-scroll tables, and touch-friendly tap targets
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Core Features**:
    -   **Expenditure Breakdown**: Dual-table parsing of budget/costed vs. actual/finance data from Excel, with auto-computed line statuses (Planned, Committed, Invoiced, Paid) and strict COS recognition rules (Invoice Number AND Invoice Raised Date required). Includes UI/UX enhancements like sticky headers, collapsible groups, and column visibility toggles.
    -   **Cashflow Planning**: Editable planning grid for revenue and expenditure, with real-time chart updates, override persistence, and multi-project support.
    -   **Home Page**: Navigation hub with quick-link tiles to all major sections.
    -   **Dashboard**: High Priority panel with severity-classified alerts (overdue expenses, outstanding revenue, behind-plan projects, upcoming milestones), clickable drilldown items.
    -   **COS Tracker Page**: Monthly COS matrix with KPIs, reconciliation mode toggle, clickable month cells opening slide-out drawer with contributing line items (searchable/filterable by state, project, invoice #, PO #).
    -   **COS Control Tower**: Scenario-aware what-if COS shifting tool with By Month stacked chart (baseline overlay), Invoices view with editable dates and quick-shift buttons (+7d/+14d/+30d), Line Items view with expandable details, and impact panel showing COS month shifts. Supports create/duplicate/reset/delete scenarios.
    -   **Cashflow Page**: Chart-first layout (trend chart above grid), weekly cashflow timeline with project filter, OPEX budget modal, expandable week detail with inline search across inflows/outflows and reconciliation totals.
    -   **Cashflow Forecast**: Scenario-aware weekly forecast with baseline vs scenario balance overlay on chart, delta columns (Δ Inflows/Outflows/Balance) in grid, editable line-item dates in week detail panel with override indicators, and reconciliation summary.
    -   **Planning Board**: Scenario-aware with Gantt-lite timeline (visual project bars), Key Dates tab (editable construction start, commissioning, O&M handover, client handover with override tracking), and Capacity tab with demand heatmap and clash detection for PM/Installer resources.
    -   **Scenario System**: Reusable ScenarioSelector component (create/select/duplicate/reset/delete), unified `scenarios` + `dateOverrides` tables, effective date resolver merging overrides with imported baseline data at calculation layer. All three main pages (COS Control, Forecast, Planning) support scenario mode.
    -   **Risks & Flags**: Severity-ranked data quality issues table with searchable flags, project links, and actionable detail.
    -   **Project Plan View**: CPM scheduling tool with Gantt visualization, critical path calculation, task grid with inline editing, task detail panel, and dependency management. Features include hover sync between grid/Gantt and schedule governance warnings for critical path changes.
    -   **Operational Task Management**: ClickUp-style task system with four views per project: Tasks (spreadsheet grid with inline editing, filtering, sorting, grouping, bulk actions), Board (Kanban drag-drop), Calendar (monthly grid), and detail drawer with comments, checklists, attachments, and activity log. Source badges distinguish BASELINE (imported) vs OPERATIONAL (app-created) tasks.
    -   **Excel Writeback Manager**: Admin UI for configuring cell mappings, previewing changes, executing writebacks to Excel files, and rolling back individual changes via audit log.
    -   **SafeMoney Utilities**: Frontend utilities for NaN-safe currency handling and formatting.
    -   **My Tool (COO Execution Cockpit)**: Admin-only personal execution tool with Today page (company priorities, quick-add tasks, top 5 outcomes, time blocks, task lanes by status, end-of-day wrap), Week planner (7-day view with per-day tasks/blocks), Backlog (filterable/sortable all-tasks view with bulk actions), and Settings (user preferences + admin feature settings + company priorities CRUD). Task state machine: inbox → planned → in_progress → blocked → waiting → done → cancelled. No dead-ends rule: every warning has an action path.

### Backend
- **Framework**: Express.js with TypeScript
- **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions
- **File Upload**: Multer for handling Excel files
- **Excel Parsing**: `xlsx` library with custom parsing logic to ingest project, expense, revenue, plan, and cashflow data from defined Excel sheet structures.
- **Data Storage**: PostgreSQL as primary, with resilient fallback to SQLite (`./data/app.sqlite`) if PostgreSQL is unavailable. Drizzle ORM is used for database interactions.
- **Transactional Safety**: All file uploads and data modifications are wrapped in database transactions to ensure data integrity.
- **Reprocessing**: Supports re-parsing previously uploaded Excel files without re-uploading.

### Calculation Engine (server/lib/calculations/)
Pure-function modules for financial computations:
-   **stateClassifier.ts**: Expense state machine (Planned → Committed → Invoiced → Paid) based on PO/invoice/payment fields.
-   **forecaster.ts**: Payment date forecasting using configurable terms (default 30 days from invoice date).
-   **confidence.ts**: Confidence scoring (High/Medium/Low) and assumption driver labeling for each line item.
-   **cashflow.ts**: Weekly cashflow computation with actual/forecast separation and line-item drilldown.
-   **cosAggregator.ts**: COS aggregation by state and project, with 4w/8w/12w forecast horizons.
-   **dataQuality.ts**: 11-rule scanner for data integrity (missing fields, date inconsistencies, duplicates).
-   **hashing.ts**: SHA-256 stable line-item IDs for expense/inflow rows.
-   **supplierExtractor.ts**: Supplier name extraction from invoice number patterns.

### Backfill System (server/lib/backfill.ts)
Auto-runs on server startup to populate computed columns (hash, state, forecast date, supplier) on all expense/inflow rows.

### Key Database Tables
-   `users`: User authentication and role-based access.
-   `projectInfo`: Core project metadata.
-   `programExpense`, `programInflows`: Detailed expenditure and revenue entries with computed columns (expense_line_hash, computed_state, computed_forecast_payment_date, supplier_name for expenses; inflow_line_hash, computed_forecast_receipt_date for inflows).
-   `projectPlan`: Project task and milestone data.
-   `cashflowPlanningOverrides`: Stores user-defined cashflow adjustments.
-   `planningOverrides`, `paymentTerms`, `lineItemOverrides`, `resourceCapacity`: New tables for planning board overrides, configurable payment terms, per-line overrides, and resource capacity management.
-   `scenarios`, `dateOverrides`: Scenario/what-if system tables for creating named scenarios with date overrides on expense lines, inflow lines, and project key dates.
-   `operationalTasks`: ClickUp-style task tracking with status, priority, assignees, tags, dates, percent complete, and source (baseline/operational).
-   `taskComments`, `taskChecklists`, `taskChecklistItems`, `taskAttachments`: Task detail entities for comments, checklists, and file attachments.
-   `taskActivityLog`: Automatic activity logging for all task changes.
-   `writebackMappings`: Cell mapping configurations for Excel writeback (workbook path, sheet, cell, source field, transforms, validation).
-   `writebackAuditLog`: Audit trail for writeback operations with rollback support.
-   `mytool_tasks`: Personal COO task tracking with state machine (inbox/planned/in_progress/blocked/waiting/done/cancelled), priority, planned date, project links, blocked reasons.
-   `mytool_timeblocks`: Daily time blocks with start/end times, labels, and optional linked tasks.
-   `mytool_daily_reviews`: End-of-day reflections (what went well, moved forward, blocked, notes) per user per date.
-   `mytool_company_priorities`: Admin-managed company priorities with severity, horizon, linked projects, and status.
-   `mytool_user_preferences`: Per-user My Tool preferences (default view, workday times, company priorities visibility).
-   `mytool_settings`: Global My Tool feature settings (enabled flag, allowed roles, default priority horizon).
-   `uploadMetadata`, `refreshLogs`: Audit trails for data ingestion.

### New API Endpoints
-   `/api/cos-control/summary`: COS KPI aggregation (Planned/Committed/Invoiced/Paid/Outstanding + forecast horizons).
-   `/api/cos-control/by-project`: Per-project COS breakdown.
-   `/api/cos-control/lines`: Filterable line-item explorer with state, confidence, and forecast data.
-   `/api/cos-control/invoices`: Invoice-level rollup view.
-   `/api/cos-control/pos`: Purchase order-level rollup view.
-   `/api/cos-control/scenario-monthly`: COS KPI aggregation (Planned/Committed/Invoiced/Paid/Outstanding + forecast horizons).
-   `/api/cos-control/scenario-invoices`: Invoice-level rollup view.
-   `/api/cos-control/scenario-lines`: Filterable line-item explorer with state, confidence, and forecast data.
-   `/api/cos-control/scenario-impact`: COS shift impact analysis for a scenario.
-   `/api/cashflow-forecast/weekly`: Weekly cashflow grid with actual/forecast split.
-   `/api/cashflow-forecast/week-detail`: Per-week line-item drilldown.
-   `/api/cashflow-forecast/scenario-weekly`: Weekly cashflow grid with scenario overlay and delta columns.
-   `/api/cashflow-forecast/scenario-week-detail`: Per-week line-item drilldown with override indicators.
-   `/api/data-quality/scan`: Data quality rule engine with issue counts and affected items.
-   `/api/planning-board/projects`: Project overview with risk flags and financial summary.
-   `/api/planning-board/pm-capacity`: PM capacity heatmap with weekly project allocation counts.
-   `/api/planning-board/scenario-projects`: Project overview with scenario-applied key dates.
-   `/api/planning-board/scenario-capacity`: Resource capacity heatmap with clash detection.
-   `/api/dashboard/high-priority`: Severity-classified alerts (overdue expenses, outstanding revenue, behind-plan, milestones).
-   `/api/cos-tracker/month-detail`: Line-item drilldown for COS tracker month cells.
-   `/api/admin/backfill`: Manual trigger for computed field backfill.
-   `/api/operational-tasks/:projectName`: CRUD for operational tasks (GET list, POST create).
-   `/api/operational-tasks/:id`: PATCH update, DELETE individual tasks.
-   `/api/operational-tasks/bulk-update`: POST batch update for multiple tasks.
-   `/api/task-comments/:taskId`: GET/POST comments for a task.
-   `/api/task-checklists/:taskId`: GET/POST checklists, with nested checklist items.
-   `/api/task-activity/:taskId`: GET activity log for a task.
-   `/api/writeback-mappings`: CRUD for writeback cell mapping configurations.
-   `/api/writeback-audit`: GET audit log for writeback operations.
-   `/api/writeback/preview`: POST preview changes before executing writeback.
-   `/api/writeback/execute`: POST execute writeback to Excel file.
-   `/api/writeback/rollback/:auditId`: POST rollback individual writeback change.
-   `/api/mytool/settings`: GET/PUT global My Tool settings (admin-only).
-   `/api/mytool/tasks`: GET all tasks or by date, POST create task (admin-only).
-   `/api/mytool/tasks/:id`: PATCH update, DELETE task (admin-only).
-   `/api/mytool/timeblocks`: GET by date, POST create (admin-only).
-   `/api/mytool/timeblocks/:id`: PATCH update, DELETE (admin-only).
-   `/api/mytool/daily-review`: GET/PUT daily review by date (admin-only).
-   `/api/mytool/company-priorities`: GET/POST company priorities (admin-only).
-   `/api/mytool/company-priorities/:id`: PATCH/DELETE (admin-only).
-   `/api/mytool/preferences`: GET/PUT user preferences (admin-only).

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM for database interactions.
-   **connect-pg-simple**: PostgreSQL session store.

### Authentication & Security
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing.

### File Processing
-   **xlsx**: Excel file parsing library.
-   **multer**: Middleware for handling `multipart/form-data`.

### Frontend Libraries
-   **@tanstack/react-query**: Data fetching, caching, and state management.
-   **recharts**: Declarative charting library.
-   **date-fns**: Date utility library.
-   **zod**: Schema declaration and validation (shared).

### UI Libraries
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.