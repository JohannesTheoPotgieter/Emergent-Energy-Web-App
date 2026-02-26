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
-   **Plan Management**: Editable plan tasks, milestone structuring (create, group, ungroup, convert), and task deletion with persistence via frontend overrides.
-   **Terminology**: All financial metrics use "Actual vs Costed" terminology, with "Costed" as the user-facing label for `budget_total`.
-   **Financial Year**: September to August. All FY calculations and date-based logic adhere to this boundary.
-   **Project Detail Page**: Section-based navigation with pillars (Project Management, Engineering, Quality).
-   **Project Creation**: COO/CEO can create projects, auto-generating engineering stage templates.

### Backend
-   **Frameworks & Libraries**: Express.js with TypeScript.
-   **Authentication & Authorization**: Passport.js with local strategy, PostgreSQL-backed sessions, role-based access control, rate limiting, and granular permission middleware. Includes specific roles like `PROJECT_DEVELOPER` and `PROJECT_MANAGER_SITE`.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM, ensuring transactional safety and reprocessing.
-   **Logic**: Pure-function modules for computations, automated backfill system for computed columns, and audit trails for data mutations.
-   **Automation**: Auto-archive for projects older than 90 days post-import.
-   **Calculations**: Consistent Act% (duration-weighted average) and Expected% (duration-weighted average with SA working days fallback) calculations across the application.

### Database Architecture
-   **Core Structure**: `project_info` as the central spine.
-   **Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks` are the primary data sources.
-   **Derived Data**: `derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary` are rebuilt on demand.

### Engineering Stage Management
-   **Module**: A 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, task/deliverable/approval management, and stage gate completion logic.
-   **SharePoint Integration**: Deliverable uploads include SharePoint sync folder path selection and display.
-   **Stage Gating**: Template-defined gate rules with COO override capability.
-   **Lifecycle Board Integration**: Engineering stages are auto-generated when a project moves on the company lifecycle board, which includes a "Gone" phase for lost deals.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style system with `ee_info_nodes`, `ee_info_edges`, `ee_info_assets` tables, providing SOP-enriched nodes for various processes.
-   **Walkthroughs**: 37 interactive step-by-step guides covering application functionality.
-   **Home Greeting System**: Role-based, randomized greetings.

### Gamification System
-   **Module**: Badge and leaderboard system tracking user activity across the platform, awarding points and badges for various actions (task completion, approvals, reviews, imports, etc.).
-   **Levels**: 8 progression levels from Rookie to Titan.
-   **Frontend**: Dedicated `/leaderboard` page with rankings, badge display, and activity breakdown.

### Approvals Screen
-   **Module**: Consolidated view of user-specific pending approvals from engineering gates, quality reviews, and deliverables.
-   **Filtering**: Each user sees only their applicable approvals — engineering gates by `approverUserId` or role match, quality reviews assigned to the project's PM (via `pmUserId` on `project_info`) with Quality Managers also seeing all, deliverables by `reviewerUserId` or `ownerUserId`. Admins (COO/CEO) see everything with a "Show All / Show Mine" toggle.
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