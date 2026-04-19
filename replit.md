# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform designed for a South African commercial and industrial (C&I) solar EPC company. It functions as a project-centric command center, replacing fragmented, Excel-based systems. The platform's core purpose is to provide a single, trusted system for all roles (COO, CFO, Project Managers, Engineers, etc.) to manage the entire project lifecycle, from engineering intake and development through construction, commissioning, finance tracking, and quality management.

Key functional modules span Home, Company overview, Project Development, Project Delivery, HSE, Engineering, Quality, Finance, Reporting, Executive Priorities, and Admin, ensuring comprehensive oversight and management across the organization.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo with distinct `client/` (React SPA), `server/` (Express API), `shared/` (Drizzle schema), `migrations/`, `qa/` (testing), and `script/` directories. Aliases (`@/`, `@shared/`, `@assets/`) are used for cleaner imports.

### Frontend
- **Framework:** React 19 with TypeScript, bundled by Vite.
- **Routing:** Lightweight `wouter` for SPA navigation.
- **Styling:** Tailwind CSS v4, `shadcn/ui` (New York style) components built on Radix UI primitives, Lucide icons.
- **State Management:** TanStack React Query v5 for server state, local React state for UI.
- **Forms:** React Hook Form with Zod schemas for validation.
- **Design:** CSS variables for theming, white-and-emerald light theme, specific font stack (Barlow, Inter, JetBrains Mono).

### Backend
- **Runtime:** Node.js with Express 5, TypeScript. `tsx` for development, compiled to CJS for production.
- **API Style:** RESTful, grouped by domain. New routes use `server/routes/<domain>.routes.ts`.
- **Data Access:** All database operations are abstracted through `server/repositories/*`.
- **Validation:** Zod schemas and `validateBody` middleware for request body validation.
- **Error Handling:** Centralized `ApiError` handling to return consistent JSON errors without exposing sensitive details.
- **Session Management:** `express-session` storing user roles.
- **Startup:** `startup-orchestrator.ts` manages additive migrations and data seeding based on feature flags.
- **Key Tables:** `public.work_items` is the canonical table for work items.
- **Smart Import v2:** A core workflow for processing `.xlsx` tracker workbooks, using ExcelJS for parsing and a sophisticated upsert/override pattern to manage project data.
- **Home "Do Next":** `GET /api/home/do-next` returns ranked, role-aware action chips (approvals, red RAG, overdue tasks, blocked priorities) with server-persisted snooze/dismiss in `do_next_state`. Role is taken from the authenticated session only — the `x-company-role` simulator header is ignored for visibility decisions.
- **Canonical Phase Cycle (2026-04-20):** ONE company-wide 10-stage lifecycle is the source of truth — defined in `shared/phases.ts` (`PHASES` const). The 10 stages in display order: First Assessment, Design & Cost Proposal, Financial Close, Planning, Construction, Commissioning, O&M Handover, Client Handover, Compliance Handover, Post-Handover Review. DB stage_codes preserved for historical references; new codes `S04_PLANNING` and `S9B_COMPLIANCE_HANDOVER` added. `Hold/Internal/Closed/TBC` are no longer phases — they live on `project_info.project_status` (text, default 'active'). DLP is a flag `project_info.in_dlp` (boolean) that auto-forces RAG to red while the project is in any handover phase. Legacy constants `LIFECYCLE_PHASES`, `PROJECT_PHASES`, `PROJECT_PHASE_LABELS`, `PHASE_TO_ENG_STAGES`, `PHASE_TO_STAGE` are retained as deprecated transitional shims with the legacy labels still in the type union for compile-time tolerance, but the DB no longer stores them. New code must import from `shared/phases.ts` and use `resolveCanonicalPhase` / `resolveCanonicalCode` for any string-to-stage normalisation. Migration file: `migrations/20260420_canonical_phase_cycle.sql`.

### Database Strategy
- **Dual-Mode:** Supports PostgreSQL (production) and SQLite (local development/Replit fallback) based on `DATABASE_URL` environment variable.
- **ORM:** Drizzle ORM with Drizzle Kit for schema definition and migrations.
- **Schema:** Source of truth is `shared/schema/*.ts` files, with `shared/schema.ts` as a barrel re-export.
- **Migrations:** Additive-only SQL migrations located in `/migrations/` at the repo root, enforced with `IF NOT EXISTS` guards.
- **Snapshot Versioning:** Several tables (e.g., `normalizedCostLines`, `normalizedRevenueLines`) use `effective_to` for snapshot versioning; queries must include `effective_to IS NULL` to ensure correctness.

