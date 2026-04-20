# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform for a South African commercial and industrial (C&I) solar EPC company. Its primary purpose is to serve as a project-centric command center, replacing fragmented, Excel-based systems. The platform provides a single, trusted system for all roles to manage the entire project lifecycle, from engineering intake and development through construction, commissioning, finance tracking, and quality management.

The platform includes modules for Home, Company overview, Project Development, Project Delivery, HSE, Engineering, Quality, Finance, Reporting, Executive Priorities, and Admin.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo with `client/` (React SPA), `server/` (Express API), `shared/` (Drizzle schema), `migrations/`, `qa/` (testing), and `script/` directories.

### Frontend
- **Framework:** React 19 with TypeScript and Vite.
- **Routing:** `wouter` for SPA navigation.
- **Styling:** Tailwind CSS v4, `shadcn/ui` components (New York style) built on Radix UI, Lucide icons.
- **State Management:** TanStack React Query v5 for server state, local React state for UI.
- **Forms:** React Hook Form with Zod for validation.
- **Design:** CSS variables for theming, white-and-emerald light theme, Barlow, Inter, and JetBrains Mono fonts.

### Backend
- **Runtime:** Node.js with Express 5 and TypeScript.
- **API Style:** RESTful, grouped by domain.
- **Data Access:** Abstracted through repositories.
- **Validation:** Zod schemas and `validateBody` middleware.
- **Error Handling:** Centralized `ApiError` handling.
- **Session Management:** `express-session` for user roles.
- **Startup:** `startup-orchestrator.ts` for additive migrations and data seeding.
- **Work Item Management:** `public.work_items` is the canonical table.
- **Smart Import v2:** Processes `.xlsx` tracker workbooks using ExcelJS for parsing and an upsert/override pattern for project data.
- **Home "Do Next":** Provides ranked, role-aware action chips (approvals, red RAG, overdue tasks, blocked priorities) with server-persisted snooze/dismiss.
- **Canonical Phase Cycle:** A single, company-wide 10-stage lifecycle defined in `shared/phases.ts`. `Hold/Internal/Closed/TBC` are now `project_info.project_status`. DLP is `project_info.in_dlp`.

### Database Strategy
- **Dual-Mode:** Supports PostgreSQL (production) and SQLite (local development) based on `DATABASE_URL`.
- **ORM:** Drizzle ORM with Drizzle Kit for schema definition and additive SQL migrations.
- **Schema:** Source of truth is `shared/schema/*.ts`.
- **Snapshot Versioning:** Tables like `normalizedCostLines` use `effective_to` for snapshotting.

### Authentication & Authorization
- **Primary Auth:** Microsoft SSO via Azure MSAL, mapping MS accounts to internal users and roles.
- **Fallback Auth:** Username/password login using `bcryptjs`.
- **Role Management:** Authoritative role list in `shared/schema/users.ts`.
- **Server-side Enforcement:** `requireAuth` and `requireRole` middleware.
- **Security:** Azure Key Vault for secrets, encryption for sensitive fields.

### Microsoft 365 Integration
- Integrates with Outlook, Teams, and SharePoint using `@microsoft/microsoft-graph-client`.
- Includes a sync service for calendar events.
- Stores only metadata and deep links for emails and attachments.

### Opportunities Management Board
- `/opportunities` is the canonical Project Development working list.
- Columns display client, project, project developer, province, funding, estimated signature, deal value, engineering open tasks, next activity, stage, and action.
- Backed by `GET /api/opportunities/working` which joins user data and engineering ticket counts.
- Pipedrive custom fields are wired to `opportunities.province`, `estimated_kwp`, and `estimated_kwh`.

### Project Development Dashboard
- `/pd` provides an overview dashboard, distinct from the working list.
- Displays KPI cards (pipeline value/kWp, weighted pipeline, win rate, at-risk count), Pipeline by Stage, Active Funnel, Upcoming Activity, Recent Wins/Losses, and Risk Signals.
- Links to the unified Opportunity drawer for detailed views.

### Opportunity ↔ PD Ticket Merge
- "Pipedrive Opportunity" and "PD Ticket" are now a single user-facing "Opportunity" record.
- Pipedrive owns CRM fields (read-only); the app owns PD-workflow shadow (`pd_tickets`, editable).
- 1:1 link via `pd_tickets.opportunity_id`.
- 17 additive Pipedrive columns added to `opportunities` table, solely written by Pipedrive sync.
- Unified API at `/api/opportunities/:id/workflow` for lazy-creation, patching PD fields, spawning tasks, and converting to project.
- UI: `client/src/components/opportunities/OpportunityDrawer.tsx` is the canonical detail view, with CRM (sky accents) and PD (emerald) blocks.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright.
- **Release Gate:** `qa/release-gate.ts` script for critical test validation before release.

## External Dependencies

### Microsoft Azure / 365
- `@azure/msal-node`
- `@azure/identity`
- `@azure/keyvault-secrets`
- `@microsoft/microsoft-graph-client`
- SharePoint List (Engineering Support "Proposals Pipeline")

### Database
- PostgreSQL
- `better-sqlite3`
- Drizzle ORM + Drizzle Kit

### Frontend Libraries
- `shadcn/ui`
- Radix UI
- TanStack React Query v5
- TanStack Virtual
- React Hook Form + Zod
- Recharts
- ExcelJS
- DOMPurify

### Testing & QA
- Vitest
- Playwright

### Build & Dev Tools
- Vite
- tsx
- ESLint + Prettier

### Fonts
- Google Fonts (Barlow, Inter, JetBrains Mono)