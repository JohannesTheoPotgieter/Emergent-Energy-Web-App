# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for comprehensive management of renewable energy projects. It offers end-to-end visibility and control by tracking project lifecycles, providing robust financial oversight (Cost of Sales, cashflow, revenue, expenditure), and streamlining engineering operations through a 5-stage checklist and task management system. The platform integrates quality management, communication features, and Microsoft 365 services via Azure AD SSO. Its core purpose is to enhance efficiency, reduce operational costs, and improve project delivery within the renewable energy sector.

## User Preferences
Preferred communication style: Simple, everyday language.
All dropdowns across the app must be searchable (use Popover + Command combobox pattern, never plain Select for lists with a few items).

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design; Recharts for data visualization. All dropdowns are searchable using Popover + Command combobox.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Weekly Review Wizard, Execution Dashboard, Permission Gate System, PM Dashboard, Gamification System, Universal Search, RAID Log, Change Control, Procurement Pipeline, Commissioning & Closeout, and Task Dependencies.
-   **Project Planning**: MS Project-style grid with WBS, duration/date editing, predecessors, resource assignment, inline % complete, RAG status, and baseline tracking.
-   **Financial Tracking**: Dedicated tabs for Inflows, Revenue Tracker (COS-linked), GP Tracker, Expenditure Breakdown, and Cashflow.
-   **Project Management**: Card-based Execution Dashboard, Kanban-style Lifecycle Board, and a "Command Center" project detail page.
-   **Unified Work ("My Work")**: Consolidates tasks from various sources into a unified board/list with filtering and task management, supporting canonical statuses (todo, in_progress, blocked, review, complete, cancelled).
-   **Approvals & Procurement**: Consolidated Approvals screen, PO Generator, and general-purpose approval framework with entity linking.
-   **Quality Management**: Quality Dashboard with KPIs and a Quality Tab with phase-tabbed navigation and approval workflows.
-   **Collaboration**: Local Project Folder Tab, MS Teams-styled chat groups, and a Knowledge Base.
-   **Portfolio Management**: Enhanced Gantt Chart and aggregated Cashflow view across projects.
-   **Company Lifecycle Map**: Interactive lifecycle management with Story Mode and Explore Mode.
-   **Mobile Experience**: PM On-The-Go Mode for mobile-first site management with procurement, commissioning, and approval quick actions.
-   **Permission Gating**: Both sidebar items and routes are permission-gated based on entity-level view permissions.
-   **Admin Tools**: Recovery Center, KPI Traceability Panel, Smart Import Control Tower, Control Center for system health, and Operational Exceptions.
-   **Workflow Management**: 4-gate handover system with checklists and progress tracking.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`. PostgreSQL for sessions, RBAC, and granular entity-level permissions.
-   **Data Handling**: Multer for uploads, `exceljs` for parsing, `pdfkit` for PDF generation.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Canonical Data Model**: All data reads/writes exclusively use `work_items` for tasks, `normalized_cost_lines` for costs, and `normalized_revenue_lines` for revenue as the single source of truth.
-   **Core Logic**: Pure-function modules, automated backfill for computed columns, audit trails, and transactional logging.
-   **Task Management**: Dual-write operations for engineering tasks to `operational_tasks` and `work_items`; direct sync for plan task edits to `work_items`. Supports bulk operations and summary rollups, with a unified status model.
-   **Engineering & Quality**: 5-stage checklist system with templating and SharePoint integration; API for all QC item instances.
-   **Financial Logic**: Consistent rules for revenue, expenses, COS Realised, and GP% calculations, aligned with the September to August financial year.
-   **Integrations**: MS Object Sync periodically syncs user-scoped calendar, email, and Teams data from Microsoft Graph API. Email/Message to Task functionality.
-   **Security**: Parameterized SQL queries, generic error messages, permission checks, NaN guards, and soft-delete implementation for various entities.
-   **Error Handling**: Centralized `ApiError` class with typed error codes.
-   **Admin Functionality**: Server-side support for admin recovery, KPI traceability, import control, and detailed audit logging.

### Database Architecture
-   **Central Entities**: `project_info` and `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `work_items` (canonical).
-   **Derived Data**: Dashboard metrics computed live from `work_items`.
-   **PM Maturity Tables (V1.2)**: `change_requests`, `raid_items`, `procurement_items`, `commissioning_items`, `invoice_captures`, `project_subcontractor_assignments`.

## External Dependencies

### Database & ORM
-   **PostgreSQL**
-   **Drizzle ORM**

