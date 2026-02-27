# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application for tracking and managing renewable energy projects. It provides real-time insights into project metrics, financial performance, and scheduling through the processing of Excel data. The application aims to enhance operational efficiency, streamline project oversight, and support strategic decision-making, aspiring to be a leading platform for renewable energy project management with capabilities including financial tracking, project and quality management, and advanced Smart Excel Import.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design. Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Core Features**: Includes financial tracking with a COS Tracker, project and quality management, a 5-step Smart Excel Import wizard with re-run protection and font color extraction for status, and a Subcontractor Dashboard. Integrates with SharePoint Proposals Pipeline. Features a UX Guidance System, Project Awareness Bar, Business Alert Engine, and Weekly Review Wizard. Admin utilities include an Execution Cockpit, a redesigned sidebar, a Permission Gate System for role-based access, and Admin Roles & Permissions management. The TR Register module tracks cross-project action items. A PM Dashboard provides view-only project oversight.
-   **Portfolio Gantt Chart**: Enhanced with two-layer progress bars (light background for full timeline, solid fill for Act%), expected% tick markers, commissioning diamond markers, slippage warnings (red border + triangle for projects >5% behind), rich hover tooltips (PM, phase, size, dates, Act/Expected/delta, days remaining), sort controls (start date, end date, % complete, slippage, name), phase and PM filters, and a summary footer showing total projects, behind-schedule count, and commissioning-within-30-days count.
-   **Plan Management**: Full plan structuring system with hierarchical milestones (virtual and converted). Tasks can be grouped under milestones via Create Milestone, Group, Convert to Milestone, and Ungroup operations. Milestones auto-compute rollup values (earliest start, latest end, duration-weighted Act%). Structure stored as overrides in `project_plan_overrides` — Smart Import never overwrites user-defined hierarchy. `TaskGridView` supports inline hierarchy with expand/collapse, milestone-aware styling, and Create & Group flow.
-   **Terminology**: All financial metrics use "Actual vs Costed" terminology, with "Costed" as the user-facing label for `budget_total`.
-   **Financial Year**: September to August. All FY calculations and date-based logic adhere to this boundary.
-   **Project Detail Page**: Section-based navigation with pillars (Project Management, Engineering, Quality).
-   **Project Creation**: COO/CEO can create projects, auto-generating engineering stage templates.
-   **Portfolio Management**: Group projects under portfolios with client association. Portfolio Dashboard with four view modes (Project Management, Finance, Quality, Engineering) — each with insightful Recharts visualizations (bar charts for Costed vs Actual revenue/expenses, pie charts for phase distribution and schedule health, progress bars for quality/engineering completion). Finance uses "Costed vs Actual" terminology sourced from `programExpense.budgetTotal` and `programInflows.revenueAmount`. Portfolio Detail page with tabs for projects, finance rollups, quality rollups, engineering rollups, and rollout plans. Project assignment with COO-only move between portfolios. Nav links in PROJECT MANAGEMENT section.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy, PostgreSQL-backed sessions, role-based access control, rate limiting, and granular permission middleware. Includes specific roles like `PROJECT_DEVELOPER` and `PROJECT_MANAGER_SITE`. Frontend `usePermission` hook fetches DB entity permission overrides from `/api/auth/permissions` and checks them before falling back to static defaults. Admin Roles page (`/admin/roles`) redesigned with tab-based layout: Role Permissions (sidebar selector + category-grouped permission grid), Project Detail Access (per-tab view/edit controls), User Management (search, avatars, color-coded role badges). Permission entities expanded to include `portfolios`, `notifications`, `subcontractors`, `cos_control`, `cashflow_forecast`, `home`. Shared state across all tabs prevents data fragmentation.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM, ensuring transactional safety and reprocessing.
-   **Logic**: Pure-function modules for computations, automated backfill system for computed columns, and audit trails for data mutations.
-   **Automation**: Auto-archive for projects older than 90 days post-import.
-   **Calculations**: Consistent Act% (duration-weighted average) and Expected% (duration-weighted average with SA working days fallback) calculations across the application.

