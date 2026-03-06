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
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Weekly Review Wizard, Execution Dashboard, Permission Gate System, PM Dashboard, Gamification System, and a Universal Search.
-   **Project Planning**: MS Project-style grid with WBS, duration/date editing, predecessors, resource assignment, inline % complete, RAG status, and baseline tracking.
-   **Financial Tracking**: Dedicated tabs for Inflows, Revenue Tracker (COS-linked), GP Tracker, Expenditure Breakdown, and Cashflow.
-   **Project Management**: Card-based Execution Dashboard, Kanban-style Lifecycle Board, and a "Command Center" project detail page.
-   **Unified Work ("My Work")**: Consolidates tasks from various sources into a unified board/list with filtering and task management, supporting canonical statuses (todo, in_progress, blocked, review, complete, cancelled).
-   **Approvals & Procurement**: Consolidated Approvals screen and a PO Generator.
-   **Quality Management**: Quality Dashboard with KPIs and a Quality Tab with phase-tabbed navigation and approval workflows.
-   **Collaboration**: Local Project Folder Tab, MS Teams-styled chat groups, and a Knowledge Base.
-   **Portfolio Management**: Enhanced Gantt Chart and aggregated Cashflow view across projects.
-   **Company Lifecycle Map**: Interactive lifecycle management with Story Mode and Explore Mode.
-   **Mobile Experience**: PM On-The-Go Mode for mobile-first site management.
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