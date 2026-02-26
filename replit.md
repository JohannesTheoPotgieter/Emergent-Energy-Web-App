# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for tracking and managing renewable energy projects. It provides real-time insights into project metrics, financial performance, and scheduling by processing project data from Excel files. The application aims to enhance operational efficiency, streamline project oversight, and support strategic decision-making, aspiring to be a leading platform for renewable energy project management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Framework**: React 18 with TypeScript.
-   **State Management**: TanStack React Query for server state, React Context for local state.
-   **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design.
-   **Data Visualization**: Recharts.
-   **Forms**: React Hook Form with Zod validation.
-   **Core Features**: Financial tracking, project and quality management, 5-step Smart Excel Import wizard, Subcontractor Dashboard, SharePoint Proposals Pipeline integration, UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, Admin utilities (Execution Cockpit, redesigned sidebar, Permission Gate System for role-based access, Weekly Reviews Page, Admin Roles & Permissions management). TR Register module tracks cross-project action items. Smart Import is the sole method for project creation/update, including re-run protection and font color extraction for COS/cashflow status. The Money tab includes a project-level **COS Tracker** showing expenditure items grouped by category with COS status and payment status. A **PM Dashboard** (`/pm-dashboard`) provides view-only project oversight for assigned project managers.
-   **Project Detail Page Architecture**: Uses a section-based navigation pattern with three pillars (Project Management, Engineering, Quality) on an Overview landing page. Clicking a pillar navigates to its dedicated section. **Project Management** section consolidates Tasks, Plan, Finance, and History. **Engineering** section has Tasks and Stages sub-tabs. **Quality** section shows the quality checklist. Engineering and Quality sections are accessed from overview pillar cards, not the main tab bar.
-   **Project Creation**: COO/CEO can create projects via `/project-create`, which auto-generates engineering stage templates based on `PHASE_TO_ENG_STAGES` mapping.

### Backend
-   **Framework**: Express.js with TypeScript.
-   **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions, supporting role-based access control and rate limiting.
-   **Permission Middleware**: `requirePermission(entity, action)` for API-level role-based access with 33 granular permission entities. Section-level access uses 7 consolidated keys, and project detail tab visibility is controlled by 15 `pd_` entities.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Data Integrity**: Transactional safety and reprocessing.
-   **Calculation Engine**: Pure-function modules for computations and data quality.
-   **Backfill System**: Automated population of computed columns and foreign keys on server startup.
-   **Audit Trails**: Immutable `change_sets` and `field_changes` for data mutations, plus detailed logs.

### Database Architecture
-   **Central Spine**: `project_info` is the primary table, with all modules linking via `project_id`.
-   **Normalized Data**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks` are the source of truth.
-   **Derived Tables**: `derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary` are rebuilt on demand.

### Engineering Stage Templates
-   **Module**: Implements a 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, task/deliverable/approval management, and stage gate completion logic.
-   **Tables**: `eng_stage_templates`, `eng_task_templates`, `eng_deliverable_templates` (template definitions); `project_eng_stages`, `project_eng_tasks`, `project_eng_deliverables`, `project_eng_approvals` (project instances). All link to `project_info` via `project_id`.
-   **Stage Gating**: Each template defines gate rules. COO can override stage completion with a mandatory reason.
-   **Lifecycle Board Integration**: Engineering stages are auto-generated based on `PHASE_TO_ENG_STAGES` mapping when a project moves on the company lifecycle board.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style knowledge base with Graph, Detail, Flow, and Walkthroughs tabs, backed by `ee_info_nodes` / `ee_info_edges` / `ee_info_assets` tables.
-   **Walkthroughs**: 37 interactive step-by-step guides covering all app functionality across various categories.
-   **Home Greeting System**: Role-based greetings that randomize between complimentary and sarcastic messages, with dad jokes on Fridays.

### Gamification System
-   **Module**: Badge and leaderboard system that tracks user activity across the platform and awards points and badges.
-   **Tables**: `user_badges` (earned badges with unique constraint on user_id + badge_key), `user_points` (activity point ledger).
-   **Points**: Computed from existing activity tables — `normalized_plan_tasks` (task completion), `project_eng_approvals` (approvals), `weekly_reviews`, `smart_import_runs`, `change_sets` (project updates), `qc_item_instance` (quality approvals), `project_eng_stages` (engineering stages).
-   **Badges**: 18 badge definitions in `BADGE_DEFINITIONS` across 8 categories (onboarding, tasks, approvals, reviews, data, imports, collaboration, streaks, quality, engineering). Badges auto-awarded on leaderboard fetch.
-   **Levels**: 8 levels from Rookie (0 pts) to Titan (6000 pts) with progress tracking.
-   **Frontend**: `/leaderboard` page with Rankings tab (top-3 podium + ranked list), Badges tab (all badges with earned state), and user detail dialog showing activity breakdown.

### Approvals Screen
-   **Module**: Consolidated admin view of all pending approvals across engineering gates, quality reviews, and deliverables.
-   **Tables**: Reads from `project_eng_approvals`, `qc_item_instance`, `deliverables`.
-   **Frontend**: `/admin/approvals` page with filter cards, approve/reject buttons, and confirmation dialog with reason field.
-   **Actions**: Approve/reject directly updates the underlying record via existing endpoints (eng-stage, quality, deliverable APIs).

### Deploy Cache & Session Clearing
-   **Build Versioning**: Unique `buildId` enables frontend to detect new deployments and clear client-side cache/session data.
-   **Server Session Clearing**: In production, all PostgreSQL sessions are cleared on each deploy.

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM.

### Authentication & Security
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing.

### File Processing
-   **exceljs**: Excel file parsing and writing.
-   **multer**: Handling `multipart/form-data`.

### Frontend Libraries
-   **@tanstack/react-query**: Data fetching and state management.
-   **recharts**: Declarative charting.
-   **date-fns**: Date utility library.
-   **zod**: Schema validation.
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.

### Third-Party Integrations
-   **Microsoft Graph API**: For Outlook calendar integration.
-   **Read.ai**: Meeting data ingestion via webhooks.