# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed to track and manage renewable energy projects. It ingests project data from Excel tracker files to provide comprehensive views of project metrics, financial performance (cashflow, budget, cost of sales), and scheduling. The application aims to offer real-time insights into project progress and financial health for FY26, supporting decision-making and project oversight.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state, React Context for local state
- **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for a mobile-first responsive design.
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Core Features**:
    -   **Financial Tracking**: Expenditure Breakdown (parsing budget/costed vs. actual/finance from Excel), Cashflow Planning (editable grid with real-time updates), COS Tracker Page (monthly matrix with KPIs), COS Control Tower (scenario-aware what-if shifting tool), Cashflow Page (chart-first layout, weekly timeline, OPEX budget modal), and Cashflow Forecast (scenario-aware weekly forecast with baseline vs scenario balance overlay).
    -   **Project Management**: Planning Board (scenario-aware Gantt-lite timeline, key dates, resource capacity heatmap), Project Plan View (CPM scheduling with Gantt visualization, critical path calculation), and Operational Task Management (ClickUp-style task system with multiple views and detail drawers).
    -   **Data Quality & Scenarios**: Risks & Flags (severity-ranked data quality issues), Scenario System (reusable component for creating/managing scenarios across financial and planning modules).
    -   **Utilities & Admin**: SafeMoney Utilities (NaN-safe currency handling), My Tool (COO Execution Cockpit for personal task management and planning with Outlook integration), and Excel Writeback Manager (admin UI for configuring and executing Excel writebacks).

### Backend
- **Framework**: Express.js with TypeScript
- **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions
- **File Handling**: Multer for Excel file uploads, `exceljs` for parsing.
- **Data Storage**: PostgreSQL (primary) with SQLite fallback, using Drizzle ORM.
- **Data Integrity**: Transactional safety for all data modifications and reprocessing of uploaded files.
- **Calculation Engine**: Pure-function modules for financial computations (expense state classification, payment forecasting, confidence scoring, cashflow computation, COS aggregation, data quality checks, hashing, supplier extraction).
- **Backfill System**: Auto-runs on server startup to populate computed columns.

### Key Database Tables (Examples)
-   `users`: User authentication.
-   `projectInfo`: Core project metadata.
-   `programExpense`, `programInflows`: Detailed financial entries with computed columns.
-   `projectPlan`: Project task and milestone data.
-   `cashflowPlanningOverrides`, `planningOverrides`, `lineItemOverrides`: Stores user-defined adjustments.
-   `scenarios`, `dateOverrides`: Scenario/what-if system tables.
-   `operationalTasks`, `taskComments`, `taskChecklists`, `taskAttachments`, `taskActivityLog`: Operational task management entities.
-   `writebackMappings`, `writebackAuditLog`: Excel writeback configuration and audit trail.
-   `mytool_tasks`, `mytool_timeblocks`, `mytool_daily_reviews`, `mytool_company_priorities`, `mytool_user_preferences`: My Tool entities.
-   `uploadMetadata`, `refreshLogs`: Audit trails for data ingestion.

### New API Endpoints (Examples)
-   `/api/cos-control/*`: Endpoints for COS KPI aggregation, breakdowns, line-item explorers, and scenario-based analysis.
-   `/api/cashflow-forecast/*`: Endpoints for weekly cashflow grids and line-item drilldowns, including scenario overlays.
-   `/api/data-quality/scan`: Data quality rule engine.
-   `/api/planning-board/*`: Endpoints for project overviews, PM capacity, and scenario-applied planning.
-   `/api/dashboard/high-priority`: Severity-classified alerts.
-   `/api/operational-tasks/*`: CRUD operations for operational tasks, comments, checklists, and activity logs.
-   `/api/writeback/*`: Endpoints for managing writeback mappings, previewing, executing, and rolling back writebacks.
-   `/api/mytool/*`: Endpoints for My Tool settings, tasks, time blocks, daily reviews, company priorities, and user preferences.

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM.
-   **connect-pg-simple**: PostgreSQL session store.

### Authentication & Security
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing.

### File Processing
-   **exceljs**: Excel file parsing and writing.
-   **multer**: Handling `multipart/form-data`.

### Frontend Libraries
-   **@tanstack/react-query**: Data fetching and state management.
-   **recharts**: Declarative charting.
-   **date-fns**: Date utility library.
-   **zod**: Schema validation.

### UI Libraries
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.

### Third-Party Integrations
-   **Microsoft Graph API**: For Outlook calendar integration in My Tool, using Replit Connector for OAuth/token management (no custom MSAL or encrypted token storage).