### Database Architecture
-   **Core Structure**: `project_info` as the central spine.
-   **Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks` are the primary data sources.
-   **Derived Data**: `derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary` tables exist but are NOT used by portfolio endpoints. All portfolio dashboards, rollups, timeline, and overview endpoints compute Act%/Expected%/delta and financial metrics live from underlying `project_plan`, `program_expense`, and `program_inflows` tables using `computeProjectCompletion()` (duration-weighted plan task calculation).

### Engineering Task Deliverables & Approval
-   **Deliverables**: Tasks support file deliverable attachments sent to specific recipients with acknowledgment tracking. `task_deliverables` table stores file, sender, recipient, acknowledgment status. Download endpoint at `/api/eng/deliverables/:id/download`.
-   **Approval Flow**: "Send for Approval" changes task status to NEEDS APPROVAL without requiring a specific approver. Approve/Request Changes/Reject actions available when task is in NEEDS APPROVAL status.

### Engineering Stage Management
-   **Module**: A 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, task/deliverable/approval management, and stage gate completion logic.
-   **SharePoint Integration**: Deliverable uploads include SharePoint sync folder path selection and display.
-   **Stage Gating**: Template-defined gate rules with COO override capability.
-   **Lifecycle Board Integration**: Engineering stages are auto-generated when a project moves on the company lifecycle board, which includes a "Gone" phase for lost deals.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style system with `ee_info_nodes`, `ee_info_edges`, `ee_info_assets` tables, providing SOP-enriched nodes for various processes.
-   **Walkthroughs**: 37 interactive step-by-step guides covering application functionality.
-   **Home Greeting System**: Role-based, randomized greetings.
-   **Home Action Hub**: Personalized home screen with stat cards (unread notifications, open tasks, pending approvals, overdue tasks), actionable sections for My Tasks (click-through to engineering), Pending Approvals (engineering gates, quality reviews, deliverables filtered by user/role), Notifications (action-required items + recent unread with mark-read), Company Priorities, and Quick Navigation links (role-filtered). Backend: `/api/home/action-hub` aggregates all data in a single call. Auto-refreshes every 60s.

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity across the platform, awarding points and badges for various actions (task completion, approvals, reviews, imports, etc.).
-   **Penalty System**: Users lose points for negative behaviors: overdue tasks (-5/ea), plans behind >15% (-3/ea, scoped to PM's projects), quality failures (-8/ea, scoped to PM's projects), rejected deliverables (-6/ea), open quality warnings (-4/ea), overdue engineering tasks (-6/ea), unread notifications older than 3 days (-2/ea), overdue QM tasks (-7/ea, scoped to PM's projects). Points floor at 0. Penalty badges: "Deadline Dodger" (5+ overdue), "Chronic Overdue" (10+ overdue), "Quality Concern" (5+ QC failures), "Engineering Slip" (3+ overdue eng tasks), "Engineering Bottleneck" (5+), "Inbox Pileup" (10+ unread 3d+), "Inbox Neglect" (20+), "QM Slipping" (3+ overdue QM), "QM Bottleneck" (5+). "Clean Record" badge awarded for zero penalties with 5+ tasks completed.
-   **Levels**: 8 progression levels from Rookie to Titan.
-   **Frontend**: Dedicated `/leaderboard` page with rankings, badge display, activity breakdown, and penalty breakdown. Penalty indicators shown on leaderboard rows, podium cards, user detail dialog, and "How Points Work" section.

### Approvals Screen
-   **Module**: Consolidated view of user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Filtering**: Each user sees only their applicable approvals — engineering gates by `approverUserId` or role match, quality reviews visible only to Quality Managers (not PMs), deliverables by `reviewerUserId` or `ownerUserId`. Admins (COO/CEO) see everything with a "Show All / Show Mine" toggle.
-   **Actions**: Approve/reject functionality directly updates underlying records.

### Plan Change Tracker Confirmation
-   **Module**: Notifies Program Manager, Program Finance Manager, and Construction Manager about plan task data edits (overrides or structure operations) for confirmation in the Excel tracker.
-   **Workflow**: Recipients can confirm, which auto-confirms related notifications.
-   **Triggers**: Edits to plan task fields and structure operations.

### Deploy Cache & Session Clearing
-   **Build Versioning**: Frontend detects new deployments and clears client-side cache/session.
-   **Server Sessions**: All PostgreSQL sessions are cleared on each production deploy.

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
-   **Microsoft Graph API**: For Outlook calendar integration.
-   **Read.ai**: For meeting data ingestion via webhooks.