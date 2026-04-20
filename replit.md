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

### Opportunities Management Board (2026-04-20)
- `/opportunities` is the canonical PD working list, rendered as a full management board. Columns: Client, Project (= Pipedrive `deal_name`), Project Developer (PD-shadow `pd_tickets.project_developer_user_id` overrides Pipedrive `deal_owner_name`), Province (`opportunities.province` ► falls back to `pd_tickets.province`), Funding (`opportunities.funding_type`), Est. Signature (`opportunities.expected_close_date` from Pipedrive), Deal Value (`estimated_value`), Eng. Open (count of engineering pd_tickets with status NOT IN ('Completed','Cancelled')), Next Activity (`next_activity_date` + subject), Stage, Action.
- Backed by `GET /api/opportunities/working` in `server/departments/opportunities-routes.ts` → `OpportunitiesRepository.getWorkingListRows` (joins users twice via `aliasedTable` for Pipedrive owner + PD developer override) and `getEngineeringTicketCounts` (filters `status NOT IN ('Completed','Cancelled')`).
- New column `opportunities.province` added by `migrations/20260420_opportunity_province.sql` (additive `IF NOT EXISTS`, backfilled from `pd_tickets.province` where joined). **Pipedrive sync does NOT yet write `province` or `funding_type`** — these need their Pipedrive custom-field hash IDs to be mapped in `server/services/pipedrive-sync-service.ts`. Until then, columns render whatever was previously stored or "—".

### Project Development Dashboard (2026-04-20)
- `/pd` is a true overview dashboard, **distinct** from the working list at `/opportunities`. Component: `client/src/pages/pd-dashboard.tsx`. Backed by `GET /api/pd/dashboard` (in `server/departments/opportunities-routes.ts`) — read-only aggregation over `opportunities` (uses the new Pipedrive enrichment cols: `weighted_value`, `probability`, `last_activity_date`, `next_activity_date`, `lost_reason`, `deal_owner_name`).
- Sections: KPI cards (active pipeline value/kWp, weighted pipeline, win rate, at-risk count) → Pipeline by Stage (value bars) + Active Funnel → Upcoming Activity (next 14d) + Recent Wins + Recent Losses → Risk Signals (stale > 30d, stale > 60d, high-value quiet > 14d, overdue follow-ups). Each list item links to `/opportunities?open=:id` so the unified Opportunity drawer opens for the deal. Permission: `pd_dashboard:view` (COO/CEO admin fallback covers everything).

### Opportunity ↔ PD Ticket merge (2026-04-20)
- **One concept, two surfaces.** What used to be "Pipedrive Opportunity" + "PD Ticket" is now a single user-facing record called "Opportunity". Pipedrive owns CRM fields (read-only in the UI); the app owns the PD-workflow shadow (`pd_tickets`, editable). 1:1 link via `pd_tickets.opportunity_id`, enforced by partial unique index `pd_tickets_opportunity_id_unique` (migrations/20260420_pd_tickets_opportunity_unique.sql).
- **17 additive Pipedrive columns** added to `opportunities` (deal_name, deal_owner_name, currency, pipedrive_updated_at, pipedrive_stage_changed_at, probability, weighted_value, lost_reason, lost_time, person_name, person_email, person_phone, activities_count, last_activity_date, next_activity_date, next_activity_subject, labels) — see `migrations/20260420_opportunity_merge_pipedrive_enrich.sql`. `deal_name` backfilled from the legacy `notes` `Pipedrive: …` hack. Pipedrive sync (`server/services/pipedrive-sync-service.ts`) is the sole writer for these.
- **Unified API** lives at `/api/opportunities/:id/workflow` (GET — lazy-creates the PD shadow on first read, race-safe via `onConflictDoNothing` + the unique index), `PATCH /api/opportunities/:id/pd` (whitelisted PD fields only — CRM fields rejected), `POST /api/opportunities/:id/spawn-tasks` (atomic: claims `tasks_spawned_at IS NULL` first then inserts inside a transaction; idempotent under retry), `POST /api/opportunities/:id/convert-to-project` (transactional; idempotent — returns existing project if already linked; uses `syncProjectSplitTablesAfterInsert` to materialise `phase=S01_FIRST_ASSESSMENT` + `ragStatus=green` in the split tables — `project_info` itself no longer has `stage_code`/`rag_status`). All three mutating routes require both `requirePermission("opportunities","edit")` and `canCreatePdTicket(role)`.
- **UI**: `client/src/components/opportunities/OpportunityDrawer.tsx` is the canonical detail view. Row click on `/opportunities` opens it; the legacy embedded "PD Tickets" sub-section + delete dialog were removed. CRM block uses sky accents (read-only signal); PD block uses emerald (editable). Embedded Convert-to-Project wizard lives inside the drawer.
- **Backend caveats still queued for cleanup**: nav still routes `/pd` → Opportunities (good); but the legacy `/api/pd/tickets`, `/api/pd/dashboard` and the SharePoint intake routes remain live as orphan storage — the workspace service still queries `pd_tickets` and `intake_requests`. Removal needs the workspace-service refactor noted below.

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