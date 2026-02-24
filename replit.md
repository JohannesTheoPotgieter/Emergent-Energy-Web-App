# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed to track and manage renewable energy projects. It ingests project data from Excel files to provide comprehensive views of project metrics, financial performance (cashflow, budget, cost of sales), and scheduling. The application aims to offer real-time insights into project progress and financial health for FY26, supporting decision-making and project oversight. Key capabilities include financial tracking, project and quality management, smart Excel import, and integration with subcontractor workflows. The project's ambition is to streamline renewable energy project oversight and financial planning, enhancing operational efficiency and strategic decision-making.

## User Preferences
Preferred communication style: Simple, everyday language.

### Data Import Rules
- **Project Name Derivation**: The project name is ALWAYS derived from the Excel filename — specifically all alphanumeric characters (letters, numbers, spaces) before "_Tracker" or "_tracker" in the filename. E.g., `Coega_Steels_Phase_2_Tracker.xlsx` → project name "Coega Steels Phase 2". Underscores in the filename before "_Tracker" are replaced with spaces.
- **COS Realized**: Invoice captured + invoice date font is black (confirmed/actual).
- **Cashflow Confirmed**: Invoice captured + PO captured + payment date font is black (confirmed).

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state, React Context for local state
- **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for a mobile-first responsive design.
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Core Features**:
    -   **Financial Tracking**: Expenditure breakdown, cashflow planning, COS tracking, and scenario-aware cashflow forecasting.
    -   **Project Management**: Operational task management (ClickUp-style) and project creation with template application.
    -   **Quality Management**: 4-phase checklist system, QM dashboard, post-mortem panels, and access control.
    -   **Smart Excel Import**: 5-step wizard for data ingestion, normalization, template profile learning, counterparty master data matching, anomaly detection, and invoice pattern classification.
    -   **Subcontractor Dashboard**: Aggregated view of installer/supplier accounts with KPIs and detailed spend analysis.
    -   **SharePoint Proposals Pipeline**: Intake requests from SharePoint, task generation, and workflow management.
    -   **UX Guidance System**: Reusable overlay system with action bars, inline tips, smart validation, micro-walkthroughs, and phase-aware micro-guidance prompts.
    -   **Project Awareness Bar**: Sticky bar on project detail showing phase, execution phase, RAG indicators (Schedule/Cost/Quality), next milestone, revenue/COS realised %, margin delta, and context-sensitive primary CTA.
    -   **Business Alert Engine**: Client-side alert rules (revenue milestones near due, COS exceeds revenue, overdue eng tasks, missing plan data) with collapsible panel and severity badges.
    -   **5-Tab Navigation**: Project detail regrouped from 12 tabs into 5 super-tabs (Overview, Plan, Money, Quality, History) with sub-tab navigation preserving backward-compatible URL params.
    -   **Weekly Review Wizard**: 6-step structured project review (Schedule, Budget, Risks, Quality, Actions, Summary) with snapshot metrics storage and past review history.
    -   **Utilities & Admin**: SafeMoney utilities, and a COO Execution Cockpit ("My Tool") for task management, DoD enforcement, and Read.ai meeting integration.
    -   **Redesigned Sidebar Navigation**: 6-group outcome-based layout (Cockpit, Projects, Money, Delivery, Governance, Admin) behind `UX_REDESIGN_ENABLED` feature flag, with legacy 5-group layout preserved. Groups map to role-based section permissions.
    -   **Execution Cockpit Home**: Executive Health Strip (Revenue Realised %, COS Realised %, Behind Schedule, Projects At Risk), Company Priorities as strategic cards (sorted by severity/overdue), and Immediate Attention Panel (escalations, schedule drift, margin drift).
    -   **Permission Gate System**: `<PermissionGate entity action>` component and `usePermission()` hook for role-aware UI rendering. Edit/approve/override buttons hidden for unpermitted roles.
    -   **Weekly Reviews Page**: Standalone `/weekly-reviews` page listing all projects with review status, due dates, and navigation to individual project review wizards.
    -   **Admin Roles & Permissions**: `/admin/roles` page for COO/CEO Admin to manage all role permissions — toggle section access, capabilities (canManageUsers, canManageRoles, canEditData), entity-level permissions grid (view/edit/approve/override per entity), and reassign user roles.
    -   **TR Register (Program Manager Task Register)**: Full list+board module at `/tr-register` for tracking cross-project action items. Features: list view with filters (RAG, status, department, owner, overdue, linked), board view (Active/Completed kanban with drag-drop status changes and department badges), detail drawer with inline editing, project linking with auto-PM-task creation, auto-link suggestions with scoring algorithm, seed runner with 41 initial records, and completion rule enforcement. Default list view filters to Active status only.
    -   **Smart Import Re-run Protection**: Procurement (expenditure) re-import warns when manual edits exist, requiring explicit acknowledgment before overwriting. Warning dialog shown in commit step.
    -   **Bootstrap Import**: Admin-only single-file project creation tool at `/admin/bootstrap-import`. Upload a tracker Excel file → preview detected data (plan tasks, revenue lines, cost lines, execution phases, counterparties, business rules) → commit to create project_info + all normalized data in one transaction. Font color extraction from Excel cells determines COS realised (invoice captured + black invoice date font) and cashflow confirmed (invoice + PO + black payment date font). Derived KPI tables rebuilt on demand. Feature flag `USE_NEW_DASHBOARD_ROLLUPS` enables fast dashboard reads from derived tables.

