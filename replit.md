# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application for comprehensive management of renewable energy projects. It tracks project lifecycles, provides robust financial oversight (Cost of Sales, cashflow, revenue, expenditure), and streamlines engineering operations with a 5-stage checklist and task management. The platform integrates quality management, communication features, and Microsoft 365 services via Azure AD SSO. Its primary goal is to boost efficiency, reduce operational costs, and enhance project delivery for renewable energy initiatives, aiming for end-to-end project visibility and control.

## User Preferences
Preferred communication style: Simple, everyday language.
All dropdowns across the app must be searchable (use Popover + Command combobox pattern, never plain Select for lists with a few items).

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design; Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Weekly Review Wizard, Execution Dashboard, Permission Gate System, PM Dashboard, Gamification System, and a Universal Search.
-   **Project Planning**: MS Project-style grid with WBS, duration/date editing, predecessors, resource assignment, inline % complete, RAG status, and baseline tracking. Shows all workstreams (PM, Engineering, Quality) with color-coded badges and workstream filter.
-   **Financial Tracking**: Dedicated tabs for Inflows (formerly Revenue), Revenue Tracker (COS-linked revenue: `revenue = (item_cost / total_COS) * total_milestone_revenue`), GP Tracker (Revenue - COS = GP), Expenditure Breakdown, and Cashflow (weekly cashflow with multi-select project filter).
-   **Project Management**: Card-based Execution Dashboard, Kanban-style Lifecycle Board, and a "Command Center" project detail page with financial KPIs, RAG status, and section-based navigation.
-   **Unified Work ("My Work")**: Consolidates tasks from all sources (personal, operational, plan, engineering, quality, approvals, deliverables, TR register, MS 365, notifications) into a unified board/list with filtering and task management. Shows tasks where user is assigned or a viewer (VIEWER role in work_item_assignments), with distinct "Viewing" badges.
-   **Approvals & Procurement**: Consolidated Approvals screen and a PO Generator creating PDFs with supplier auto-fill.
-   **Quality Management**: Quality Dashboard with KPIs and items view, and a Quality Tab with phase-tabbed navigation, progress indicators, evidence upload, and approval workflows.
-   **Collaboration**: Local Project Folder Tab using browser File System Access API, MS Teams-styled chat groups, and a Knowledge Base.
-   **Portfolio Management**: Enhanced Gantt Chart and aggregated Cashflow view across projects.
-   **Company Lifecycle Map**: Interactive lifecycle management with Story Mode and Explore Mode for onboarding and process understanding.
-   **Mobile Experience**: PM On-The-Go Mode for mobile-first site management.
-   **Permission Gating**: Both sidebar items and routes are permission-gated based on entity-level view permissions.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`. PostgreSQL for sessions, RBAC, and granular entity-level permissions. Password login restricted to admin roles via an access code. Only users with a linked Microsoft ID (`microsoft_id` on `users` table) are returned by assignable-user endpoints; startup backfill clears assignments for non-MS-linked users once MS accounts start getting linked.
-   **Data Handling**: Multer for uploads, `exceljs` for parsing, `pdfkit` for PDF generation.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Canonical Data Model**: All data reads/writes exclusively use `work_items` for tasks, `normalized_cost_lines` for costs, and `normalized_revenue_lines` for revenue, serving as the single source of truth. `work_items` includes `actual_start`, `actual_end`, `actual_duration` columns for actual dates from Smart Import.
-   **Core Logic**: Pure-function modules, automated backfill for computed columns, and audit trails.
-   **Task Management**: Dual-write operations for engineering tasks to `operational_tasks` and `work_items`; direct sync for plan task edits to `work_items`. Supports bulk operations and summary rollups.
-   **Engineering & Quality**: 5-stage checklist system with templating and SharePoint integration for engineering; API for all QC item instances.
-   **Financial Logic**: Consistent rules for "in bank" revenue, "Paid" expenses, "COS Realised," and GP% calculations, aligned with the September to August financial year. Revenue is calculated from COS realisation.
-   **Integrations**: MS Object Sync periodically syncs user-scoped calendar, email, and Teams data from Microsoft Graph API. Email/Message to Task functionality.
-   **Security**: Parameterized SQL queries, generic error messages, permission checks, and NaN guards.
-   **Error Handling**: Centralized `ApiError` class with typed error codes.

### Database Architecture
-   **Central Entities**: `project_info` and `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `work_items` (canonical).
-   **Derived Data**: Dashboard metrics computed live from `work_items`.

## External Dependencies

### Database & ORM
-   **PostgreSQL**
-   **Drizzle ORM**

### Authentication & Security
-   **Passport.js**
-   **bcryptjs**

### File Processing
-   **exceljs**
-   **multer**
-   **pdfkit**

