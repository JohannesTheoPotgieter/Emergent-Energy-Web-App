# Emergent Energy Operations Platform

## Overview

Emergent Energy is a full-stack operations platform for a renewable energy company. It manages the complete project lifecycle including project delivery, financial oversight, engineering operations, quality management, and governance workflows.

The platform supports multiple roles (CEO, COO, CFO, Project Managers, Engineers, Quality Managers, etc.) with role-specific dashboards and permission-gated access. Core capabilities include:

- **Project management**: lifecycle tracking, execution boards, Gantt charts, milestone management
- **Financial management**: cost tracking, revenue tracking, cashflow forecasting, payment requests
- **Engineering operations**: stage gates, task tracking, deliverable management
- **Quality management**: QC checklists, NCR tracking, snag management
- **Smart Import**: Excel tracker file ingestion pipeline that seeds project data
- **Microsoft 365 integration**: Azure AD authentication, Outlook, Teams, SharePoint
- **Personal task management (MyTool)**: per-user task boards with today/week/backlog views

The app is at **version 1.5.0** and is actively migrating from a legacy spreadsheet-based data model to a promoted V2 schema with proper relational integrity.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend

- **Framework**: React + TypeScript, bundled with Vite
- **Routing**: `wouter` (lightweight client-side routing)
- **State/data fetching**: TanStack React Query v5 for server state; local React state for UI state
- **UI components**: shadcn/ui (Radix UI primitives) with Tailwind CSS
- **Form handling**: react-hook-form + Zod validation
- **Charts**: Recharts
- **Fonts**: Inter (body), Barlow (headings), JetBrains Mono (code)
- **Theme**: White and emerald (#16A34A) — light theme only, consistent across all pages
- **Route registry**: Canonical frontend routes live in `client/src/config/page-registry.ts`. This is the source of truth for all client routes — not the docs.
- **Code splitting**: Vite manual chunks split vendor deps into react, query, ui, charts, forms, date buckets for performance

### Backend

- **Framework**: Express + TypeScript, running as a Node.js server
- **Entry point**: `server/index.ts`
- **Route organization**: Routes are being progressively extracted from a monolithic `server/routes.ts` into domain-specific files (`engineering-routes.ts`, `quality-routes.ts`, `payment-request-routes.ts`, etc.) registered via `server/register-all-routes.ts`
- **Preferred API contract prefix**: `/api/platform/*` for stable, cross-functional APIs
- **Auth middleware types**: `requireAuth`, `requireAdmin`, `requireCOO`, `requireRole`, `requirePermission` — backend authorization is authoritative; frontend guards are UX-only
- **Repository pattern**: `server/repositories/` for data access; services in `server/services/`
- **Audit logging**: `server/audit-logger.ts` — all major state mutations emit audit events
- **Startup orchestrator**: `server/bootstrap/startup-orchestrator.ts` — handles additive migrations with IF NOT EXISTS guards; completely blocked in production/staging environments

### Database

- **Database**: PostgreSQL via Neon serverless (`@neondatabase/serverless`)
- **ORM**: Drizzle ORM; schema defined in `shared/schema.ts`
- **Migrations**: SQL files in `migrations/` directory are the **sole schema authority** for all environments. Drizzle schema and SQL migrations must stay in sync.
- **Schema alignment scripts**: `script/pre-push-enums.sql` and `script/full-schema-alignment.sql` for development bootstrapping
- **Key canonical tables**:
  - `project_info` — canonical project identity (all entities attach to this via `project_info.id`)
  - `work_items` — unified task/work item table (replaces legacy `mytool_tasks` and `operational_tasks`)
  - `entity_assignments` / `work_item_assignments` — canonical assignment ledger
  - `approvals` — approval workflow state
  - `deliverables` — file deliverables with approval workflow
  - `audit_events` — immutable mutation history
  - `normalized_cost_lines` / `normalized_revenue_lines` — canonical financial data after Smart Import
- **Active migrations in progress**:
  - `project_name` TEXT columns across 43 tables being replaced with `project_id` FK references (90-day dual-write window)
  - `is_active` boolean columns being replaced with `deleted_at` timestamp columns across 17 tables
  - Override tables being collapsed into base tables

### Authentication & Authorization

- **Primary auth**: JWT tokens stored in `localStorage` as `auth_token`; session also maintained server-side
- **Microsoft/Azure AD**: `@azure/msal-node` for OAuth; `@microsoft/microsoft-graph-client` for Graph API access; `@azure/keyvault-secrets` for secret management
- **Permission model**: Role-permission matrix stored in DB, checked server-side via `requirePermission` middleware; `shared/schema.ts` exports `checkPermission()` for static fallback
- **Frontend guards**: `ProtectedRoute` (redirects to `/auth/login`), `RoleGuard` (role-based filtering), `usePermission` hook, `PermissionGate` component wrapper
- **Build version check**: On load, app checks `/build-version.json` and clears auth tokens if build ID changed — forces re-login on deploy

### Data Encryption

- Bank account numbers and branch codes encrypted at rest with AES-256-GCM field-level encryption (`server/lib/field-encryption.ts`)
- Key from `TOKEN_ENCRYPTION_KEY` env var (same key used for Microsoft token encryption)
- Ciphertext versioned as `v1:<iv>:<authTag>:<ciphertext>` to support future key rotation

### Smart Import Pipeline

Excel tracker files are the primary data ingestion mechanism:
1. Upload `.xlsx` file via `/smart-import` page
2. Parser detects Plan/Revenue/Expenditure sections automatically
3. Rows normalized into `normalized_cost_lines` / `normalized_revenue_lines`
4. Project metadata upserted into `project_info`
5. Legacy compatibility mappings preserved for bridge consumers

### Write Authority Model

During V2 migration, entities have designated write authorities:
- **Legacy (Smart Import owns)**: Revenue lines, cost lines, project financial fields
- **Promoted (API owns)**: Work items, QC checklists, standup entries, approvals
- Dual-write continues for entities in transition

### QA & Release Gates

- **Test stack**: Vitest (unit/API), Playwright (E2E smoke)
- **Release gate script**: `qa/release-gate.ts` — runs type check, route parity, redirect chain check, route proof, KPI frozen dataset validation, smoke tests, and workflow tests
- **Reconciliation**: `qa/generate-reconciliation-evidence.ts` validates data parity between legacy and promoted schema before cutover
- **Route inventory**: `docs/qa/app-route-inventory.md` must document every route in `client/src/config/page-registry.ts` — enforced by `script/test-routes.ts`

---

## External Dependencies

### Cloud & Infrastructure

- **Database**: Neon PostgreSQL serverless (`@neondatabase/serverless`) — connection via `DATABASE_URL` env var
- **Azure Key Vault**: `@azure/keyvault-secrets` — stores secrets for Microsoft integration
- **Azure AD / MSAL**: `@azure/identity` + `@azure/msal-node` — Microsoft identity platform for SSO and delegated Graph API access

### Microsoft 365 Integration

- **Microsoft Graph API**: `@microsoft/microsoft-graph-client` — Outlook email sync, Teams integration, SharePoint-connected surfaces
- Integration routes behind explicit auth/permission guards in `server/routes/ms-sync-routes.ts`
- Credentials managed via Azure Key Vault or env vars

### UI & Component Libraries

- **shadcn/ui**: Component library built on Radix UI primitives — configured in `components.json` with `new-york` style, `neutral` base color
- **Radix UI**: Full suite of accessible UI primitives (`@radix-ui/react-*`)
- **Lucide React**: Icon library
- **Tailwind CSS v4**: Styling via `@tailwindcss/vite` plugin

### Build & Dev Tooling

- **Vite**: Frontend bundler with custom `metaImagesPlugin` for OpenGraph image injection
- **esbuild**: Server bundle compilation
- **tsx**: TypeScript execution for scripts and development server
- **Drizzle Kit**: Schema diff and migration tooling
- **ESLint** + **Prettier**: Code quality enforcement
- **Replit runtime error overlay**: `@replit/vite-plugin-runtime-error-modal` — development error overlay

### Background Jobs

- **BullMQ**: Redis-backed job queues (listed in dependencies) — used for async background processing

### File Processing

- **xlsx**: Excel file parsing for Smart Import pipeline
- **adm-zip**: ZIP file handling
- **multer**: Multipart form data / file upload handling

### Environment Variables Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `JWT_SECRET` | JWT signing secret |
| `SESSION_SECRET` | Express session secret |
| `TOKEN_ENCRYPTION_KEY` | AES-256 key for bank details + MS token encryption |
| Azure/MSAL credentials | Microsoft 365 integration |
| `NODE_ENV` | Controls startup DDL behavior (`production` blocks all schema mutations) |