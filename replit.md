# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for comprehensive management of renewable energy projects. It provides end-to-end project lifecycle tracking, robust financial oversight including Cost of Sales, cashflow, revenue, and expenditure, and streamlines engineering operations through a structured 5-stage checklist and task management system. The platform also incorporates quality management tools, communication features, and seamless integration with Microsoft 365 services via Azure AD SSO. Its core purpose is to boost efficiency, cut operational costs, and enhance project delivery for renewable energy initiatives.

## User Preferences
Preferred communication style: Simple, everyday language.
All dropdowns across the app must be searchable (use Popover + Command combobox pattern, never plain Select for lists with more than a few items).

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design, with Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import wizard, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, Execution Dashboard, Permission Gate System, PM Dashboard, and a Gamification System.
-   **Project Plan Tab**: MS Project-style grid with auto-numbered rows, WBS, duration/date editing, predecessors, resource assignment, inline % complete, and auto-calculated RAG status. Baseline tracking is supported.
-   **Revenue Tracking Tab**: KPI summary strip and a `shadcn/ui` table with sticky headers, status badges, inline editing, override indicators, and full audit logging.
-   **Expenditure Breakdown Tab**: KPI cards and a table with collapsible category grouping, status badges, override indicators, inline editing, and task linking.
-   **Execution Dashboard**: Card-based UI focusing on project plan tasks and financial items, with KPI summary, dual progress bars, and direct links to project details.
-   **Lifecycle Board**: Kanban-style board with drag-and-drop functionality, detailed project cards including RAG status, and four compact progress bars (PD%, Eng%, QA%, PM%). Includes filtering, search, and project creation/management.
-   **Portfolio Management**: Enhanced Gantt Chart with hierarchical milestones, two-layer progress bars, and slippage warnings.
-   **Project Detail Page**: Section-based navigation for Project Management, Engineering, Quality, and Collaboration (Chat, SharePoint Files, Approvals & Deliverables).
-   **Financials**: Uses "Actual vs Costed" terminology with a financial year of September to August, and an AI-style Financial Integration Panel.
-   **Project Creation**: COO/CEO initiated projects auto-generate engineering stage templates.
-   **Portfolio Dashboard**: Four view modes (Project Management, Finance, Quality, Engineering) with Recharts visualizations.
-   **Unified Work ("My Work")**: Consolidates personal and project-related tasks, calendar (with Outlook integration), and communications. All Microsoft 365 data (calendar events, emails, tasks) is scoped to the logged-in user's SSO token — each user sees their own Outlook calendar and inbox. My Work Tasks is the primary task management hub — it aggregates tasks from all sources (personal, project, engineering, quality, approvals, TR Register/action items, deliverables, notifications, MS 365). Includes gradient KPI cards (Active, Overdue, High Priority, Completed — Overdue card is clickable to toggle filter), List/Board (Kanban) view toggle with drag-and-drop status changes on the board, full New Task dialog (personal tasks or action items with status selector, priority, due date, multi-user assignment via AssignToSelector, RAG status, department, project linking), source filter tabs with counts, overdue toggle filter, search with clear button, and enhanced task detail drawers with inline RAG editing and notes editing for TR items. TR Register has been merged into My Work Tasks — `/tr-register` redirects to `/my-work/tasks`. Board columns support drag-and-drop for personal, project, engineering, and TR register tasks. **Shared Task Tracking**: Tasks created by a user but assigned to others remain visible in their My Work view with a teal "Tracking" badge. A dedicated "Tracking" source filter tab shows all tasks the user created (including TR Register action items and operational/project tasks). Backend queries include `created_by` matching alongside owner/assignee matching to surface these tasks. `trackingRole` field distinguishes "assignee", "creator", or "both" for each task.
-   **Approvals Screen**: Consolidated view for user-specific pending approvals.
-   **Teams Chat Groups**: MS Teams-styled channel-based group chat for departments and projects.
-   **PM On-The-Go Mode**: Mobile-first interface for site managers, enforcing daily updates and supporting PO requests/invoice linking.
-   **PO Generator**: Dialog-based Purchase Order generator accessible from project detail page. Creates PDFs matching Emergent Energy template (PO{seq}-{PROJECT}-{DATE}-{Supplier} naming). Supports line items, supplier details, delivery instructions, and status tracking (draft/sent/approved/cancelled). PDF download on generation.
-   **Quality Dashboard**: Overhauled with KPI strip (Total Projects, Items Passed, Active Warnings, Avg QM Score), Projects/Items view toggle, sortable items table, and collapsible warnings by severity.
-   **Quality Tab**: Phase-tabbed navigation with progress indicators, group accordions, inline status buttons (Pass/Fail/Review/N/A), evidence upload, approval workflows, and bulk actions.
-   **MS SSO Unavailable Banner**: Outlook email and Teams chat pages show blue info banner when Microsoft 365 SSO is not configured for the user, replacing destructive toast with persistent informative UI.
-   **Knowledge Base**: Wiki-style system with SOP-enriched nodes.
-   **Navigation**: Redesigned sidebar with color-coded section indicators, tooltip support for collapsed state, and promoted "Users & Roles" admin shortcut in the user profile area. Sections flow: My Work → EXCO → Collaboration → Project Management → Finance → Project Development → Engineering → Governance → Information → Admin. Admin section now has Users & Roles as a top-level item (not nested under Settings). Collapsed sidebar width reduced to 68px with icon-only tooltips.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`, using PostgreSQL for sessions, RBAC, and granular permissions. Auto-logout on version change: AppLayout polls `/api/version` every 60s and forces logout + redirect to login if server version differs from stored `app_version` in localStorage.
-   **Roles & Permissions UI**: Compact grid-based permissions page with single-letter action toggles (V/E/A/O/D), collapsible categories with ALL/VIEW/OFF presets, and sidebar section toggle chips. 11 permission categories aligned to sidebar structure.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Logic**: Pure-function modules, automated backfill for computed columns, and audit trails.
-   **Canonical Data Model**: All data reads/writes exclusively use `work_items` for tasks, `normalized_cost_lines` for costs, and `normalized_revenue_lines` for revenue. Legacy tables are fully deprecated.
-   **Client Management**: Standalone Clients page at `/clients` in EXCO nav section. API for managing clients (`GET/POST /api/pd/clients`, `PATCH /api/pd/clients/:id`, `GET /api/pd/clients/project-counts`) and assigning them to projects.
-   **Quality All-Items API**: `GET /api/quality/all-items` returns flat list of all QC item instances across all projects with joins to template items, phases, groups, checklists, evidence counts, and assignee names. Supports `?project=X&phase=Y&status=Z` filtering.
-   **Engineering Task Deliverables & Approval**: Supports file attachments, approval workflows, and prevents self-approval.
-   **Dual-Write to work_items**: Engineering task CRUD operations dual-write to both legacy `operational_tasks` and canonical `work_items`.
-   **Plan Task work_items Sync**: Plan task edits sync to `work_items` directly.
-   **Project Detail Inline Editing**: Engineering tasks tab supports inline editing with save on blur/select.
-   **Engineering Stage Management**: 5-stage checklist system with templating and SharePoint integration.
-   **Plan Change Tracker/Excel Sync Acknowledgment**: Notifies managers about data edits with deduplication.
-   **Error Handling Architecture**: Centralized `ApiError` class with typed error codes and consistent JSON response format. Frontend provides reusable loading/error/empty states and network status.
-   **Security**: Parameterized SQL queries, generic error messages, permission checks, and NaN guards.
-   **Global Audit Logging**: Centralized audit logging for all write endpoints.
-   **Roles & Permissions**: Granular entity permissions across 11 categories.
-   **Smart Import Enhancements**: Supports hierarchical plan task detection, milestone detection, and expanded plan synonyms. Includes bulk commit features. Import protection: before applying plan task updates, checks `project_plan_overrides` — manual override values are preserved instead of being overwritten by import data. Preserved overrides logged in commit summary.
-   **Plan Task Bulk Operations**: `POST /api/planning-tasks/bulk` supports delete, indent, outdent, moveUp, moveDown operations with Excel sync notifications and audit logging.
-   **Summary Rollup**: `GET /api/planning-tasks/:projectName/summary-rollup` returns computed parent task aggregates (weighted % complete, min start, max end, total duration) for summary task display.
-   **Baseline Tracking**: `work_items` table has `baseline_start`, `baseline_end`, `baseline_duration`, `task_mode` columns. PATCH endpoint handles all baseline and duration fields with auto-calc end date from duration.
-   **MS Object Sync**: Periodically syncs calendar, email, and Teams data from Microsoft Graph API. All syncs are user-scoped — each user's SSO token is used to fetch their own data. Token refresh via MSAL `acquireTokenSilent` with persisted token cache in `ms_accounts.refresh_token_encrypted`. Fallback to shared Replit Connector is blocked for user-specific endpoints (`/me/*`). All Outlook/SharePoint API routes require a valid user SSO token — if no token exists, routes return empty arrays or 401 instead of using the shared connector. The `resolveUserToken` function in `outlook.ts` enforces this at the Graph API level, and route-level guards in `routes.ts` provide early rejection.
-   **Email/Message to Task**: Enables creating project-linked tasks from Outlook emails or Teams messages.
-   **PO Generator Backend**: `server/po-routes.ts` with `purchase_orders` table and `po_number_seq` sequence. Routes: `GET /api/po/:projectName` (list), `POST /api/po/generate` (create + PDF), `GET /api/po/:projectName/:poId/pdf` (download), `PATCH /api/po/:poId/status`, `DELETE /api/po/:poId`. Uses parameterized SQL queries via Drizzle `sql` template tag. PDF generated with `pdfkit`.
-   **COS Realised Logic**: Font color takes precedence over `invoiceDateConfirmed` boolean. Red font = NOT confirmed regardless of boolean. Manual date overrides do NOT auto-set `invoiceDateConfirmed=true`; only explicit font color toggle (black) confirms a date.

### Database Architecture
-   **Core Structure**: `project_info` as the central entity, linked to `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `work_items` (canonical).
-   **Derived Data**: Metrics for dashboards are computed live from `work_items`. All PM dashboard KPIs (High Priority Actions, COS, Cashflow, Revenue Outstanding, Expense Overdue, Projects Behind Plan, Overdue Tasks, Upcoming Milestones) read exclusively from canonical tables via storage adapters (`adaptCostToExpense`, `adaptRevenueToInflow`, `mapWorkItemToProjectPlan`).
-   **Financial Calculation Rules**: Consistent rules for "in bank" revenue, "Paid" expenses, "COS Realised," and GP% calculations, aligned with the September to August financial year.
-   **Canonical Work Items**: `work_items` table is the single source of truth for all task reads, with a feature flag `canonical_work_items_v1` enabled. Backfill runs on startup.
-   **Migration Finalize**: Admin-only UI for legacy table cleanup, including verification, backup, archive, and permanent drop capabilities.

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