### Authentication & Security
-   **Passport.js**
-   **bcryptjs**
-   **@azure/msal-node**

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

## Security & Permission Hardening (2026-03-06)
-   **Backend Permission Enforcement**: 47 critical write routes now have `requirePermission` or `requireAdmin` middleware. Covers: procurement (PO, counterparties, invoice patterns, subcontractor), project development (clients, tickets), projects (assign-pm, lifecycle, weekly reviews), and Smart Import (all write routes admin-only).
-   **Critical Fix**: `PUT /api/settings` previously had NO authentication — now requires `requireAuth` + `requireAdmin`.
-   **Ownership Scoping**: Projects-summary returns `_user_scope` metadata (full_oversight/owned/assigned/visible). Supports `?scope=owned` filter. `/api/tasks` endpoint scopes non-management users to assigned/owned tasks. My Work already strictly user-scoped.
-   **Smart Import Duplicate Prevention**: Normalized comparison, fuzzy matching with confidence scoring (auto-map ≥85%, conflict 50-85%), rerun detection via SHA-256 hash, `confirmNewProject` required to create new projects when matches exist. New endpoints: `GET /api/smart-import/project-matches/:name`, `PATCH /api/smart-import/:runId/assign-project`.
-   **Admin Governance**: New "Permission Enforcement Coverage" card in Admin Control Center showing backend-enforced route count, ownership-scoped endpoints, application-logic-only endpoints, recent access denials, and recent import issues. Updated permissions honesty notice.
-   **Assessment**: READY FOR CONTROLLED INTERNAL USE — security posture materially improved.
-   **Deliverables**: `BACKEND_PERMISSION_ENFORCEMENT_PLAN.md`, `OWNERSHIP_SCOPE_HARDENING.md`, `SMART_IMPORT_DUPLICATE_PREVENTION.md`, `ADMIN_GOVERNANCE_HARDENING.md`, `HARDENING_QA_MATRIX.md`, `HARDENING_DEFECT_REGISTER.md`, `HARDENING_RELEASE_RECOMMENDATION.md`.

## PM Maturity Features (V1.2 — 2026-03-06)
-   **Dependencies**: Task-to-task dependencies (FS/SS/FF/SF) with lag days, circular detection, integrated into TaskDetailDrawer via DependencyManager component. Backend: `server/dependency-routes.ts`.
-   **Change Control**: 7-stage pipeline (draft→closed) with cost/schedule impact, type classification, server-validated transitions. Backend: `server/change-control-routes.ts`. Table: `change_requests`.
-   **RAID Log**: Risk/Assumption/Issue/Decision tracking with priority (low→critical), owner, due date, mitigation. Backend: `server/raid-routes.ts`. Table: `raid_items`.
-   **Procurement Pipeline**: 8-stage pipeline (requested→closed) with supplier linking, expected/actual cost, PO reference. Backend: `server/procurement-routes.ts`. Table: `procurement_items`.
-   **Subcontractor Controls**: Project-level assignments with work packages, status tracking, performance notes. Routes added to `server/subcontractor-routes.ts`. Table: `project_subcontractor_assignments`.
-   **Commissioning & Closeout**: Checklist-style UI with progress bars, toggle between commissioning/closeout, owner and evidence tracking. Backend: `server/commissioning-routes.ts`. Table: `commissioning_items`.
-   **Invoice Capture**: Mobile-friendly invoice recording with supplier, PO, and procurement linking. Backend: `server/invoice-capture-routes.ts`. Table: `invoice_captures`.
-   **Approvals Enhancement**: General-purpose CRUD with entity linking, approver assignment, due dates, project filtering. Enhanced `approvals` table with 6 new columns.
-   **PM On The Go Integration**: 3 new action cards (Add Procurement, Update Commissioning, Review Approvals) in mobile project page.
-   **Permission Entities**: 5 new entities (pd_raid, pd_change_control, pd_procurement, pd_commissioning, pd_dependencies) in admin roles.
-   **Assessment**: READY FOR CONTROLLED INTERNAL USE — full project lifecycle management.
-   **Deliverables**: `PM_MATURITY_SCOPE.md`, `PM_MATURITY_IMPLEMENTATION.md`, `PM_ON_THE_GO_INTEGRATION_SPEC.md`, `PM_MATURITY_QA_MATRIX.md`, `PM_MATURITY_DEFECT_REGISTER.md`, `PM_MATURITY_RELEASE_NOTE.md`, `FUTURE_PM_EXPANSION_MAP.md`.