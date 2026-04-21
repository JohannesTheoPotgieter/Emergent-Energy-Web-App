# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform for a South African commercial and industrial (C&I) solar EPC company. Its primary purpose is to serve as a project-centric command center, replacing fragmented, Excel-based systems. The platform provides a single, trusted system for all roles to manage the entire project lifecycle, from engineering intake and development through construction, commissioning, finance tracking, and quality management.

The platform aims to improve efficiency, centralize data, and provide comprehensive insights across all project phases, supporting business growth and market leadership in the C&I solar sector.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project uses a monorepo containing `client/` (React SPA), `server/` (Express API), `shared/` (Drizzle schema), `migrations/`, `qa/` (testing), and `script/` directories.

### Frontend
- **Framework:** React 19 with TypeScript and Vite.
- **Routing:** `wouter` for SPA navigation.
- **Styling:** Tailwind CSS v4, `shadcn/ui` components (New York style) built on Radix UI, Lucide icons.
- **State Management:** TanStack React Query v5 for server state, local React state for UI.
- **Forms:** React Hook Form with Zod for validation.
- **Design:** CSS variables for theming, white-and-emerald light theme, Barlow, Inter, and JetBrains Mono fonts.
- **UI/UX:** Consistent design language using `shadcn/ui` components for a professional and intuitive user experience.

### Backend
- **Runtime:** Node.js with Express 5 and TypeScript.
- **API Style:** RESTful, grouped by domain, with abstracted data access through repositories.
- **Validation:** Zod schemas and `validateBody` middleware for robust input validation.
- **Error Handling:** Centralized `ApiError` handling.
- **Session Management:** `express-session` for user roles.
- **Startup:** `startup-orchestrator.ts` handles additive migrations and data seeding.
- **Smart Import v2:** Processes `.xlsx` tracker workbooks using ExcelJS for parsing, with an upsert/override pattern for project data. Includes preflight validation to surface issues before commitment.
- **COS Tracker Tracker-Gap Reconciliation UI (Phase 2, read-only):** Provides an interface for finance to identify and manage discrepancies between QuickBooks bills and internal cost trackers. It allows ignoring known non-tracker bills and manually overriding class-to-project mappings. It *never* writes to financial source-of-truth tables.
- **QB Vendor Mappings (QB Vendor ↔ App Counterparty):** Mirror of customer mappings for the supplier side. Backed by `quickbooks_vendor_mappings` (migration 0010) with unique `(qb_vendor_id, qb_realm_id)`. Because QB bills are fetched live (never persisted), historical alignment to a newly-mapped counterparty is automatic on the next read — no row-level backfill needed.
- **COS Tracker QB → Project Resolver (Phase 1, read-only):** Resolves QuickBooks bills to projects based on a strategy ladder, aiding finance in identifying unmapped or incorrectly mapped transactions. It *never* writes to financial source-of-truth tables.
- **Canonical Revenue Recognition (POC method):** Computes revenue KPIs based on `normalized_cost_lines.revenue_recognition_amount`, gated by effective realization. Distinct from cashflow/billing.
- **QuickBooks Revenue (a/c 1000000 Sales):** The "Quickbooks Revenue" row on the Revenue Tracker reads monthly credits to QB account `1000000 Sales` from the `ProfitAndLoss` report (`summarize_column_by=Month`) via `extractMonthlyAccountTotalsFromPnL` in `server/services/quickbooks-service.ts`. This is finance's canonical revenue-recognition source: ex-VAT, accrual-based, and includes journal-entry recognition (e.g. milestone moves from Deferred Revenue → Sales). Replaces the prior `Invoice.TotalAmt` sum which was VAT-inclusive and double-counted A/R deposits posted to liability accounts. Account match falls back to name "Sales" if id `1000000` isn't present.
- **COS Tracker Past-Month Auto-Promote:** Automatically treats cost lines from past months with invoice numbers as 'Realised' to prevent drift from QuickBooks, differentiating from strict canonical realization rules.
- **Home "Do Next":** Provides ranked, role-aware action items (approvals, RAG status, overdue tasks) with server-persisted snooze/dismiss functionality.
- **Canonical Phase Cycle:** Implements a single, company-wide 10-stage project lifecycle defined in `shared/phases.ts`.
- **Priority Linked Progress:** A Priority's `effectiveProgress` can be driven from a chosen source (`project_phase` reach-or-pass, `project_percent` from `derived_project_kpis`, `milestone_revenue` 0/60/100 by paid/invoiced state, or `tasks_rollup` averaged from `work_item_pm`). Stored on `mytool_company_priorities.progress_source_type` + `progress_source_ref` (jsonb) — added in migration 0009. Computed every read by `server/lib/priorities/progress-source.ts`; falls back to manual `%` when source is unset or unresolvable. Picker lives in `client/src/components/priorities/ProgressSourcePicker.tsx` and replaces the manual % field in the Edit Priority dialog. A small "Auto" chip under the progress bar surfaces the linked source label. Out-of-scope (follow-up): same picker on the task-edit dialog for work_item-level linking.

### Database Strategy
- **Dual-Mode:** Supports PostgreSQL (production) and SQLite (local development).
- **ORM:** Drizzle ORM with Drizzle Kit for schema definition and additive SQL migrations.
- **Schema:** `shared/schema/*.ts` is the source of truth.
- **Snapshot Versioning:** Uses `effective_to` for snapshotting tables like `normalizedCostLines`.

### Authentication & Authorization
- **Primary Auth:** Microsoft SSO via Azure MSAL, mapping MS accounts to internal users and roles.
- **Fallback Auth:** Username/password login using `bcryptjs`.
- **Role Management:** Authoritative role list in `shared/schema/users.ts`.
- **Server-side Enforcement:** `requireAuth` and `requireRole` middleware.
- **Security:** Azure Key Vault for secrets, encryption for sensitive fields.

### Microsoft 365 Integration
- Integrates with Outlook, Teams, and SharePoint using `@microsoft/microsoft-graph-client`.
- Includes a sync service for calendar events, storing only metadata and deep links for emails and attachments.

### Opportunities Management Board
- Provides a centralized working list for Project Development under `/opportunities`.
- Offers three views: List, Kanban (5 stage columns), and Calendar.
- Canonical detail view is the `OpportunityDrawer`.
- **Role-scoped access** ensures users only see relevant opportunities.
- Integrates Pipedrive custom fields for `province`, `estimated_kwp`, and `estimated_kwh`.

### Project Development Dashboard
- `/pd` provides an overview dashboard with KPI cards (pipeline value/kWp, win rate), Pipeline by Stage, Active Funnel, Upcoming Activity, Recent Wins/Losses, and Risk Signals.

### Opportunity ↔ PD Ticket Merge
- Unifies "Pipedrive Opportunity" and "PD Ticket" into a single "Opportunity" record.
- Pipedrive owns CRM fields (read-only), while the app owns PD-workflow shadow data.
- Lazy creation and patching of PD fields, spawning tasks, and converting to projects.
- Lifecycle phases are prioritized over Pipedrive stages, with a clear mapping between the two.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright.
- **Release Gate:** `qa/release-gate.ts` script for critical test validation.

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