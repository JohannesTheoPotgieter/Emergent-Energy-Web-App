# Emergent Energy Web App — replit.md

## Overview

Emergent Energy is an internal operations platform for a South African commercial and industrial (C&I) solar EPC (Engineering, Procurement, and Construction) company. It serves as a project-centric command center that replaces Excel-based "Program Dashboard" and per-project "Tracker" workbooks.

**Core purpose:** Give the COO, CFO, Project Managers, Engineers, and other roles a single trusted system to manage the full project lifecycle — from engineering intake and project development through construction, commissioning, finance tracking, and quality management.

**Key functional modules:**
- **Home** — Role-specific dashboard (COO gets operational oversight, CFO gets financials, PMs get active projects), My Work cockpit (tasks, calendar, Outlook integration), Inbox
- **Company** — Company overview, project lifecycle view, lifecycle board, gate tracker, blocked gates, exceptions
- **Project Development** — PD dashboard, pipeline/opportunities, PD tickets, clients, handover queue, PD reports
- **Project Delivery** — Execution dashboard, PM dashboard (PM-specific project view), portfolio dashboard, all projects, construction, procurement, PO approvals, payment requests, payment batches, milestone tracker, weekly reviews, standups, PM deliverables, PM approvals, PM on-the-go, handover & closeout, financial reviews, SSEG, sites
- **HSE** — HSE dashboard
- **Engineering** — Engineering dashboard, task board, standup
- **Quality** — Quality dashboard, commissioning dashboard, inspections/NCRs
- **Finance** — Cashflow, revenue, COS, GP/margin, FYE revenue, counterparties, subcontractors, invoice patterns
- **Reports** — Report center, programme reports, PM monthly, engineering monthly, performance
- **Priorities (EXCO)** — Strategic company priorities
- **Admin** — Control center, users & roles, smart import, audit log, processes & SOPs, templates, recovery

**Version:** 1.5.0 (Production Hardening Update)

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Monorepo Layout

```
/
├── client/src/         # React frontend (Vite)
├── server/             # Express API server (TypeScript)
│   ├── bootstrap/      # Startup orchestrator, migrations, seeding
│   ├── repositories/   # Data access layer
│   ├── routes/         # Route files grouped by domain
│   └── lib/            # Shared server utilities
├── shared/             # Shared types and Drizzle schema (schema.ts)
├── migrations/         # Drizzle-generated SQL migrations
├── qa/                 # Tests (Vitest unit + API, Playwright e2e)
├── script/             # Build, run, and utility scripts
└── docs/               # Canonical documentation
```

### Frontend Architecture

