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
-   **Key Features**: Financial tracking, project and quality management, Smart Excel Import wizard, Subcontractor Dashboard, UX Guidance System, Project Awareness Bar, Business Alert Engine, Weekly Review Wizard, Execution Cockpit, Permission Gate System, TR Register, PM Dashboard, and a Gamification System (badges and leaderboards).
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
-   **Canonical Work Items Model**: Unifies legacy task-like tables into a single `work_items` table with a staged migration process and feature-flagged rollback capabilities. Includes dual-write to legacy and canonical tables during Smart Import.
-   **Engineering Task Deliverables & Approval**: Supports file attachments for tasks and an approval workflow for task status changes.
-   **Engineering Stage Management**: 5-stage engineering checklist system with templating, project stage instantiation, and stage gate completion, including SharePoint integration for deliverable uploads.
-   **Plan Change Tracker/Excel Sync Acknowledgment**: Notifies relevant managers about plan task data edits and project data changes, with notification deduplication.
-   **Global Audit Logging**: Centralized `server/audit-logger.ts` for fire-and-forget audit logging of all write endpoints.
-   **Roles & Permissions**: Enhanced admin page for managing granular entity permissions across 11 categories.
-   **Smart Import Enhancements**: Supports hierarchical plan task detection (e.g., WBS), milestone detection, and expanded plan synonyms. Detects re-creation of previously deleted projects.
-   **MS Object Sync**: Periodically syncs calendar, email, and Teams data from Microsoft Graph API into a local `ms_objects` table, with manual sync triggers.
-   **Email/Message to Task**: Enables creating project-linked operational tasks directly from Outlook emails or Teams messages.

### Database Architecture
-   **Core Structure**: `project_info` as the central entity, linked to `clients`.
-   **Primary Data Sources**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks`.
-   **Derived Data**: Metrics for portfolio dashboards are computed live from underlying tables.
-   **Canonical Work Items**: `work_items` table and supporting tables (`work_item_assignments`, `work_item_dependencies`, etc.) consolidate task-like entities.
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