### Authentication & Authorization
- **Primary Auth:** Microsoft SSO via Azure MSAL, mapping MS accounts to internal user records and roles.
- **Fallback Auth:** Username/password login using `bcryptjs`.
- **Role Management:** Authoritative role list defined in `shared/schema/users.ts`.
- **Server-side Enforcement:** `requireAuth` and `requireRole` middleware enforce access control.
- **Security:** Azure Key Vault for secret management in production, encryption for sensitive bank detail fields.

### Microsoft 365 Integration
- Utilizes `@microsoft/microsoft-graph-client` for integration with Outlook, Teams, and SharePoint.
- Includes a sync service (`server/ms-sync-service.ts`) for calendar events.
- Data storage policy prohibits storing full email bodies or attachment content; only metadata and deep links are stored.

### Project Development module — Pipedrive is the source of truth (2026-04-19)
- Pipedrive replaces both legacy intake paths. The **Opportunities** page (`/opportunities`) is the canonical PD work queue; `/pd` now resolves to the same Opportunities page.
- **PD Tickets UI removed**: pages `pd-tickets.tsx`, `pd-ticket-create.tsx`, `pd-ticket-detail.tsx`, `pd-reports.tsx` deleted. Legacy deep links `/pd/tickets`, `/pd/tickets/create`, `/pd/tickets/:id`, `/pd/reports` are alias-redirected to `/opportunities`.
- **SharePoint Proposals Pipeline UI removed**: no nav entries reference SharePoint intake. Backend SharePoint sync routes (`server/sharepoint*.ts`, `server/intake-connector.ts`, `server/sync-routes.ts` SharePoint endpoints, `server/routes/pd-intake.routes.ts`, `server/engineering-intake-routes.ts`) and the PD Tickets API (`server/pd-routes.ts`) remain **deliberately live**. The Opportunities page itself reads from `/api/pd/tickets` to surface "retired" historical tickets alongside Pipedrive opportunities, so deleting the backend would break Opportunities. Quality and handover routes also depend on `getProjectDevelopmentWorkspace` which queries `pd_tickets` and `intake_requests`. **Backend full removal is queued as a follow-up** — it requires refactoring `server/services/project-development-workspace-service.ts` (currently exposes `workspace.tickets` + `workspace.intake` consumed by quality/handover) and dropping the SharePoint section from `shared/integration-boundaries.ts` and `shared/schema/integrations.ts`. DB tables (`pd_tickets`, `intake_requests`, `intake_tasks`) are retained as orphan storage; no destructive drop.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright for browser-based end-to-end testing.
- **Release Gate:** A `qa/release-gate.ts` script ensures critical tests pass before any release.

## External Dependencies

### Microsoft Azure / 365
- **`@azure/msal-node`**: Azure AD / MS SSO.
- **`@azure/identity`**: Azure credential management.
- **`@azure/keyvault-secrets`**: Secret retrieval.
- **`@microsoft/microsoft-graph-client`**: MS Graph API for Outlook, Teams, SharePoint.
- **SharePoint List**: Engineering Support "Proposals Pipeline."

### Database
- **PostgreSQL**: Production database.
- **`better-sqlite3`**: SQLite for local development.
- **Drizzle ORM + Drizzle Kit**: Schema management and querying.

### Frontend Libraries
- **`shadcn/ui`**: Component library.
- **Radix UI**: UI primitives.
- **TanStack React Query v5**: Server state management.
- **TanStack Virtual**: Virtualized lists.
- **React Hook Form + Zod**: Forms and validation.
- **Recharts**: Charting.
- **ExcelJS**: Server-side Excel parsing.
- **DOMPurify**: HTML sanitization.

### Testing & QA
- **Vitest**: Unit and API tests.
- **Playwright**: End-to-end browser tests.

### Build & Dev Tools
- **Vite**: Frontend bundler.
- **tsx**: TypeScript execution.
- **ESLint + Prettier**: Code quality.

### Fonts
- **Google Fonts**: Barlow, Inter, JetBrains Mono.