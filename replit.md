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
-   **Project Planning**: MS Project-style grid with WBS, duration/date editing, predecessors, resource assignment, inline % complete, RAG status, and baseline tracking.
-   **Financial Tracking**: Dedicated tabs for Inflows (formerly Revenue), Revenue Tracker (COS-linked revenue: `revenue = (item_cost / total_COS) * total_milestone_revenue`), GP Tracker (Revenue - COS = GP), Expenditure Breakdown, and Cashflow (weekly cashflow with multi-select project filter).
-   **Project Management**: Card-based Execution Dashboard, Kanban-style Lifecycle Board, and a "Command Center" project detail page with financial KPIs, RAG status, and section-based navigation.
-   **Unified Work ("My Work")**: Consolidates tasks from all sources (personal, operational, plan, engineering, quality, approvals, deliverables, TR register, MS 365, notifications) into a unified board/list with filtering and task management.
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