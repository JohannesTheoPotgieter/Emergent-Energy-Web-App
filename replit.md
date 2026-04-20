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
- **Smart Import v2:** Processes `.xlsx` tracker workbooks using ExcelJS for parsing and an upsert/override pattern for project data. PLAN rows use a coordinate-anchored `external_ref` shape `PID-{projectId}::PLAN::{sheetSlug}::R{sourceRow}::{outline||'M'}` (see `server/lib/import/row-matcher.ts`), unique by construction. The matcher runs a dual-key pre-pass (new shape, then legacy `BK::` shape) before falling back to business-key bucket pairing, so historical refs continue to match while new commits silently migrate to the new shape via `commit-executor.ts` `needsRefNormalize`. Each row commits inside its own SAVEPOINT and emits a `RowWarning` instead of aborting the sheet on conflict; warnings are flat-mapped into `commitResult.v2.rowWarnings[]`. A `runPreflightValidator` (`server/lib/import/preflight-validator.ts`) inspects the planned PLAN refs at upload time and attaches `preview.preflight = { warnings, plannedRefs, counts }` to the run so duplicate-planned-ref / blank-outline-milestone / missing-source-coordinate issues are surfaced in the Confirm step via `SmartImportPreflightPanel` before the user commits. A one-shot, idempotent backfill `script/backfill-work-items-external-ref.ts` (defaults to `--dry-run`, opt-in `--apply`) recomputes legacy PLAN refs into the new shape, ordered by `id` for determinism, with `#pk{id}` collision suffixes; the report is written to `tmp/backfill-external-ref-report.json`.
- **COS Tracker QB → Project resolver (Phase 1, read-only):** `server/services/quickbooks-reconciliation-service.ts` exports `billRawToLineRows(raw)` (one row per QB Bill `Line[]` with class/customer/account refs; falls back to a synthetic header row when Line[] is empty/non-expense), `normalizeProjectKey(s)` (lowercase, strip `_Tracker` suffix, alnum-only), and `buildQbProjectResolver(projectNames)` (closure-bound resolver with strategy ladder `class_exact → customer_exact → class_substring → customer_substring → unmapped_class → unmapped_no_class`; substring matches return only when unambiguous, longest key wins). All helpers are READ-ONLY — never write to `normalized_cost_lines` or `quickbooks_invoice_links`. The Excel trackers remain the source of truth; this exists to surface QB bills missing from those trackers so finance can update the source files and re-import. Admin-only endpoint `GET /api/cos-tracker/qb-coverage-report?start=YYYY-MM-DD&end=YYYY-MM-DD` (requireAuth + requireAdmin) returns `{summary, byStrategy, unmappedClasses, fuzzyMatches, trackerGapPreview}` for human validation. One-shot script `script/qb-coverage-report.ts` writes the same JSON to `tmp/` for offline analysis.
- **COS Tracker past-month auto-promote:** In `server/departments/finance-routes.ts` the helpers `isEffectivelyRealised` / `isEffectivelyCommitted` (used by `/api/cos-tracker/project/:projectName`) and the inline classifier in `/api/cos-tracker` apply a past-month rule: any cost line whose `monthKey < cosCurrentMonthKey` and that carries a non-empty `expenseInvoiceNumber` is treated as Realised regardless of `invoice_date_font_color` / `invoice_date_confirmed`. Mirror rule excludes the same lines from Committed. PO-only lines (no invoice) in past months stay Committed. Rationale: font-color is a current-month vetting heuristic that stops being meaningful once finance has moved on; without this rule historical invoice-bearing rows sit in "Committed" limbo forever and the COS Tracker drifts from QuickBooks. The canonical helper `isCanonicalCosRealised` in `server/lib/finance/cos-realisation.ts` is intentionally LEFT STRICT — other consumers (stateClassifier, bridge-writer, report-routes) need the strict gate for historical accuracy reports.
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
- Three views via tabs: **List** (compact dense table), **Kanban** (5 stage columns with deal count + total value), **Calendar** (month grid anchored on `expected_close_date`, plus undated bucket). All three open the unified `OpportunityDrawer` on click.
- List columns: client, project, project developer, province, size, deal value, est. signature, next activity, engineering open tasks, action.
- Backed by `GET /api/opportunities/working` which joins user data and engineering ticket counts.
- **Role-scoped**: `canViewAllTickets(role)` (COO_ADMIN/CEO_ADMIN/CCO) returns the full working list. All other PD-eligible roles see only opportunities where they are `pd_tickets.project_developer_user_id`, falling back to `opportunities.deal_owner_user_id` when no PD shadow override exists. Filter is applied in JS post-query against `opportunitiesRepo.getWorkingListRows()`; null user with non-admin role returns `[]` (no leak).
- Pipedrive custom fields are wired to `opportunities.province`, `estimated_kwp`, and `estimated_kwh`.
- Pipedrive sync ingests deal owner via v1 `deal.user_id` (not `owner_id`); falls back to `deal_owner_name` snapshot when no internal user is linked. Custom-field policy: Pipedrive wins when a value is present; the app's value is preserved when Pipedrive is blank.

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
- Lazy shadow create in `opportunitiesRepo.getOpportunityWithWorkflow()` uses `onConflictDoNothing` against the partial unique index `pd_tickets_opportunity_shadow_unique` (predicate: `opportunity_id IS NOT NULL AND project_id IS NULL`); the `targetWhere` clause MUST repeat that predicate or Postgres raises 42P10. The follow-up re-select is also constrained to `project_id IS NULL` so it always returns the canonical shadow row.
- Pipedrive PD stages (Prospect/Qualification/Proposal/Negotiation/Contracting) map to the canonical 10-stage company lifecycle (`shared/phases.ts`) via `shared/lib/pd-stage-lifecycle.ts` (server-safe; client re-exports through `client/src/lib/pdStageLifecycle.ts`). **The lifecycle phase is the primary label** (emerald badge in List, emerald header in Kanban); the Pipedrive stage is demoted to a small lowercase secondary line. When no mapping exists, the original Pipedrive stage falls back as primary.
- **PD dashboard** (`GET /api/pd/dashboard`) returns both `byStage` (raw Pipedrive aggregation) and `byPhase` (server-side roll-up into canonical lifecycle phases using the shared mapping; unmapped stages bucket under `_UNMAPPED` / "Unmapped"). The frontend renders "Pipeline by Lifecycle Phase" as the primary card (`PhaseBar`), with the Pipedrive stage strip shown beneath each phase row.

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