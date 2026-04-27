# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform for a South African commercial and industrial (C&I) solar EPC company. It centralizes project lifecycle management from engineering to commissioning, finance, and quality assurance. The platform aims to improve efficiency, consolidate data, and provide insights to support business growth and market leadership in the C&I solar sector by replacing disparate, Excel-based systems.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project uses a monorepo structure, separating client (React SPA), server (Express API), shared code (Drizzle schema), database migrations, QA, and scripting.

### Frontend
- **Framework & Tooling:** React 19 with TypeScript and Vite.
- **Routing:** `wouter` for SPA navigation.
- **Styling & Components:** Tailwind CSS v4, `shadcn/ui` components (New York style) based on Radix UI, and Lucide icons.
- **State Management:** TanStack React Query v5 for server state, local React state for UI-specific data.
- **Forms:** React Hook Form with Zod for validation.
- **Design:** White-and-emerald light theme using CSS variables, with Barlow, Inter, and JetBrains Mono fonts.

### Backend
- **Runtime & Framework:** Node.js with Express 5 and TypeScript.
- **API Design:** RESTful API with a repository pattern.
- **Validation & Error Handling:** Zod schemas and `validateBody` middleware, centralized `ApiError` handling.
- **Authentication:** `express-session` for user sessions and roles.
- **Data Initialization:** `startup-orchestrator.ts` for additive migrations and data seeding.
- **Smart Import v2:** Imports `.xlsx` tracker workbooks with ExcelJS, applying upsert/override strategies and preflight validation for project data.
- **Financial Reconciliation:** Read-only interfaces for reconciling QuickBooks data with internal cost trackers and managing vendor mappings.
- **Revenue Recognition:** Implements a Canonical Revenue Recognition system based on `normalized_cost_lines` and integrates with QuickBooks Revenue.
- **COS Tracker Past-Month Auto-Promote:** Automates 'Realised' status for past month cost lines with invoice numbers.
- **Home "Do Next":** Role-aware, ranked action items with snooze/dismiss functionality.
- **Canonical Phase Cycle:** Defines a 12-phase project lifecycle (`shared/phases.ts`) including 10 sequential phases and 2 terminal branches (`S_HOLD`, `S_DONE`).
- **Priority Linked Progress:** Allows `effectiveProgress` of priorities to be driven by various data sources (e.g., `project_phase`, `derived_project_kpis`).
- **Priorities UI Overhaul:** Streamlined priority management with unified add/edit dialogs, improved field parity, and role-based access controls.
- **Opportunities Management Board:** Centralizes project development activities under `/opportunities` with List, Kanban, and Calendar views, featuring role-scoped access and Pipedrive integration.
- **Project Development Dashboard:** Provides an overview of PD KPIs, pipeline status, and risk signals.
- **Engineering Ticket Tracking:** Integrated into the Opportunity Drawer, displaying ticket status, age, due dates, owners, and comments, with a mini engineering task board for `work_items`.
- **Opportunities Working List Hardening:** Enhances the opportunities working list with server-side authoritative gating, deep-link support, Pipedrive sync indicators, sortable columns, and refined engineering badges.
- **Opportunity ↔ PD Ticket Merge:** Unifies Pipedrive opportunities and PD tickets into a single `Opportunity` record, managing CRM and internal PD workflow data.

### Database Strategy
- **Dual-Mode:** Supports PostgreSQL for production and SQLite for local development.
- **ORM:** Drizzle ORM for schema definition, Drizzle Kit for additive SQL migrations.
- **Schema Source of Truth:** `shared/schema/*.ts`.
- **Snapshot Versioning:** Uses `effective_to` for versioning select tables.

### Authentication & Authorization
- **Primary:** Microsoft SSO via Azure MSAL, mapping MS accounts to internal users and roles.
- **Fallback:** Username/password authentication using `bcryptjs`.
- **Role Management:** Authoritative role list defined in `shared/schema/users.ts`.
- **Security:** Server-side enforcement with `requireAuth`, `requireRole`, and the canonical `requirePermission(entity, action)` middleware, Azure Key Vault for secrets, and encryption.

