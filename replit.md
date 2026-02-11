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
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Core Features**:
    -   **Expenditure Breakdown**: Dual-table parsing of budget/costed vs. actual/finance data from Excel, with auto-computed line statuses (Planned, Committed, Invoiced, Paid) and strict COS recognition rules (Invoice Number AND Invoice Raised Date required). Includes UI/UX enhancements like sticky headers, collapsible groups, and column visibility toggles.
    -   **Cashflow Planning**: Editable planning grid for revenue and expenditure, with real-time chart updates, override persistence, and multi-project support.
    -   **Home Page (Projects Report)**: Comprehensive FY overview including Portfolio Summary (active projects, capacity, schedule adherence), Execution Summary (construction progress, milestones), Financial Summary (revenue, expenses, net cashflow, COS realized), Data Quality Panel, and editable project notes.
    -   **COS Tracker Page**: Detailed Cost of Sales tracking with KPIs (COS Realised, Cash Paid, Outstanding COS), supplier extraction, and a monthly COS matrix.
    -   **COS Control Tower**: Line-item state machine (Planned/Committed/Invoiced/Paid) with KPI cards, per-project breakdown, filterable line-item explorer, invoice rollup, PO rollup, and data quality scanner.
    -   **Cashflow Forecast**: Weekly line-item-driven forecast with actual/forecast split, weekly chart, weekly grid with drilldown to individual line items showing confidence scoring and assumption drivers.
    -   **Planning Board**: Filterable project overview with PM/phase/risk filters, sortable columns, budget variance, revenue realization %, and automated risk flags (over budget, missing dates, no PM, no revenue received).
    -   **Project Plan View**: CPM scheduling tool with Gantt visualization, critical path calculation, task grid with inline editing, task detail panel, and dependency management. Features include hover sync between grid/Gantt and schedule governance warnings for critical path changes.
    -   **SafeMoney Utilities**: Frontend utilities for NaN-safe currency handling and formatting.

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
-   `uploadMetadata`, `refreshLogs`: Audit trails for data ingestion.

### New API Endpoints
-   `/api/cos-control/summary`: COS KPI aggregation (Planned/Committed/Invoiced/Paid/Outstanding + forecast horizons).
-   `/api/cos-control/by-project`: Per-project COS breakdown.
-   `/api/cos-control/lines`: Filterable line-item explorer with state, confidence, and forecast data.
-   `/api/cos-control/invoices`: Invoice-level rollup view.
-   `/api/cos-control/pos`: Purchase order-level rollup view.
-   `/api/cashflow-forecast/weekly`: Weekly cashflow grid with actual/forecast split.
-   `/api/cashflow-forecast/week-detail`: Per-week line-item drilldown.
-   `/api/data-quality/scan`: Data quality rule engine with issue counts and affected items.
-   `/api/planning-board/projects`: Project overview with risk flags and financial summary.
-   `/api/admin/backfill`: Manual trigger for computed field backfill.

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