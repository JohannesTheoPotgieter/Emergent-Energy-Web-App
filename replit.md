# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for comprehensive management of renewable energy projects. It facilitates end-to-end project lifecycle tracking, financial oversight (Cost of Sales, cashflow, revenue, expenditure), and engineering operations through a 5-stage checklist and task management system. The platform also includes quality management and fosters cross-department collaboration with integrated communication tools. It integrates seamlessly with Microsoft 365 services (Outlook, SharePoint, Teams) via Azure AD SSO. The vision is to provide a unified platform that enhances efficiency, reduces operational costs, and improves project delivery for renewable energy initiatives, positioning Emergent Energy as a leader in sustainable energy solutions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design, with Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Core Features**: Includes financial tracking, project and quality management, a 5-step Smart Excel Import wizard, and a Subcontractor Dashboard. Features a UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, and an Execution Cockpit for administration. Implements a Permission Gate System for role-based access. A TR Register tracks cross-project action items, and a PM Dashboard offers view-only project oversight.
-   **Portfolio Management**: Enhanced Gantt Chart with two-layer progress bars, commissioning markers, and slippage warnings. Plan management supports hierarchical milestones with auto-computed rollup values.
-   **Project Detail Page**: Section-based navigation with key pillars (Project Management, Engineering, Quality, Collaboration) and a compact navigation strip. Overview includes a 2x2 summary card grid for Expenditure Breakdown, Project Plan, Engineering, and Quality. Collaboration features include Chat, SharePoint Files, and project-scoped Approvals & Deliverables.
-   **Financials**: "Actual vs Costed" terminology is used, with financial year spanning September to August. Financial Integration Panel on project detail links to a dedicated Financial Linking page (`/project/:projectName/financial-linking`) for linking plan tasks to expenditure and revenue, with auto-alert setup and AI-style rule suggestions.
-   **Project Creation**: COO/CEO can create projects, which auto-generates engineering stage templates.
-   **Portfolio Management**: Projects are grouped under portfolios with client associations. A Portfolio Dashboard offers four view modes (Project Management, Finance, Quality, Engineering) with Recharts visualizations and "Costed vs Actual" financial terminology.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy and Microsoft 365 SSO via `@azure/msal-node`. Utilizes PostgreSQL for sessions, role-based access control (RBAC), rate limiting, and granular permission middleware.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM, ensuring transactional safety.
-   **Logic**: Pure-function modules for computations, automated backfill for computed columns, and audit trails.
-   **Automation**: Auto-archive for projects older than 90 days post-import.

### Database Architecture
-   **Core Structure**: `project_info` as the central entity.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`.
-   **Derived Data**: Metrics for portfolio dashboards are computed live from underlying tables (`project_plan`, `program_expense`, `program_inflows`).

### Engineering Task Deliverables & Approval
-   **Deliverables**: Tasks support file attachments with specified recipients and acknowledgment tracking.
-   **Approval Flow**: A workflow for task status changes to "NEEDS APPROVAL" with Approve/Request Changes/Reject actions.

### Engineering Stage Management
-   **Module**: A 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD operations for templates, project stage instantiation, and stage gate completion logic.
-   **SharePoint Integration**: Deliverable uploads include SharePoint sync folder path selection.
-   **Stage Gating**: Template-defined gate rules with COO override capability. Stages are auto-generated based on project lifecycle board movement.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style system providing SOP-enriched nodes for various processes.
-   **Operating System Map**: Integrated into the `/ee-info` page with Lifecycle Overview, Department Drilldown, and Process Detail.
-   **Walkthroughs**: Interactive step-by-step guides covering application functionality.
-   **Home Screen**: Features role-based greetings, a personalized Action Hub with stat cards, tasks, approvals, notifications, and an interactive tutorial for onboarding. Context-aware screen tours are available on major pages. Role-specific widgets include Quick Actions, Portfolio Health, Financial Headline, Schedule Risk, Quality Overview, Engineering Queue, Data Health, and Alerts — all powered by foundation import data.
-   **Data Source Debug Panel**: Dev-only collapsible panel (`DataSourceDebug.tsx`) on major pages showing API endpoints, backing tables, import timestamps, and stale data warnings.

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity, awarding points for positive actions, and applying penalties for negative behaviors.
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
-   **Workflow**: Recipients can confirm, which auto-confirms related notifications.

### Excel Sync Acknowledgment System
-   **Module**: `server/excel-sync-notifications.ts` — fires `excel_sync_confirmation` notifications whenever ANY project data changes (project info, expenses, revenue, engineering, quality, PM On-The-Go actions).
-   **Recipients**: PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER roles.
-   **Dedup**: 2-minute throttle per project+changeType via `notification_throttle` table.
-   **Hooked into**: routes.ts (7 endpoints), engineering-routes.ts, eng-stage-routes.ts, quality-routes.ts, pm-on-the-go-routes.ts (9 action endpoints).

### PM On-The-Go Mode
-   **Module**: Mobile-first project management interface exclusively for `PROJECT_MANAGER_SITE` role users.
-   **Tables**: `pm_site_visits`, `pm_on_the_go_actions`, `pm_compliance_tracking`, `pm_mode_preferences`.
-   **Routes**: `/api/pm-otg/*` in `server/pm-on-the-go-routes.ts` — mode preference, project snapshots, 9 action endpoints, compliance tracking.
-   **Frontend**: Toggle in header (`PmModeToggle.tsx`), home page (`pm-on-the-go-home.tsx`), project control page (`pm-on-the-go-project.tsx`).
-   **Compliance**: Daily site diary, weekly progress, weekly risk update enforcement for construction projects.
-   **Financial Boundaries**: PM can request POs and link invoices (status: pending) but cannot approve.

### Roles & Permissions (Enhanced)
-   **Admin Page**: `admin-roles.tsx` — 11 permission categories with 60+ granular entity permissions (View/Edit/Approve/Override/Delete).
-   **Categories**: Cockpit, Project Management, Finance, Engineering, Quality & Governance, Project Detail Tabs, Project Development, Information, Collaboration, Data & Reports, Admin.
-   **Backend**: `server/permission-middleware.ts` with `requirePermission(entity, action)` middleware + 60s cache.
-   **Defaults**: `ENTITY_PERMISSION_DEFAULTS` in `shared/schema.ts` for all entities.

### Email/Message to Task
-   **Module**: Enables creating project-linked operational tasks directly from Outlook emails or Teams messages via a dedicated endpoint.
-   **Notifications**: Assignee receives a notification upon task creation.
-   **UI**: `CreateTaskFromSourceDialog` component for task creation.

### Deploy Cache & Session Clearing
-   **Build Versioning**: Frontend clears client-side cache/session on new deployments.
-   **Server Sessions**: PostgreSQL sessions are cleared on each production deploy.

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
-   **Outlook**: Connected via Replit Connector (OAuth) for calendar sync, email access, and approval emails.
-   **SharePoint**: Document library browsing and file management via Graph API.
-   **Teams**: Message linking to projects, tagging, and hot thread tracking.