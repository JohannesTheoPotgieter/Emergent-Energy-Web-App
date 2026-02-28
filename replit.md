# Emergent Energy Dashboard — V1.0.0

## Overview
The Emergent Energy Dashboard (V1.0.0, released 28 February 2026) is a full-stack web application for managing renewable energy projects end-to-end. It covers project management with lifecycle tracking, financial oversight (COS, cashflow, revenue, expenditure), engineering operations (5-stage checklist, task board, deliverables), quality management, and cross-department collaboration (Teams chat, notifications, approvals). Integrated with Microsoft 365 (Outlook, SharePoint, Teams) via Azure AD SSO. See RELEASE_NOTES.md for full details.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Frameworks & Libraries**: React 18 with TypeScript, TanStack React Query, React Context.
-   **UI/UX**: `shadcn/ui` (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design, with Recharts for data visualization.
-   **Forms**: React Hook Form with Zod validation.
-   **Core Features**: Includes financial tracking with a COS Tracker, project and quality management, a 5-step Smart Excel Import wizard with re-run protection and font color extraction for status, and a Subcontractor Dashboard. Integrates with SharePoint Proposals Pipeline. Features a UX Guidance System, Project Awareness Bar, Business Alert Engine, and Weekly Review Wizard. Admin utilities include an Execution Cockpit, a redesigned sidebar, a Permission Gate System for role-based access, and Admin Roles & Permissions management. The TR Register module tracks cross-project action items. A PM Dashboard provides view-only project oversight.
-   **Portfolio Gantt Chart**: Enhanced with two-layer progress bars, commissioning markers, slippage warnings, rich hover tooltips, sort controls, phase and PM filters, and a summary footer.
-   **Plan Management**: Full plan structuring system with hierarchical milestones supporting Create Milestone, Group, Convert to Milestone, and Ungroup operations. Milestones auto-compute rollup values. `project_plan_overrides` store user-defined hierarchy, ensuring Smart Import does not overwrite it. `TaskGridView` supports inline hierarchy.
-   **Project Detail Page**: Section-based navigation with pillars (Project Management, Engineering, Quality, Collaboration). Overview shows pillar cards with summary metrics. Collaboration section houses Chat, SharePoint Files, project-scoped Approvals & Deliverables, and project-scoped Notifications as sub-tabs.
-   **Project Overview Summaries**: Expenditure Breakdown card (Actual vs Costed by category with dual progress bars, variance, and color-coded budget alerts) and Project Plan summary card (task progress, overdue/upcoming task list, RAG status) displayed on the overview section between pillar cards and Financial Integration panel.
-   **Terminology**: All financial metrics use "Actual vs Costed" terminology, with "Costed" as the user-facing label for `budget_total`.
-   **Financial Year**: September to August, influencing all FY calculations.
-   **Project Creation**: COO/CEO can create projects, auto-generating engineering stage templates.
-   **Portfolio Management**: Group projects under portfolios with client association. Portfolio Dashboard with four view modes (Project Management, Finance, Quality, Engineering) featuring Recharts visualizations and "Costed vs Actual" financial terminology. Portfolio Detail page with tabs for projects, finance, quality, engineering rollups, and rollout plans. Project assignment with COO-only move between portfolios.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy + Microsoft 365 SSO via `@azure/msal-node`. PostgreSQL-backed sessions, role-based access control (RBAC), rate limiting, and granular permission middleware. Microsoft login maps Azure AD identity to existing users by email/username and stores `microsoft_id` on users table. Frontend `usePermission` hook fetches DB entity permission overrides. Admin Roles page (`/admin/roles`) redesigned with tab-based layout for Role Permissions, Project Detail Access, and User Management. Permission entities expanded to include `portfolios`, `notifications`, `subcontractors`, `cos_control`, `cashflow_forecast`, `home`, `teams_chat`, `financial_integration`, `pd_collaboration`, `operational_tasks`, `gamification`.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM, ensuring transactional safety and reprocessing.
-   **Logic**: Pure-function modules for computations, automated backfill system for computed columns, and audit trails for data mutations.
-   **Automation**: Auto-archive for projects older than 90 days post-import.
-   **Calculations**: Consistent Act% and Expected% calculations across the application.

### Database Architecture
-   **Core Structure**: `project_info` as the central spine.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`.
-   **Derived Data**: `derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary` tables exist but are not used by portfolio endpoints. All portfolio dashboards compute metrics live from underlying `project_plan`, `program_expense`, and `program_inflows` tables using `computeProjectCompletion()`.

### Engineering Task Deliverables & Approval
-   **Deliverables**: Tasks support file deliverable attachments with specified recipients and acknowledgment tracking.
-   **Approval Flow**: "Send for Approval" changes task status to NEEDS APPROVAL. Approve/Request Changes/Reject actions are available.

### Engineering Stage Management
-   **Module**: A 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, task/deliverable/approval management, and stage gate completion logic.
-   **SharePoint Integration**: Deliverable uploads include SharePoint sync folder path selection and display.
-   **Stage Gating**: Template-defined gate rules with COO override capability.
-   **Lifecycle Board Integration**: Engineering stages are auto-generated when a project moves on the company lifecycle board.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style system with `ee_info_nodes`, `ee_info_edges`, `ee_info_assets` tables, providing SOP-enriched nodes for various processes.
-   **Operating System Map**: Integrated into the `/ee-info` page with tabs for Operating System, Templates, and Walkthroughs. The OS tab provides Lifecycle Overview, Department Drilldown, and Process Detail with structured SOPs.
-   **Walkthroughs**: 37 interactive step-by-step guides covering application functionality.
-   **Home Greeting System**: Role-based, randomized greetings.
-   **Home Action Hub**: Personalized home screen with stat cards, actionable sections for My Tasks, Pending Approvals, Notifications, Company Priorities, and Quick Navigation links.
-   **Interactive Tutorial**: Spotlight-style onboarding tour that auto-starts for new users. Highlights 9 key dashboard features (search, projects, priority queue, stats, tasks, notifications, sidebar). Integrated with the guidance system via `use-guidance.ts`. Accessible with keyboard navigation and ARIA attributes. Replayable via "Take a Tour" button on home page.
-   **Context-Aware Screen Tours**: Floating "Take a Tour" button (bottom-right) on every major page. Each screen has its own tour steps defined in `client/src/data/screen-tours.ts`, covering 20+ pages (Execution Dashboard, Projects, Engineering, Quality, COS, Cashflow, Lifecycle Board, Smart Import, Collaboration Hub, Portfolios, PM Dashboard, Leaderboard, Teams Chat, Notifications, EE Info, Weekly Reviews, My Tool, Subcontractors, Admin Roles, Project Detail, Portfolio Detail). The `InteractiveTutorial` component accepts external steps via `externalSteps` prop. Home page keeps its own dedicated role-based tour.

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity, awarding points and badges for actions (task completion, approvals, reviews, imports).
-   **Penalty System**: Users lose points for negative behaviors like overdue tasks, projects behind schedule, quality failures, rejected deliverables, open quality warnings, overdue engineering tasks, unread notifications, and overdue QM tasks. Penalty badges are awarded for recurring issues.
-   **Levels**: 8 progression levels from Rookie to Titan.
-   **Frontend**: Dedicated `/leaderboard` page with rankings, badge display, activity breakdown, and penalty breakdown.

### Approvals Screen
-   **Module**: Consolidated view of user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Filtering**: Each user sees only applicable approvals based on roles or assignments. Admins (COO/CEO) can view all approvals.
-   **Actions**: Approve/reject functionality directly updates underlying records.

### Teams Chat Groups
-   **Module**: MS Teams-styled channel-based group chat system with department and project channels, file sharing, and member management.
-   **DB Tables**: `teams_chat_groups`, `teams_chat_members`, `teams_chat_messages` with file attachment fields (`file_name`, `file_path`, `file_size`, `file_type`).
-   **Backend**: CRUD routes for groups, members, messages, and file uploads via multer (25MB limit). Membership checks on send/upload. Files served from `/uploads/chat-files/`.
-   **Frontend**: MS Teams-inspired UI at `/teams/chats` with dark sidebar, channel list, message bubbles with avatars, date separators, file attachments with inline image preview, and members panel.
-   **Access**: COO/CEO can manage any channel. PMs can manage project channels for their projects. Group admins and creators can manage their channels.

### Plan Change Tracker Confirmation
-   **Module**: Notifies Program Manager, Program Finance Manager, and Construction Manager about plan task data edits for confirmation in the Excel tracker.
-   **Workflow**: Recipients can confirm, which auto-confirms related notifications.
-   **Triggers**: Edits to plan task fields and structure operations.

### Email/Message to Task
-   **Module**: Create project-linked operational tasks directly from Outlook emails or Teams messages.
-   **Endpoint**: `POST /api/outlook/email-to-task` with `targetType: "operational_new"` creates an `operational_task` linked to a project, with assignee, priority, and due date.
-   **Email Link**: Each task maintains a traceable link back to the source email/message via `mytool_email_links`.
-   **Notifications**: Assignee receives a notification when a task is created and assigned to them.
-   **UI**: `CreateTaskFromSourceDialog` reusable component with project search, user assignment, priority, and due date fields. Integrated into the Triage Inbox and All Emails tab.
-   **Access**: Admin-only. Backend validates project existence before task creation.

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
-   **Microsoft Graph API**: For Outlook calendar, SharePoint, and Teams integration.
-   **Read.ai**: For meeting data ingestion via webhooks.

### Microsoft Integration
-   **Outlook**: Connected via Replit Connector (OAuth). Powers calendar sync, email access, approval emails.
-   **SharePoint**: Document library browsing and file management via Graph API. Admin configures site/drive.
-   **Teams**: Message linking to projects, tagging, hot thread tracking.
-   **Status Endpoint**: `/api/ms-integration/status` (any authenticated user) returns consolidated status for all three services.
-   **Admin Settings**: `/api/admin/ms-integration` endpoints (admin-only) for feature flags, SharePoint site config, Teams thresholds.
-   **User Access**: All users can view integration status at `/settings/integrations`. Admins manage settings at `/admin/ms-integration`.
-   **Admin Routes**: Registered via `registerAdminRoutes()` from `server/departments/admin-routes.ts` in `server/index.ts`.

## UX Quick Wins (Implemented)

### E1. Priority Queue on Home
- Combined overdue tasks, action-required notifications, and pending approvals into a single "Your Priority Queue" section
- Sorted by urgency (overdue tasks by days late > action required > approvals), max 5 items
- Rendered between action banner and stat cards on home page

### E2. Overdue Visual Escalation
- Red left border (`border-l-4 border-l-red-500`) on overdue items across TaskItem (home), PD Tickets
- "Xd overdue" destructive badge on overdue tasks and PD ticket rows
- Overdue PD tickets sorted to top of filtered results

### E3. Stale Data Warning
- Backend: `last_import_at` field added to `/api/projects-summary` from `smart_import_runs` latest committed date
- Frontend: Yellow warning badge on project cards when last import > 14 days ago

### E4. COS Exception Highlighting
- Threshold-based variance coloring in COS Tracker:
  - Within ±15%: standard red/green
  - ±15% to ±25%: amber text + amber background
  - Beyond ±25%: dark red text + red background
- Applied to both variance amount and variance % rows

### E5. Quick Navigation
- Last visited project tracked in localStorage from project detail page
- "Continue with [Project Name]" quick-link on home page (validated against active projects)