### Backend
-   **Framework**: Express.js with TypeScript
-   **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions, supporting role-based access control (10 company roles) and rate limiting.
-   **Permission Middleware**: `requirePermission(entity, action)` middleware enforcing per-entity role-based access at the API layer. Entities: projects, financials, quality, engineering, procurement, admin, governance. Actions: view, edit, approve, override.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL (primary) with Drizzle ORM.
-   **Data Integrity**: Transactional safety and reprocessing for data modifications.
-   **Calculation Engine**: Pure-function modules for financial computations, data quality checks, and various data processing tasks.
-   **Backfill System**: Automated population of computed columns on server startup.
-   **Audit Trails**: Immutable `change_sets` and `field_changes` for all data mutations, plus detailed logs for imports, SharePoint syncs, and system activities.

### Key Database Tables (Examples)
-   `users`, `projectInfo`, `programExpense`, `programInflows`, `projectPlan`
-   `cashflowPlanningOverrides`, `scenarios`, `operationalTasks`, `mytool_tasks`
-   `meeting_summaries`, `meeting_action_items`, `change_sets`, `field_changes`
-   `uploadMetadata`, `sp_settings`, `import_runs`, `qm_templates`, `qm_checklists`
-   `phase_template`, `smart_import_runs`, `template_profiles`, `counterparties`
-   `intake_requests`, `intake_tasks`, `sync_audit_log`
-   `tr_items`, `tr_item_project_links`, `tr_item_suggestion_decisions`

### API Endpoints (Examples)
-   `/api/cos-control/*`: COS KPI aggregation and scenario analysis.
-   `/api/cashflow-forecast/*`: Weekly cashflow grids and scenario overlays.
-   `/api/data-quality/scan`: Data quality rule engine.
-   `/api/operational-tasks/*`: CRUD for operational tasks.
-   `/api/mytool/*`: My Tool settings and task management.
-   `/api/quality/*`: Quality management endpoints.
-   `/api/phase-templates/*`: Phase template management.
-   `/api/smart-import/*`: Smart import lifecycle and data queries.
-   `/api/sp-sync/*`: SharePoint Proposals Pipeline management.
-   `/api/audit/*`: Comprehensive audit logs and change tracking.
-   `/api/weekly-reviews/*`: Weekly review wizard CRUD (create, update steps, complete).
-   `/api/tr-register/*`: TR Register CRUD, project linking, auto-link suggestions, seed runner.
-   `/api/roles/*`: Role permission management (CRUD, user role assignment).

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM.

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
-   **Microsoft Graph API**: For Outlook calendar integration (via Replit Connector).
-   **Read.ai**: Meeting data ingestion via webhooks.