- **Framework:** React 18 with TypeScript, Vite as bundler
- **Routing:** Client-side SPA (no RSC), with React Router
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite` plugin), shadcn/ui component library (New York style), Lucide icons
- **State & data fetching:** TanStack React Query v5 for server state; local React state for UI
- **Forms:** React Hook Form + Zod resolvers
- **Design system:** CSS variables for theme tokens; white-and-emerald (#16A34A) light theme; Barlow + Inter + JetBrains Mono fonts
- **Key aliases:** `@/` → `client/src/`, `@shared/` → `shared/`

### Backend Architecture

- **Runtime:** Node.js with Express, written in TypeScript, run via `tsx` in dev and compiled to CJS for production
- **API style:** REST with grouped route files per domain (e.g., `approvals-routes.ts`, `commissioning-routes.ts`, `change-control-routes.ts`, `engineering-routes.ts`, etc.)
- **Session management:** Express session; uses in-memory store for SQLite mode, persistent store for PostgreSQL mode
- **Error handling:** Centralized API error class (`server/lib/api-error.ts`); all errors return JSON `{ error, message }`
- **Startup orchestration:** `server/bootstrap/startup-orchestrator.ts` runs all additive migrations with `IF NOT EXISTS` guards; controlled by feature flags (`ENABLE_STARTUP_SCHEMA_REPAIR`, `ENABLE_STARTUP_DATA_SEED`, etc.)
- **work_items:** `public.work_items` is a canonical base table (the writable-view architecture over `core.work_items` was retired by migration `20260409_retire_work_items_view.sql`). All CRUD goes directly to the base table via Drizzle ORM.

### Database Strategy — Dual-Mode (PostgreSQL + SQLite)

The app supports two database modes selected at runtime:

| Mode | Trigger | Use case |
|------|---------|----------|
| **PostgreSQL** | `DATABASE_URL` env var is set and connection succeeds | Production, full feature set |
| **SQLite** | No `DATABASE_URL` or connection fails | Local dev, Replit without provisioned DB |

- **ORM:** Drizzle ORM; schema defined in `shared/schema.ts`
- **Migrations:** Drizzle Kit targets PostgreSQL (`drizzle.config.ts`); SQLite compatibility handled via the startup bootstrap scripts
- **`db:push` / `db:setup`:** Uses raw `psql` scripts (`script/pre-push-enums.sql`, `script/full-schema-alignment.sql`) to handle enum creation and schema alignment before Drizzle push
- **Known issue:** Some PostgreSQL-specific queries (e.g., `::` cast syntax, certain enum comparisons) fail on SQLite — this is a known limitation when running in SQLite mode

### Authentication & Authorization

- **Primary auth:** Microsoft SSO via Azure MSAL (`@azure/msal-node`); single Microsoft tenant, multiple users
- **Fallback:** Username/password login (`bcryptjs`)
- **MS identity mapping:** MS account (`ms_user_id` / email) maps to internal user record + role
- **RBAC:** Role-based access control with roles such as COO, CFO, CEO, CCO, Project Manager, Engineer, QM; enforced server-side on routes
- **Session:** Express session with role stored; no client-side-only permission checks for sensitive actions
- **Azure Key Vault:** `@azure/keyvault-secrets` used for secret management in production

### Snapshot / Import Deduplication

Both `normalized_cost_lines` and `program_expense` use snapshot versioning via `effective_to` column. When new data is imported, previous rows are "closed" by setting `effective_to` to the import timestamp. **All queries aggregating costs/expenses MUST include `AND effective_to IS NULL`** (or the Drizzle equivalent `isNull(table.effectiveTo)`) to avoid summing historical snapshots alongside current data.

### Excel Tracker Import

A core workflow — users upload `.xlsx` project tracker workbooks:
- **Parser:** ExcelJS reads specific sheets: `Cashflow`, `Finance - Revenue`, `Finance - COS`, `Expenditure Breakdown`, `Revenue Tracking`, `Project Plan`, `Tasks`, `Data`
- **Upsert pattern:** Projects upserted by `projectCode`; uploading never wipes other projects
- **Stable line IDs:** Hash-based IDs for expense lines (`expense_line_id`) and inflow lines (`inflow_line_id`) to support drilldown and overrides
- **Override/scenario engine:** User planning edits stored as overrides with audit trail; never overwrites imported baseline data

### Microsoft 365 Integration

- **MS Graph API:** `@microsoft/microsoft-graph-client` for Outlook calendar sync, Teams mentions, SharePoint document browsing
- **SharePoint (Engineering):** Engineering intake pulled from SharePoint "Proposals Pipeline" list via Graph API; sync is manual (COO-only Pull/Push buttons); mock connector available for dev/testing
- **Real-time sync:** MS Graph subscriptions/webhooks + delta catchup for calendar events
- **Data storage policy:** Only metadata + deep links stored in DB (no full email bodies or attachments persisted)

### Testing

- **Unit + API tests:** Vitest (`qa/vitest.config.ts`), with dedicated configs for API business flows and policy/validation
- **E2e / smoke tests:** Playwright (`qa/playwright.config.ts`) — 80 smoke tests across all routes for all roles
- **Release gate:** `qa/release-gate.ts` must pass before release
- **QA scripts:** `script/run-with-app.ts` starts the server then runs tests against it

### Build & Deploy

- **Dev:** `tsx server/index.ts` + Vite dev server on port 5000
- **Build:** `tsx script/build.ts` compiles server to CJS (`dist/index.cjs`) and Vite builds client to `dist/public`
- **Production start:** `node dist/index.cjs`
- **Type checking:** Scoped `tsconfig.check.json` (only checks stable server files); full `tsconfig.json` covers client + shared + server

---

## External Dependencies

### Microsoft Azure / 365
- **`@azure/msal-node`** — Authentication via Azure AD / MS SSO
- **`@azure/identity`** — Azure credential management
- **`@azure/keyvault-secrets`** — Secret retrieval from Azure Key Vault
- **`@microsoft/microsoft-graph-client`** — MS Graph API for Outlook, Teams, SharePoint integration
- **SharePoint List (Proposals Pipeline):** Source of truth for Engineering intake; URL: `https://emergy.sharepoint.com/sites/EngineeringSupport/Lists/Proposals Pipeline`
- **Requires:** Azure AD App Registration with Tenant ID, Client ID, Client Secret and appropriate Graph API permissions

### Database
- **PostgreSQL** — Primary production database (via `DATABASE_URL`); required for full feature set including enum types
- **better-sqlite3** — SQLite fallback for local dev / Replit without provisioned DB
- **Drizzle ORM + Drizzle Kit** — Schema definition, query builder, migrations

### Frontend Libraries
- **shadcn/ui** — Component library built on Radix UI primitives
- **Radix UI** — Full suite of accessible primitives (accordion, dialog, dropdown, select, tabs, toast, etc.)
- **TanStack React Query v5** — Server state management and caching
- **TanStack Virtual** — Virtualized lists for performance
- **React Hook Form + Zod** — Form handling and validation
- **Recharts** — Charting for cashflow, KPI dashboards, financial visualizations
- **ExcelJS** — Server-side Excel workbook parsing for tracker imports
- **DOMPurify** — HTML sanitization for rich text content

### Testing & QA
- **Vitest** — Unit and API integration tests
- **Playwright** — End-to-end browser tests (Chromium)

### Build & Dev Tools
- **Vite** — Frontend bundler and dev server
- **tsx** — TypeScript execution for server dev and scripts
- **ESLint + Prettier** — Code quality and formatting
- **`@replit/vite-plugin-runtime-error-modal`** — Dev-time error overlay
- **`@replit/vite-plugin-cartographer`** + **`@replit/vite-plugin-dev-banner`** — Replit-specific dev tools (dev mode only)

### Fonts
- **Google Fonts:** Barlow (headings), Inter (body), JetBrains Mono (code/data)

### Environment Variables Required
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string; if absent, app falls back to SQLite |
| `AZURE_TENANT_ID` | Azure AD tenant for MS SSO |
| `AZURE_CLIENT_ID` | Azure App Registration client ID |
| `AZURE_CLIENT_SECRET` | Azure App Registration secret (or Key Vault reference) |
| `SESSION_SECRET` | Express session signing secret |
| `ENABLE_STARTUP_SCHEMA_REPAIR` | Flag to run schema repair on startup |
| `ENABLE_STARTUP_DATA_SEED` | Flag to seed initial data on startup |