### Frontend Libraries
-   **@tanstack/react-query**
-   **recharts**
-   **date-fns**
-   **zod**
-   **@radix-ui/**
-   **tailwindcss**

### Third-Party Integrations
-   **Microsoft Graph API**: For Outlook calendar, SharePoint, and Teams integration.
-   **Read.ai**: For meeting data ingestion via webhooks.

## Platform Upgrades (2026-03-06)
-   **Canonical Task Engine**: Shared `server/lib/canonical-task-engine.ts` with unified status model (todo, in_progress, blocked, review, complete, cancelled). All task APIs normalize statuses. Frontend My Work page uses canonical statuses with review column and 5-column board.
-   **Admin Recovery Center**: `/admin/recovery` — admin-only page with Task Recovery (search/edit all task types), Import Recovery (view import runs/errors), Project Recovery (edit project fields), Deleted Items (restore soft-deleted items). Server: `server/admin-recovery-routes.ts`.
-   **KPI Traceability Panel**: `/admin/kpi-traceability` — admin-only page showing all KPIs with source tables, fields, formulas, API endpoints, and consuming components. Server: `server/kpi-traceability-routes.ts`.
-   **Smart Import Control Tower**: `/admin/import-control-tower` — admin-only page showing import history, record counts, row-level errors, retry capability. Enhanced `server/smart-import-routes.ts` with record tracking columns and admin-only endpoints.
-   **Role-Based Command Centers**: `/command-center` — role-aware landing page with attention items, task breakdown, project RAG status, and role-specific KPIs. 8 role categories with tailored views.
-   **Workflow Gates & Handover Control**: 4-gate handover system (PD→Eng, Eng→PM, PM→QM, Execution→Closeout) with checklists, progress tracking, gate history. Server: `server/handover-routes.ts`. DB tables: `project_handover_gates`, `project_handover_history`.
-   **Audit & Data Governance**: Enhanced `server/audit-logger.ts` with typed helpers (logStatusChange, logReassignment, logTypeChange, logImportAction, logAdminRecovery). Task validation module `server/lib/task-validation.ts`. Admin-only enforcement on all control tower and recovery endpoints.
-   **Navigation**: All new pages registered in `App.tsx` and sidebar (`AppLayout.tsx`) with proper permission gating.

## Platform Stabilization (2026-03-06)
-   **Admin Control Center**: `/admin/control-center` — unified admin dashboard with system health, import stats, integration status, feature flags, system enums, quick links, and dangerous actions with AlertDialog confirmations. Server: `server/admin-control-routes.ts`.
-   **Transactional Logging Hardening**: 170+ audit logging calls across all route files. Role management (7 new calls for role CRUD, user CRUD, password resets). All admin recovery edits and dangerous actions audit-logged.
-   **Canonical Task Normalization**: All task write paths now normalize status via `normalizeStatus()` — operational tasks, mytool tasks, planning tasks, baseline promotion, admin recovery PATCH. Recurring task creation uses canonical "todo". Fixed legacy "done"/"planned"/"Not Started" values on write paths.
-   **Admin Recovery Hardening**: AlertDialog confirmation dialogs on task edits and deleted item restores. Status normalization on recovery PATCH handler. 11 correction scenarios covered.
-   **Shared Platform Cleanup**: ApiError class standardized across routes. Task validation on creation endpoints. EnergyLoader on 6+ pages. SearchableSelect on revenue-tracker dropdown. Global error handler middleware.
-   **Stabilization Defects**: 7 found, 7 fixed (STAB-001 through STAB-007). See `FINAL_DEFECT_REGISTER.md`.
-   **Total (All Sessions)**: 153 test cases. 20 total defects — all 20 fixed, 0 open.
-   **Deliverables**: `PLATFORM_STABILIZATION_PLAN.md`, `ROLE_PERMISSION_MATRIX.md`, `ADMIN_CONTROL_CENTRE.md`, `TRANSACTION_LOGGING_SPEC.md`, `FINAL_QA_MATRIX.md`, `FINAL_DEFECT_REGISTER.md`, `FINAL_RELEASE_READINESS.md`, `FUTURE_PM_FOUNDATION_MAP.md`.

## System Audit (2026-03-06)
-   **Pass 1**: Full system audit. 73 tests, 5 defects found and fixed (DEF-001–DEF-005). See `SYSTEM_AUDIT.md`.
-   **Pass 2**: Trust-hardening gap closure. 30 additional tests, 8 new defects identified and fixed (DEF-006–DEF-013, all MEDIUM/LOW). See `GAP_CLOSE_REPORT.md`.
-   **Total**: 103 test cases across 13 categories. 13 total defects — all 13 fixed, 0 open.
-   **Assessment**: READY — all identified defects resolved. Viewer management UI added, soft-delete with restore, Smart Import error handling hardened, status normalization at API level, admin My Work visibility, contract values in projects-summary.
-   **Deliverables**: `SYSTEM_AUDIT.md`, `QA_TEST_MATRIX.md`, `DEFECT_REGISTER.md`, `RELEASE_READINESS.md`, `GAP_CLOSE_REPORT.md`, `ROLE_WORKFLOW_UAT.md`, `KPI_TRACEABILITY_MATRIX.md`, `ADMIN_RECOVERY_MATRIX.md`, `FRONTEND_CONSISTENCY_AUDIT.md`, `SMART_IMPORT_SCENARIO_TESTS.md`.