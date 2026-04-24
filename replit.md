# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform designed for a South African commercial and industrial (C&I) solar EPC company. It centralizes the entire project lifecycle management, from engineering and development to construction, commissioning, finance tracking, and quality assurance. The platform replaces disparate, Excel-based systems, aiming to enhance efficiency, consolidate data, and provide comprehensive insights to support business growth and market leadership in the C&I solar sector.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo, separating client-side (React SPA), server-side (Express API), shared code (Drizzle schema), database migrations, QA, and scripting concerns into distinct directories.

### Frontend
- **Framework & Tooling:** React 19 with TypeScript, powered by Vite.
- **Routing:** `wouter` for single-page application navigation.
- **Styling & Components:** Tailwind CSS v4, `shadcn/ui` components (New York style) built on Radix UI, and Lucide icons for a consistent and professional UI/UX.
- **State Management:** TanStack React Query v5 manages server state, while local React state handles UI-specific data.
- **Forms:** React Hook Form is used for form management, with Zod for validation.
- **Design:** The application features a white-and-emerald light theme, using CSS variables for theming and a combination of Barlow, Inter, and JetBrains Mono fonts.

### Backend
- **Runtime & Framework:** Node.js with Express 5 and TypeScript.
- **API Design:** RESTful API organized by domain, utilizing a repository pattern for data access.
- **Validation & Error Handling:** Zod schemas and `validateBody` middleware ensure robust input validation, complemented by centralized `ApiError` handling.
- **Authentication:** `express-session` manages user sessions and roles.
- **Data Initialization:** `startup-orchestrator.ts` manages additive migrations and data seeding.
- **Smart Import v2:** Supports importing `.xlsx` tracker workbooks, parsing with ExcelJS, and applying an upsert/override strategy for project data, including preflight validation.
- **Financial Reconciliation:** Features read-only interfaces for reconciling QuickBooks data with internal cost trackers (COS Tracker Tracker-Gap Reconciliation UI, COS Tracker QB → Project Resolver) and managing QuickBooks vendor mappings.
- **Revenue Recognition:** Implements a Canonical Revenue Recognition system based on `normalized_cost_lines` and integrates with QuickBooks Revenue (account `1000000 Sales`).
- **COS Tracker Past-Month Auto-Promote:** Automates the 'Realised' status for past month cost lines with invoice numbers to align with QuickBooks.
- **Home "Do Next":** Provides role-aware, ranked action items with snooze/dismiss functionality.
- **Canonical Phase Cycle:** Defines a company-wide 10-stage project lifecycle (`shared/phases.ts`), including a new `S04_PLANNING` stage.
- **Priority Linked Progress:** Allows `effectiveProgress` of priorities to be driven by various sources (e.g., `project_phase`, `derived_project_kpis`, `milestone_revenue`, `tasks_rollup`).
- **Priorities UI Overhaul:** Streamlines priority management with unified add/edit dialogs, improved field parity, and role-based access controls for creating and editing priorities.
- **Opportunities Management Board:** Centralizes project development activities under `/opportunities` with List, Kanban, and Calendar views. Features role-scoped access and integrates with Pipedrive custom fields.
- **Project Development Dashboard:** Provides an overview of PD KPIs, pipeline status, and risk signals.
- **Engineering Ticket Tracking:** Integrates engineering ticket tracking directly into the Opportunity Drawer, displaying ticket status, age, due dates, owners, and comments, with server-side logic for ticket summaries and client-side UX for quick access and skip-mapping. Each ticket also renders a **mini engineering task board** of its spawned `work_items` grouped by `phase` with status dots and the assigned engineer (server `COALESCE(users.name, work_items.owner_name)`); fetched in one batched `inArray(workItems.pdTicketId, …)` query (no N+1). When any ticket has a linked project, the "Convert to project" CTA auto-resolves to a green "Project linked" confirmation card with a deep link to `/project/<projectName>` (both id+name sourced from the same ticket so the link is always coherent; the shadow PD row is filtered to `project_id IS NULL` so it never contributes a stale link).
- **Opportunities Working List Hardening:** Enhances the opportunities working list with server-side authoritative gating, deep-link support, Pipedrive sync indicators, sortable columns, and refined engineering badges. Includes a partial unique index migration for Pipedrive deal IDs.
- **Opportunity ↔ PD Ticket Merge:** Unifies Pipedrive opportunities and PD tickets into a single `Opportunity` record, managing CRM fields (read-only from Pipedrive) and internal PD workflow data within the application.

