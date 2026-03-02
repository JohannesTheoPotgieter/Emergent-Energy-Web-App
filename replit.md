# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for comprehensive management of renewable energy projects. It offers end-to-end project lifecycle tracking, financial oversight (Cost of Sales, cashflow, revenue, expenditure), and engineering operations through a 5-stage checklist and task management system. The platform also includes quality management, communication tools, and integrates with Microsoft 365 services via Azure AD SSO. Its purpose is to enhance efficiency, reduce operational costs, and improve project delivery for renewable energy initiatives.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` and Tailwind CSS v4 for mobile-first responsive design, with Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Key Features**: Financial tracking, project and quality management, a 5-step Smart Excel Import wizard, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, Execution Cockpit, Permission Gate System, TR Register, and PM Dashboard.
-   **Portfolio Management**: Enhanced Gantt Chart with two-layer progress bars, commissioning markers, and slippage warnings. Supports hierarchical milestones.
-   **Project Detail Page**: Section-based navigation with key pillars (Project Management, Engineering, Quality, Collaboration) and a compact navigation strip. Includes a 2x2 summary card grid for expenditure, plan, engineering, and quality. Collaboration features include Chat, SharePoint Files, and project-scoped Approvals & Deliverables.
-   **Financials**: Uses "Actual vs Costed" terminology, financial year September to August. Financial Integration Panel links plan tasks to expenditure and revenue with auto-alert setup and AI-style rule suggestions.
-   **Project Creation**: COO/CEO can create projects, which auto-generates engineering stage templates.
-   **Portfolio Dashboard**: Offers four view modes (Project Management, Finance, Quality, Engineering) with Recharts visualizations and "Costed vs Actual" financial terminology.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`. Uses PostgreSQL for sessions, RBAC, rate limiting, and granular permission middleware.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM for transactional safety.
-   **Logic**: Pure-function modules, automated backfill for computed columns, and audit trails.
-   **Automation**: Auto-archive for projects older than 90 days post-import.

### Database Architecture
-   **Core Structure**: `project_info` as the central entity.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`.
-   **Derived Data**: Metrics for portfolio dashboards are computed live from underlying tables.

### Engineering Task Deliverables & Approval
-   **Deliverables**: Tasks support file attachments with specified recipients and acknowledgment tracking.
-   **Approval Flow**: Workflow for task status changes to "NEEDS APPROVAL" with Approve/Request Changes/Reject actions.

### Engineering Stage Management
-   **Module**: 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, and stage gate completion.
-   **SharePoint Integration**: Deliverable uploads include SharePoint sync folder path selection.
-   **Stage Gating**: Template-defined gate rules with COO override. Stages auto-generated based on project lifecycle board movement.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style system with SOP-enriched nodes.
-   **Operating System Map**: Integrated into `/ee-info` page.
-   **Walkthroughs**: Interactive step-by-step guides.
-   **Home Screen**: Role-based greetings, personalized Action Hub, interactive tutorial, and context-aware screen tours. Role-specific widgets.
-   **Data Source Debug Panel**: Dev-only panel showing API endpoints, backing tables, import timestamps, and stale data warnings.

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity and awarding points.
-   **Levels**: 8 progression levels from Rookie to Titan.
-   **Frontend**: Dedicated `/leaderboard` page displays rankings, badges, and activity breakdowns.

### Approvals Screen
-   **Module**: Consolidated view of user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Filtering**: Users see only applicable approvals; Admins can view all.
-   **Actions**: Direct Approve/Reject functionality.

### Teams Chat Groups
-   **Module**: MS Teams-styled channel-based group chat with department and project channels, file sharing, and member management.
-   **Backend**: CRUD routes for groups, members, messages, and file uploads.
-   **Frontend**: MS Teams-inspired UI at `/teams/chats`.

### Plan Change Tracker Confirmation
-   **Module**: Notifies Program Manager, Program Finance Manager, and Construction Manager about plan task data edits for confirmation.

### Excel Sync Acknowledgment System
-   **Module**: Fires `excel_sync_confirmation` notifications for changes to project data, expenses, revenue, engineering, quality, and PM On-The-Go actions.
-   **Recipients**: PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER roles.
-   **Dedup**: 2-minute throttle per project+changeType.

### PM On-The-Go Mode
-   **Module**: Mobile-first project management interface for `PROJECT_MANAGER_SITE` role users.
-   **Compliance**: Enforces daily site diary, weekly progress, weekly risk updates for construction projects.
-   **Financial Boundaries**: PM can request POs and link invoices (pending status) but cannot approve.

