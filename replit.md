# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for tracking and managing renewable energy projects. Its primary purpose is to provide real-time insights into project metrics, financial performance, and scheduling through the processing of Excel data. The application aims to enhance operational efficiency, streamline project oversight, and support strategic decision-making, aspiring to be a leading platform for renewable energy project management. Key capabilities include financial tracking, project and quality management, and advanced Smart Excel Import functionality. The business vision is to provide a comprehensive tool that simplifies complex project data into actionable intelligence, driving better outcomes in the renewable energy sector.

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
-   **Terminology**: All financial metrics use "Actual vs Costed" terminology, with "Costed" as the user-facing label for `budget_total`.
-   **Financial Year**: September to August, influencing all FY calculations.
-   **Project Detail Page**: Section-based navigation with pillars (Project Management, Engineering, Quality).
-   **Project Creation**: COO/CEO can create projects, auto-generating engineering stage templates.
-   **Portfolio Management**: Group projects under portfolios with client association. Portfolio Dashboard with four view modes (Project Management, Finance, Quality, Engineering) featuring Recharts visualizations and "Costed vs Actual" financial terminology. Portfolio Detail page with tabs for projects, finance, quality, engineering rollups, and rollout plans. Project assignment with COO-only move between portfolios.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy, PostgreSQL-backed sessions, role-based access control (RBAC), rate limiting, and granular permission middleware. Frontend `usePermission` hook fetches DB entity permission overrides. Admin Roles page (`/admin/roles`) redesigned with tab-based layout for Role Permissions, Project Detail Access, and User Management. Permission entities expanded to include `portfolios`, `notifications`, `subcontractors`, `cos_control`, `cashflow_forecast`, `home`.
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

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity, awarding points and badges for actions (task completion, approvals, reviews, imports).
-   **Penalty System**: Users lose points for negative behaviors like overdue tasks, projects behind schedule, quality failures, rejected deliverables, open quality warnings, overdue engineering tasks, unread notifications, and overdue QM tasks. Penalty badges are awarded for recurring issues.
-   **Levels**: 8 progression levels from Rookie to Titan.
-   **Frontend**: Dedicated `/leaderboard` page with rankings, badge display, activity breakdown, and penalty breakdown.

### Approvals Screen
-   **Module**: Consolidated view of user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Filtering**: Each user sees only applicable approvals based on roles or assignments. Admins (COO/CEO) can view all approvals.
-   **Actions**: Approve/reject functionality directly updates underlying records.

### Plan Change Tracker Confirmation
-   **Module**: Notifies Program Manager, Program Finance Manager, and Construction Manager about plan task data edits for confirmation in the Excel tracker.
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