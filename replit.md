# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application for managing renewable energy projects. It provides end-to-end project lifecycle tracking, financial oversight (Cost of Sales, cashflow, revenue, expenditure), and engineering operations through a 5-stage checklist and task management system. Key capabilities include quality management, communication tools, and integration with Microsoft 365 services via Azure AD SSO. The platform aims to enhance efficiency, reduce operational costs, and improve project delivery for renewable energy initiatives.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design, with Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import wizard, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, Execution Dashboard, Permission Gate System, TR Register, PM Dashboard, and a Gamification System (badges and leaderboards).
-   **Execution Dashboard**: Focused on project plan tasks and project finance items only (no engineering/quality metrics). Polished card-based UI with shadow/hover effects, rounded-xl expanded sections, colored dot indicators, and dual progress bars (actual vs expected with dashed expected marker). 5-column KPI summary strip: average completion, schedule health, revenue, costs, overall GP%. Project names are directly clickable links to project detail. Each expanded card section has inline "View" links navigating to plan/revenue/expenditure/detail tabs. Bottom action bar with Open Project, Plan Tasks, Revenue, Expenditure buttons. Mobile-first responsive layout with dedicated mobile progress bar. Dates section shows construction/commissioning/handover with icons. Widget config fetch uses auth token header for JWT users.
-   **Lifecycle Board**: Kanban-style project phase board with drag-and-drop between phases. Enhanced project cards showing RAG dot (clickable for exec roles), project name, tracker badge (Linked/No tracker), kWp, contract value, PD/PM/Last Engineer ownership row, and 4 compact progress bars (PD%, Eng%, QA%, PM%). RAG modal allows COO/CEO/CCO to set RAG status with mandatory comment and audit trail (`project_rag_audit` table). Last engineer derived from most recent `work_items` ENG workstream activity. Board supports filtering, search, active-only toggle, project creation, phase editing, execution gate management, and project merge/link.
-   **Portfolio Management**: Enhanced Gantt Chart with hierarchical milestones, two-layer progress bars, commissioning markers, and slippage warnings.
-   **Project Detail Page**: Section-based navigation with core pillars (Project Management, Engineering, Quality, Collaboration) and a 2x2 summary card grid. Collaboration features include Chat, SharePoint Files, and project-scoped Approvals & Deliverables.
-   **Financials**: "Actual vs Costed" terminology, financial year September to August. Financial Integration Panel links plan tasks to expenditure and revenue with auto-alert setup and AI-style rule suggestions.
-   **Project Creation**: COO/CEO initiated projects auto-generate engineering stage templates.
-   **Portfolio Dashboard**: Four view modes (Project Management, Finance, Quality, Engineering) with Recharts visualizations and "Costed vs Actual" financial terminology.
-   **Unified Work ("My Work")**: Consolidates personal and project-related tasks, calendar, and communications into a single interface. Features a unified calendar with drag-and-drop scheduling for various task types, and integration with Outlook events.
-   **Approvals Screen**: Consolidated view for user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Teams Chat Groups**: MS Teams-styled channel-based group chat with department and project channels, file sharing, and member management.
-   **PM On-The-Go Mode**: Mobile-first project management interface for site managers, enforcing daily site diary, weekly progress, and risk updates. Supports PO requests and invoice linking (pending status).
-   **Knowledge Base**: Wiki-style system with SOP-enriched nodes and interactive walkthroughs.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`. Uses PostgreSQL for sessions, RBAC, rate limiting, and granular permission middleware.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM for transactional safety.
-   **Logic**: Pure-function modules, automated backfill for computed columns, and audit trails.
-   **Automation**: Auto-archive for projects older than 90 days post-import.
-   **Canonical Data Model (Fully Migrated)**: All data reads/writes use canonical tables exclusively. `work_items` is the single table for ALL task data. `normalized_cost_lines` is the single table for ALL cost/expense data. `normalized_revenue_lines` is the single table for ALL revenue/inflow data. Legacy tables (`program_expense`, `program_inflows`, `normalized_plan_tasks`, `project_plan`) are fully deprecated — no active code reads from or writes to them. All merge functions (`mergeExpensesOnly`, `mergeInflowsOnly`, `mergePlansOnly`, `fetchAllNormalized`, `mergeNormalizedData`, `mergeForProject`) have been removed. Backfill on startup migrates historical data from legacy tables into `work_items` (idempotent, skips projects that already have Smart Import entries). Storage adapter methods (`getAllProgramExpenses`, `getAllProgramInflows`) read from canonical tables and adapt to legacy shape for backward compatibility. `data-merge.ts` only contains `adaptCostToExpense`, `adaptRevenueToInflow`, `mapCostToExpenseInput`, and `createNameResolver`.
-   **Client Management**: `GET /api/clients` lists all clients; `POST /api/clients` creates new clients with auto-generated `EE-C####` IDs. `PATCH /api/project-info/:id` accepts `clientId` to assign clients to projects. Portfolio view shows client name column.
-   **Engineering Task Deliverables & Approval**: Supports file attachments for tasks and an approval workflow for task status changes. Self-approval prevented for both deliverables and stage gate approvals. Duplicate engineering stage generation guarded (returns 409 if stages already exist).
-   **Dual-Write to work_items**: Engineering task CRUD (POST/PATCH/DELETE in `server/engineering-routes.ts`) dual-writes to both `operational_tasks` (legacy) and `work_items` via `createWorkItem()`, `updateWorkItemByLegacy()`, `softDeleteWorkItemByLegacy()` from `server/work-items-adapter.ts`. Sync errors are non-fatal (caught and warned). GET `/api/projects/:projectId/eng-tasks` reads from `work_items` when `canonical_work_items_v1` feature flag is enabled, with fallback merge of unmatched legacy records. Engineering `percentComplete` is converted from 0-100 to 0-1 when syncing to work_items.
-   **Plan Task work_items Sync**: Plan task edits (working-plan PATCH, planning-tasks PATCH) sync to `work_items`. PATCH endpoint uses three-phase lookup: 1) `project_plan` table by `actualTaskId` (legacy import), 2) `work_items` where `legacyTable='normalized_plan_tasks'` and `legacyId=actualTaskId` (Smart Import tasks), 3) `operational_tasks` by `actualTaskId` (manually created tasks). Smart Import path updates `work_items` directly (title, dates, status, percentComplete as 0-1) and syncs back to `normalized_plan_tasks` via `safeLegacyWrite`. All paths handle negative task IDs via `Math.abs()`. Inline editing in plan grid supports % complete, start/end dates, and WBS number directly in the table cells.
-   **Project Detail Inline Editing**: Engineering tasks tab in project detail page supports expand-to-edit: click a task row to expand an inline form with title, status, priority, dates, assignee, and description fields. Changes save on blur/select via PATCH to `/api/eng/tasks/:id`. Read-only view shown for users without edit permission.
-   **Engineering Stage Management**: 5-stage engineering checklist system with templating, project stage instantiation, and stage gate completion, including SharePoint integration for deliverable uploads.
-   **Plan Change Tracker/Excel Sync Acknowledgment**: Notifies relevant managers about plan task data edits and project data changes, with notification deduplication. Excel sync notifications sent for: font colour changes, date edits, invoice/PO captures, manual expense lines, COS overrides, revenue overrides, plan task create/update/delete, working plan changes.
-   **Error Handling Architecture**: Centralized `ApiError` class (`server/lib/api-error.ts`) with typed error codes (BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, VALIDATION_ERROR, SERVER_ERROR) and consistent JSON response format `{error, message, details}`. Frontend `ApiError` class (`client/src/lib/api-error.ts`) mirrors codes and adds `NETWORK_ERROR`/`TIMEOUT`. `QueryResult` component (`client/src/components/QueryResult.tsx`) provides reusable loading/error/empty states with contextual retry. `NetworkStatus` component shows offline/reconnected banners. `useMutationWithToast` hook auto-handles success and error toasts. `ErrorBoundary` enhanced with Go Back / Reload / Go Home recovery.
-   **Security**: Engineering unified-audit uses parameterized SQL queries. Error responses use generic messages (no internal error leaking). Quality item updates require `requirePermission('pd_quality', 'edit')` and validate `qmStatus` values and `allowedWorkingDays >= 0`. NaN guards on all financial parseFloat aggregations.
-   **Global Audit Logging**: Centralized `server/audit-logger.ts` for fire-and-forget audit logging of all write endpoints.
-   **Roles & Permissions**: Enhanced admin page for managing granular entity permissions across 11 categories.
-   **Smart Import Enhancements**: Supports hierarchical plan task detection (e.g., WBS), milestone detection, and expanded plan synonyms. Detects re-creation of previously deleted projects. Bulk commit deletes of `project_plan`/`projectPlanDependency` guarded with `safeLegacyWrite`. Work_items cleanup catches both `::PLAN::` and `NPT::` external_ref formats. Bulk commit panel includes "Resolve All Warnings" button (calls `/allow-all` per run).
-   **MS Object Sync**: Periodically syncs calendar, email, and Teams data from Microsoft Graph API into a local `ms_objects` table, with manual sync triggers. Teams sync uses per-user SSO token (stored in `ms_accounts.sso_access_token`) with Chat/Teams scopes; calendar/email sync uses the Replit Outlook connector token.
-   **Email/Message to Task**: Enables creating project-linked operational tasks directly from Outlook emails or Teams messages.

