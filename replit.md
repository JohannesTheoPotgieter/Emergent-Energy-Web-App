# Emergent Energy Dashboard V1.0.0

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for comprehensive management of renewable energy projects. It offers end-to-end project lifecycle tracking, robust financial oversight (Cost of Sales, cashflow, revenue, expenditure), and streamlines engineering operations with a 5-stage checklist and task management. The platform integrates quality management, communication features, and Microsoft 365 services via Azure AD SSO. Its main goal is to boost efficiency, reduce operational costs, and enhance project delivery for renewable energy initiatives.

## User Preferences
Preferred communication style: Simple, everyday language.
All dropdowns across the app must be searchable (use Popover + Command combobox pattern, never plain Select for lists with a few items).

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design; Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Weekly Review Wizard, Execution Dashboard, Permission Gate System, PM Dashboard, and Gamification System.
-   **Project Plan Tab**: MS Project-style grid with WBS, duration/date editing, predecessors, resource assignment, inline % complete, auto-calculated RAG status, and baseline tracking.
-   **Inflows Tab (formerly Revenue)**: KPI summary strip and `shadcn/ui` table with sticky headers, status badges, inline editing, override indicators, and full audit logging. Renamed from "Revenue" to "Inflows" to distinguish from COS-linked revenue.
-   **Revenue Tracker Tab**: Monthly COS-linked revenue tracker matching COS tracker design. Formula: `revenue = (item_cost / total_COS) * total_milestone_revenue`. 6 KPI cards, chart with Realised/Unrealised stacked bars + Budget bar + YTD Variance dashed line, 12-row monthly grid (Revenue, Realised, Unrealised, Budget, Variance, Variance %, plus YTD equivalents) with drill-down. Admin-editable Budget row saves to `tracker_monthly_manual` with `trackerType: "REV"`. Component: `RevenueTrackerTab.tsx`.
-   **Program Revenue Tracker**: Executive-level revenue tracker page at `/revenue-tracker`. Same COS-linked formula aggregated across all projects with project breakdown. Admin-editable Budget row, chart, and 12-row grid with expandable project breakdown rows.
-   **Expenditure Breakdown Tab**: KPI cards and a table with collapsible category grouping, status badges, override indicators, inline editing, task linking, and "No Revenue Linked" toggle per line item.
-   **Execution Dashboard**: Card-based UI for project plan tasks and financial items, KPI summary, dual progress bars, and direct project links.
-   **Lifecycle Board**: Kanban-style board with drag-and-drop, detailed project cards, RAG status, and progress bars (PD%, Eng%, QA%, PM%).
-   **Portfolio Management**: Enhanced Gantt Chart with hierarchical milestones, two-layer progress bars, and slippage warnings.
-   **Project Detail Page**: "Command Center" layout with light white/green-themed header (`ProjectCommandHeader.tsx`), scoped CSS tokens (`.command-header`), user-settable RAG health status (COO/CEO/CCO), financial KPIs bar, compact tabbed overview (Plan/Engineering/Quality/Finance/Collaboration/PD tabs), section-based navigation for Project Management, Engineering, Quality, and Collaboration. Capture Deliverable accessible from Collaboration overview tab.
-   **Permission Gating**: Sidebar items are hidden based on entity-level view permissions (`PATH_TO_ENTITY` mapping in `AppLayout.tsx`). Route-level blocking via `ROUTE_TO_ENTITY` mapping in `App.tsx` shows AccessDenied page for unauthorized paths. Both use `checkPermission()` defaults + explicit `entityPermissions` from API.
-   **Local Project Folder Tab**: Per-user, per-project folder browser using browser File System Access API (`showDirectoryPicker`). Stores folder handle in IndexedDB (keyed by userId + projectName) for persistent local access; folder metadata saved to `user_project_folders` DB table. Located under Collaboration → Project Folder sub-tab. Component: `LocalFolderTab.tsx`.
-   **Financials**: "Actual vs Costed" terminology; financial year September to August; AI-style Financial Integration Panel.
-   **Project Creation**: COO/CEO initiated projects auto-generate engineering stage templates.
-   **Portfolio Dashboard**: Four view modes (Project Management, Finance, Quality, Engineering) with Recharts visualizations.
-   **Unified Work ("My Work")**: Consolidates personal and project-related tasks, calendar (Outlook integration), and communications. Aggregates tasks from all sources, includes gradient KPI cards, List/Board view toggle, full New Task dialog, source filter tabs, and enhanced task detail drawers. Shared Task Tracking allows viewing tasks created by the user but assigned to others.
-   **Approvals Screen**: Consolidated view for user-specific pending approvals.
-   **Teams Chat Groups**: MS Teams-styled channel-based group chat for departments and projects.
-   **PM On-The-Go Mode**: Mobile-first interface for site managers, enforcing daily updates and supporting PO requests/invoice linking.
-   **PO Generator**: Dialog-based Purchase Order generator creating PDFs with multiple line items, supplier auto-fill, and status tracking.
-   **Procurement / Counter Parties**: Supplier details panel storing VAT#, registration#, address, contact, bank details, and payment terms, used for PO generation.
-   **Quality Dashboard**: Compact 6-column KPI strip, Projects/Items view toggle, sortable projects table (not cards), sortable items table, and collapsible warnings.
-   **Universal Search**: Big search bar on the home page (`/`) searching across projects, work items, cost lines, and revenue lines via `/api/search` endpoint. Debounced input, keyboard navigation, type-colored result badges, and click-to-navigate. Replaces the removed dead search input from the header.
-   **Quality Tab**: Phase-tabbed navigation with progress indicators, group accordions, inline status buttons, evidence upload, approval workflows, and bulk actions.
-   **MS SSO Unavailable Banner**: Informative banner on Outlook email and Teams chat pages when Microsoft 365 SSO is not configured.
-   **Knowledge Base**: Wiki-style system with SOP-enriched nodes.
-   **Navigation**: Redesigned sidebar with color-coded section indicators and promoted "Users & Roles" admin shortcut.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`, using PostgreSQL for sessions, RBAC, and granular permissions. Auto-logout on version change. Password login restricted to admin roles (admin, COO_ADMIN, CEO_ADMIN) only — all other users must use Microsoft 365 SSO. The login page shows a "Sign in with username & password" toggle protected by an access code popup (code: 2024); backend enforces the restriction with a 403 on `/api/auth/login` for non-admin roles. Microsoft SSO matches users by `microsoft_id`, then email, then username prefix.
-   **Roles & Permissions UI**: Compact grid-based page with single-letter action toggles and collapsible categories.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Logic**: Pure-function modules, automated backfill for computed columns, and audit trails.
-   **Canonical Data Model**: All data reads/writes exclusively use `work_items` for tasks, `normalized_cost_lines` for costs, and `normalized_revenue_lines` for revenue.
-   **Client Management**: API for managing clients and assigning them to projects.
-   **Quality All-Items API**: Returns flat list of all QC item instances across all projects with filtering capabilities.
-   **Engineering Task Deliverables & Approval**: Supports file attachments, approval workflows, and prevents self-approval.
-   **Dual-Write**: Engineering task CRUD operations dual-write to both legacy `operational_tasks` and canonical `work_items`.
-   **Plan Task Sync**: Plan task edits sync directly to `work_items`.
-   **Project Detail Inline Editing**: Engineering tasks tab supports inline editing.
-   **Engineering Stage Management**: 5-stage checklist system with templating and SharePoint integration.
-   **Plan Change Tracker/Excel Sync Acknowledgment**: Notifies managers about data edits.
-   **Error Handling Architecture**: Centralized `ApiError` class with typed error codes and consistent JSON response.
-   **Security**: Parameterized SQL queries, generic error messages, permission checks, and NaN guards.
-   **Global Audit Logging**: Centralized audit logging for all write endpoints.
-   **Roles & Permissions**: Granular entity permissions across 11 categories.
-   **Smart Import Enhancements**: Supports hierarchical plan task detection, milestone detection, and preservation of manual overrides.
-   **Plan Task Bulk Operations**: Supports delete, indent, outdent, moveUp, moveDown operations.
-   **Summary Rollup**: Returns computed parent task aggregates for summary display.
-   **Baseline Tracking**: `work_items` table includes baseline fields, with PATCH endpoint handling updates and auto-calculation of end dates.
-   **MS Object Sync**: Periodically syncs user-scoped calendar, email, and Teams data from Microsoft Graph API using individual SSO tokens.
-   **Email/Message to Task**: Enables creating project-linked tasks from Outlook emails or Teams messages.
-   **PO Generator Backend**: Manages purchase orders with routes for listing, generating, downloading PDFs, and updating status. Uses `pdfkit` for PDF generation.
-   **COS Realised Logic**: Font color dictates confirmation status of `invoiceDateConfirmed`.
-   **Revenue-COS Linking**: Revenue calculated from COS realisation: `revenue = (item_cost / total_COS) * total_milestone_revenue`. Items flagged `no_revenue_linked` stay in COS denominator but get no revenue attributed. Total milestone revenue = sum of ALL milestone amounts regardless of payment status. Endpoints: `/api/revenue-tracker`, `/api/revenue-tracker/project/:projectName`, `/api/revenue-tracker/month-detail` (served from `finance-routes.ts` registered via `registerFinanceRoutes` in `server/index.ts`). Both endpoints now return budget (milestone inflows distributed by effective date), variance, variancePct, ytdBudget, ytdVariance, ytdVariancePct, and budgetProjects (program-level only).
-   **Inflows vs Revenue**: "Inflows Realised" = milestone payments confirmed in bank. "Revenue" = COS-linked calculated value. All former "Revenue Realised" labels renamed to "Inflows Realised".


### Database Architecture
-   **Core Structure**: `project_info` as central entity, linked to `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `work_items` (canonical).
-   **Derived Data**: Metrics for dashboards computed live from `work_items`. All PM dashboard KPIs read exclusively from canonical tables.
-   **Financial Calculation Rules**: Consistent rules for "in bank" revenue, "Paid" expenses, "COS Realised," and GP% calculations, aligned with the September to August financial year.
-   **Canonical Work Items**: `work_items` table is the single source of truth for all task reads, with `canonical_work_items_v1` feature flag enabled.
-   **Migration Finalize**: Admin-only UI for legacy table cleanup.

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