### Roles & Permissions Big-Bang Rework (Task #101)
- **Canonical evaluator:** every server route reaches `requirePermission` from `server/permission-middleware.ts`. `requireAdmin` and `requireRole` are kept as **thin shims** that delegate to the same evaluator (preserving 394 existing call sites).
- **Canonical entity registry:** `shared/permissions/registry.ts` carries every entity with plain-English `title`, `description`, and `category` (Finance / Engineering / Project Delivery / Project Development / Quality & HSE / Admin / Reporting / Personal Workspace). `shared/schema/users.ts` re-exports `ENTITY_PERMISSION_DEFAULTS` from the registry — single source of truth.
- **Role templates:** `shared/permissions/templates.ts` ships 13 curated templates (Executive, CFO Full, Finance Read-Only, Program Manager, Project Manager, Project Developer, Engineer, Engineering Manager, Construction Manager, QA / HSE, Accountant, SSEG Manager, Read-Only Viewer). Idempotent seeder (`server/services/role-template-service.ts`) writes them into the new `role_templates` table on boot.
- **API:** `GET /api/admin/role-templates`, `POST /api/admin/roles/:role/preview-template/:templateKey` (returns plain-English diff), `POST /api/admin/roles/:role/apply-template` — all gated by `requirePermission("admin","edit")`.
- **Admin UI:** `/admin/roles` is rebuilt as three tabs — **People** (template-first per-user apply), **Roles** (template gallery), **Advanced** (the legacy matrix). `/admin/control-center` 301-redirects here.
- **Frontend gate:** `<PermissionGate>` + `usePermission()` are the canonical client-side gates; `client/src/lib/access-control.ts` is documented as legacy-only.
- **Migration:** `migrations/0036_role_templates_and_notes.sql` (additive `IF NOT EXISTS` only) creates `role_templates` and adds `notes text` to `role_permissions` and `user_permission_overrides`.
- **CI guards:** `qa/tests/unit/route-permission-coverage.test.ts` fails on any unguarded route; `qa/tests/unit/permission-snapshot-no-drift.test.ts` asserts byte-equality against `qa/fixtures/permission-snapshot-pre-rework.json` so no user loses access on cutover.
- **Docs:** [`docs/permissions.md`](docs/permissions.md) is the COO/CEO guide.

### Microsoft 365 Integration
- Integration with Outlook, Teams, and SharePoint using `@microsoft/microsoft-graph-client` for calendar event metadata, emails, and attachments.

### Stage Gate Auto-Population
- `server/services/gate-auto-evaluator-service.ts` provides a deterministic evaluator registry for canonical gate criteria, reading from the data spine.
- Auto-detected statuses persist on `project_stage_requirements.auto_*` and are surfaced when manual status is `not_started`.
- Endpoints: `GET /api/projects/:id/stage-gates/:phase/auto` and bulk `GET /api/projects/stage-gates/auto?phase=&projectIds=`.
- Stage detail (`GET /api/projects/:id/stages/:code`) auto-evaluates and persists on read.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright.
- **Release Gate:** `qa/release-gate.ts` script ensures critical test validation.

### PD Dashboard Features
- **Pipeline by Phase + Sign-Date Calendar:** `/pd-dashboard` displays a "Pipeline by phase" KPI card and an "Expected sign dates" calendar, both sourced from `GET /api/pd/dashboard/pipeline-by-phase`.
- **Won Deals (this FY) tile:** A "Won deals this FY · Pipedrive" `CollapsibleCard` on `/pd-dashboard` showing opportunities with `source='pipedrive'` and a "won" status within the current fiscal year, sourced from `GET /api/pd/dashboard/won-deals`.

### Pending Approval Inbox
- App-wide queue (`pending_approvals` table) that intercepts write operations, staging proposals via `proposeApproval()`. Apply handlers replay payloads on release. UI at `/pending-approvals` for approver roles.

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