### Database Architecture
-   **Core Structure**: `project_info` as the central entity, linked to `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `work_items` (canonical). Legacy tables (`program_expense`, `program_inflows`, `normalized_plan_tasks`, `project_plan`) are fully deprecated — no active code reads or writes to them.
-   **Derived Data**: Metrics for portfolio dashboards are computed live from `work_items` table.
-   **Financial Calculation Rules (consistent across all endpoints)**: Revenue "in bank" = `manualInBank || (hasPaymentReceived && hasInvoice)`; Expense "Paid" = `classifyExpenseState()` returns 'Paid' (requires invoice + confirmed payment date); COS Realised = `classifyCosStatus()` (requires PO + invoice + confirmed invoice date); GP% uses `totalContractRevenue` / `totalExpenses` (total, not actual received/paid); `actual_revenue` = only in-bank milestones; `actual_expenses` = only Paid-state items. Financial year: September to August.
-   **Canonical Work Items**: `work_items` table is the single source of truth for all task reads. Feature flag `canonical_work_items_v1` is ON. All dashboards (portfolio summary, planning-tasks, My Work, PM On-The-Go, gamification, milestone notifications, projects-summary, quality, lifecycle) read from `work_items`. Backfill runs on startup via `server/work-items-backfill.ts` (idempotent, each table independently error-handled). External ref prefixes: `NPT::`, `OT::`, `ET::`, `MT::`, `TASK::`, `IT::`, `PET::`, `QCI::`, `PP::`. Supporting tables: `work_item_assignments`, `work_item_dependencies`. `work_items.percent_complete` stores 0-1 range; display multiplied by 100.
-   **Migration Finalize (Phase 5)**: Admin-only UI at `/admin/database-migration` for legacy table cleanup. Features: verification suite, backup registration (`migration_backups` table), reference scanning, archive-with-confirmation (tables renamed to `*_legacy_archive`), 7-day cooldown before permanent drop, restore capability, full activity log (`migration_cleanup_log` table). Key files: `server/migration-finalize-routes.ts`, `client/src/pages/database-migration.tsx`.

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