### Unified Work ("My Work") — Feature Flag: `unified_work_v1`
-   **Concept**: Merges "My Tool" + "Collaboration Hub" into a unified personal execution cockpit.
-   **Feature Flag**: `unified_work_v1` in `appSettings` table (currently ON).
-   **Navigation**: When flag ON, sidebar shows "MY WORK" (Home, Calendar, Tasks, Meetings) + "COLLABORATION" (Email, Teams Chat, SharePoint).
-   **My Work Home** (`/my-work`): 3-column layout — tasks grouped by project, today timeline, action-required communications.
-   **Unified Calendar** (`/my-work/calendar`): Combines Outlook events (blue) + all 5 task types in a time-grid layout (7AM-7PM). Week/Day toggle. Drag-and-drop scheduling: unscheduled tasks sidebar lets users drag tasks into time slots. Scheduled tasks can be dragged between slots to reschedule (duration preserved). Double-booking allowed. All task tables have `scheduled_date`, `scheduled_start_time`, `scheduled_end_time` columns. API: `GET /api/calendar/my-tasks` (combined mytool + operational + plan + engineering + quality tasks), `PATCH /api/calendar/schedule-task` (with ownership checks, supports all 5 task types). Color-coded: Personal (emerald), Operational (amber), Project Plan (violet), Engineering (cyan), Quality (rose).
-   **Unified Task Types**: All task types are user-assignable: Project Plan tasks (`normalized_plan_tasks.assignee_user_id`), Engineering tasks (`engineering_tasks.assignee_user_id`), Quality tasks (`qc_item_instance.assignee_user_id`), Operational tasks (`operational_tasks.owner_user_id` + `assignees`), Personal tasks (`mytool_tasks.owner_user_id`). Plan task owners backfilled from `owner` text field.
-   **Tasks** (`/my-work/tasks`): Unified task board aggregating personal tasks + operational/project tasks with filters.
-   **Meetings** (`/my-work/meetings`): Reuses existing MyToolMeetingsPage at new route.
-   **MS Object Sync**: `server/ms-sync-service.ts` periodically (15 min) syncs calendar, email, and Teams data into `ms_objects` table. On startup, auto-creates `ms_accounts` entries for all users so periodic sync works immediately. `server/ms-account-service.ts` manages MS account identity mapping. Manual sync trigger via `POST /api/ms-sync/trigger` auto-creates ms_account if missing.
-   **Collaboration**: When flag ON, collaboration page shows all 5 tabs (Calendar, Email, Teams Chat, SharePoint, Notifications). Email and Teams tabs use `SyncedEmailTab`/`SyncedTeamsTab` which auto-trigger sync on first visit if ms_objects is empty. Each tab has a "Sync Now" button. Standalone pages at `/collaboration/email`, `/collaboration/teams`, `/collaboration/sharepoint` also have sync buttons. Calendar tab uses direct Graph API proxy (`/api/outlook/events`). SharePoint tab falls back to legacy browse.
-   **Project Tagging**: Any MS object can be tagged to a project via `TagToProjectDialog`. Routes: `POST/DELETE /api/ms-objects/:id/tag-project`.
-   **Convert to Task**: `ConvertToTaskDialog` lets user choose a project (or personal) before creating task. Backend accepts optional `projectId` in `POST /api/ms-objects/:id/convert-to-task`. Creates `operational_task` (project-linked) or `mytool_task` (personal).
-   **Permission Entities**: `my_work`, `ms_sync`, `project_tagging` in `ENTITY_PERMISSION_DEFAULTS` + admin UI.
-   **Key Files**: `server/ms-sync-service.ts`, `server/ms-sync-routes.ts`, `server/ms-account-service.ts`, `server/project-linking-service.ts`, `client/src/pages/my-work-home.tsx`, `client/src/pages/my-work-calendar.tsx`, `client/src/pages/my-work-tasks.tsx`, `client/src/pages/collaboration.tsx`.

### Roles & Permissions (Enhanced)
-   **Admin Page**: `admin-roles.tsx` for managing 11 permission categories with 85 granular entity permissions (View/Edit/Approve/Override/Delete).
-   **Categories**: Cockpit, Project Management, Finance, Engineering, Quality & Governance, Project Detail Tabs, Project Development, Information, Collaboration, Data & Reports, Admin.
-   **Backend**: `server/permission-middleware.ts` with `requirePermission(entity, action)` middleware.

### Email/Message to Task
-   **Module**: Enables creating project-linked operational tasks directly from Outlook emails or Teams messages.
-   **Notifications**: Assignee receives a notification upon task creation.

### Smart Import — Deleted Project Re-creation Detection
-   **Module**: Detects if an imported project name matches a previously hard-deleted project and issues a `previously_deleted` warning.
-   **Frontend**: Shows a red confirmation card; user must confirm "Re-create & Import."
-   **Bulk Commit**: Auto-passes `forceRecreate=true` to skip warning.

### Deploy Cache & Session Clearing
-   **Build Versioning**: Frontend clears client-side cache/session on new deployments.
-   **Server Sessions**: PostgreSQL sessions are cleared on each production deploy.

### Global Audit Logging
-   **Module**: Centralized `server/audit-logger.ts` for fire-and-forget audit logging.
-   **Table**: `audit_events` stores actorRole, userId, userName, source, entityType, entityId, action, changesJson, projectName, ipAddress, requestPath, requestMethod, createdAt.
-   **Coverage**: All write endpoints across various route files.

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

### Microsoft Integration
-   **Outlook**: Connected via Replit Connector (OAuth) for calendar sync, email access, approval emails, and email-to-task linking.
-   **SharePoint**: Document library browsing with auto-discovery of sites/drives via Graph API.
-   **Teams**: MS Teams channel/chat integration via Graph API, plus internal dashboard chat channels.