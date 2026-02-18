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
    -   **Quality Management**: Quality Tab (4-phase checklist with Planning & Design, Construction, Commissioning, Handover phases; 13 groups, 46 items, 22 risk questions; non-blocking red warnings engine), QM Dashboard (stats overview, project table, warnings), Post-Mortem Panel (contractor/engineering quality scoring with 7 metrics), QM Access Code Challenge (4-digit code gate for quality_manager role editing).
    -   **Utilities & Admin**: SafeMoney Utilities (NaN-safe currency handling), My Tool (COO Execution Cockpit — Linear/Notion/Sunsama-style premium minimal interface with shared components: MyToolLayout, TaskCard, TaskDetailDrawer; DoD enforcement; natural language quick add; keyboard shortcuts ⌘K/⌘⏎; drag-drop email-to-task; time blocks; daily wrap), and Excel Writeback Manager (admin UI for configuring and executing Excel writebacks).

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
-   `operationalTasks`, `taskComments`, `taskChecklists`, `taskAttachments`, `taskActivityLog`: Operational task management entities (includes ClickUp migration fields: external_source, external_task_id, assignees, tracking_rag, task_type_tag).
-   `writebackMappings`, `writebackAuditLog`: Excel writeback configuration and audit trail.
-   `mytool_tasks`, `mytool_timeblocks`, `mytool_daily_reviews`, `mytool_company_priorities`, `mytool_user_preferences`: My Tool entities.
-   `mytool_dod_templates`: Definition of Done reusable templates.
-   `uploadMetadata`, `refreshLogs`: Audit trails for data ingestion.
-   `sp_settings`: SharePoint connection configuration (siteId, driveId, folder, schedule).
-   `sp_files`: Tracked SharePoint files with etag/ctag for change detection.
-   `import_runs`: Import execution history with status and summaries.
-   `change_ledger`: File change detection log with import status tracking.
-   `snapshots`: Immutable file snapshots with content hash and row counts.
-   `snapshot_metrics`: Per-sheet metrics (row count, checksum, date ranges, totals).
-   `qm_templates`, `qm_template_phases`, `qm_template_groups`, `qm_template_items`: Quality checklist template hierarchy.
-   `qm_template_risk_questions`: Risk questions per template phase.
-   `qm_checklists`, `qm_checklist_items`, `qm_risk_answers`: Per-project checklist instances and risk answers.
-   `qm_warnings`, `qm_warning_overrides`: Non-blocking warning engine with override tracking.
-   `qm_postmortems`, `qm_postmortem_metrics`, `qm_postmortem_metric_values`: Post-mortem scoring system.
-   `qm_access_challenges`: Access code challenge audit trail with rate limiting.
-   `qm_holidays`: ZA public holidays for scheduling calculations.

### New API Endpoints (Examples)
-   `/api/cos-control/*`: Endpoints for COS KPI aggregation, breakdowns, line-item explorers, and scenario-based analysis.
-   `/api/cashflow-forecast/*`: Endpoints for weekly cashflow grids and line-item drilldowns, including scenario overlays.
-   `/api/data-quality/scan`: Data quality rule engine.
-   `/api/planning-board/*`: Endpoints for project overviews, PM capacity, and scenario-applied planning.
-   `/api/dashboard/high-priority`: Severity-classified alerts.
-   `/api/operational-tasks/*`: CRUD operations for operational tasks, comments, checklists, and activity logs.
-   `/api/eng/tasks/*`: Engineering task board CRUD with Kanban support — single task detail, comments, activity log, subtasks endpoints.
-   `/api/writeback/*`: Endpoints for managing writeback mappings, previewing, executing, and rolling back writebacks.
-   `/api/mytool/*`: Endpoints for My Tool settings, tasks, time blocks, daily reviews, company priorities, and user preferences.
-   `/api/quality/*`: Quality management endpoints — templates, checklists (CRUD + instantiation), risk answers, warnings engine, post-mortem scoring, access code challenge with rate limiting.
-   `/api/admin/reports/*`: Admin-only reporting endpoints — Operational Overview KPI JSON, PDF/print HTML, project RAG status management.

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