### Database Strategy
- **Dual-Mode:** Supports PostgreSQL for production and SQLite for local development.
- **ORM:** Drizzle ORM is used for schema definition, with Drizzle Kit for additive SQL migrations.
- **Schema Source of Truth:** `shared/schema/*.ts`.
- **Snapshot Versioning:** Uses `effective_to` for versioning select tables.

### Authentication & Authorization
- **Primary:** Microsoft SSO via Azure MSAL, mapping MS accounts to internal users and roles.
- **Fallback:** Username/password authentication using `bcryptjs`.
- **Role Management:** Authoritative role list defined in `shared/schema/users.ts`.
- **Security:** Server-side enforcement with `requireAuth` and `requireRole` middleware, Azure Key Vault for secrets, and encryption for sensitive data.

### Microsoft 365 Integration
- Integration with Outlook, Teams, and SharePoint using `@microsoft/microsoft-graph-client`. A sync service stores calendar event metadata and deep links for emails and attachments.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright.
- **Release Gate:** `qa/release-gate.ts` script ensures critical test validation.

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
- Drizzle ORM
- Drizzle Kit

### Frontend Libraries
- `shadcn/ui`
- Radix UI
- TanStack React Query v5
- TanStack Virtual
- React Hook Form
- Zod
- Recharts
- ExcelJS
- DOMPurify

### Testing & QA
- Vitest
- Playwright

### Build & Dev Tools
- Vite
- tsx
- ESLint
- Prettier

### Fonts
- Google Fonts (Barlow, Inter, JetBrains Mono)

- **PD Dashboard – Pipeline by Phase + Sign-Date Calendar (Task #77):** `/pd-dashboard` now renders a "Pipeline by phase" KPI card (per-canonical-phase opportunity count, total kWp, total deal value, with an in-row share-of-kWp bar) and an "Expected sign dates" month calendar directly above the existing PD operating board. Both share a single read-only fetch from `GET /api/pd/dashboard/pipeline-by-phase` (auth-gated: `requirePermission('pd_dashboard','view')`), which excludes won/lost, soft-deleted opportunities, and opportunities tied to soft-deleted clients. Phases are derived via `pdStageToLifecycle` (Pipedrive CRM stage → canonical S-code); unmapped stages bucket as `_UNSCOPED` so nothing silently disappears. The calendar reuses `OpportunitiesCalendar` and `OpportunityDrawer` from `/opportunities` for visual + interaction parity. Both new sections use the existing `CollapsibleCard` (per-user open/closed state in localStorage). Integration test `qa/tests/integration/pd-dashboard-pipeline-by-phase.test.ts` is wired into `qa/release-gate.ts`. Pure additive — zero schema changes.

- **Pending Approval Inbox:** App-wide queue (`pending_approvals` table, migration `0028_pending_approvals.sql`) that intercepts every scheduled / sync / seed write so nothing is auto-created. Writers stage proposals via `proposeApproval()` (server/services/pending-approvals-service.ts), per-`kind` apply handlers replay payloads on release, and a partial unique index on `(kind, source_ref) WHERE status='pending'` prevents duplicate proposals when sync re-runs. UI at `/pending-approvals` (approver roles: ADMIN, CCO, CFO, DIRECTOR, PROJECT_DEVELOPER). Initial wiring covers Pipedrive opportunity create, SharePoint intake_request + project_info shell create, and COS period auto-lock; remaining writers (Smart Import, monthly report snapshots, EE info-updates seed, Pipedrive client create) follow in separate tasks.

## Runbooks
- `docs/runbooks/foundation-linkage-hardening-2026-04-22.md` — Task #34 hardened the live data spine (opportunities → project_info → pd_tickets → work_items): migration `0019_foundation_linkage_hardening.sql` adds `pd_tickets.deleted_at`, FK `work_items.pd_ticket_id → pd_tickets.id ON DELETE SET NULL`, and partial indexes; cascade-display filters apply across all read paths; soft-delete-only DELETE handler with audit log; `GET /api/project-development/workspace/rollup` powers the Meeting view UI section on `/pd-dashboard`. Integration test: `qa/tests/integration/foundation-linkage-cascades.test.ts` (wired into `qa/release-gate.ts`).