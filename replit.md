# Emergent Energy Web App

## Overview
Emergent Energy is an internal operations platform designed for a South African commercial and industrial (C&I) solar EPC company. Its primary purpose is to centralize and streamline project lifecycle management, from engineering and commissioning to finance and quality assurance. The platform aims to enhance operational efficiency, consolidate data from disparate systems (currently Excel-based), and provide critical insights to support the company's growth and maintain its leadership in the C&I solar market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo, separating the client (React SPA), server (Express API), shared code (Drizzle schema), database migrations, QA, and scripting.

### Frontend
- **Framework & Tooling:** React 19 with TypeScript and Vite.
- **Routing:** `wouter` for SPA navigation.
- **Styling & Components:** Tailwind CSS v4, `shadcn/ui` components (New York style) based on Radix UI, and Lucide icons.
- **State Management:** TanStack React Query v5 for server state; local React state for UI-specific data.
- **Forms:** React Hook Form with Zod for validation.
- **Design:** White-and-emerald light theme using CSS variables, with Barlow, Inter, and JetBrains Mono fonts.

### Backend
- **Runtime & Framework:** Node.js with Express 5 and TypeScript.
- **API Design:** RESTful API utilizing a repository pattern.
- **Validation & Error Handling:** Zod schemas and `validateBody` middleware, with centralized `ApiError` handling.
- **Authentication:** `express-session` for user sessions and roles.
- **Data Initialization:** `startup-orchestrator.ts` for additive migrations and data seeding.
- **Smart Import v2:** Handles `.xlsx` tracker workbook imports with upsert/override strategies and preflight validation.
- **Financial Reconciliation:** Provides read-only interfaces for reconciling QuickBooks data with internal cost trackers and managing vendor mappings.
- **QB Matching Scoring Priority:** The pure scorer (`server/services/quickbooks-invoice-match-service.ts`, `scoreInvoiceMatch`) ranks signals in operator-requested order **invoice number → line description → amount → vendor name**. A new description-similarity tier reads `app.description` against `qb.qbDescription` using the same token-set Jaccard helper as counterparty matching (`DESC_SIM_STRONG=0.6`, `DESC_SIM_FUZZY=0.3`). Strong description tiers (80/72/65) are inserted between the invoice-number tiers (95/85) and the amount/vendor tiers (60/55/45/40), so a candidate that matches the memo will outrank a same-amount candidate with unrelated text. Confidence bands (`90+ high`, `70–89 medium`, `<70 low`) are unchanged. Tests in `qa/tests/unit/quickbooks-invoice-match-scoring.test.ts`.
- **QB Matching Many-to-Many Allocations (Task #142):** A QB doc (invoice or bill) may now be linked to multiple app lines (revenue + cost), with each link carrying an explicit Rand allocation. Over-allocation (sum > QB total + tolerance) is rejected; **under-allocation is allowed as a partial settlement** — `checkQbAllocationSum` returns `partial: true` with `remaining` Rand the operator can link to other app lines later (`max(R0.50, 0.5%)` — see `shared/config/qb-allocations.ts`). Schema in migration `0050_qb_invoice_links_allocations.sql` adds `allocated_amount_ex_vat` + `allocation_tolerance_applied` to `quickbooks_invoice_links`, drops the old 1:1 partial unique indexes, adds a multimap index on `qb_entity_*`, and enforces non-negative allocations. The transactional writer `confirmLinksWithAllocations()` (in `server/services/quickbooks-reconciliation-service.ts`) is the canonical entry point: it validates the sum, soft-deletes siblings the operator removed, and upserts the rest atomically; tolerance breaches throw `QuickBooksAllocationToleranceError` (HTTP 422). Drawer UI (`client/src/components/quickbooks/QbMatchingWorkbench.tsx`) shows a per-link Rand editor with a live traffic-light gate and disables Approve until balanced; the workbench list shows a `bulk(N)` badge whenever a QB doc has siblings linked to other app lines. Downstream multimap consumers (`finance-routes.ts` cos-tracker / cos-tracker-month / both reconciliation endpoints, and `register-cashflow-2026-routes.ts` outflows + inflows) sum via `effectiveAllocatedAmountExVat` and surface the doc number as `<doc> (+N)` when more than one link exists. Per-app-line drawer entry; partial unlink detaches just that line and the siblings keep their links. Out of scope: QB-doc-first entry, FX, auto-suggest splits, Pending Approvals policy.
- **Revenue Recognition:** Implements a Canonical Revenue Recognition system integrated with QuickBooks.
- **COS Tracker Past-Month Auto-Promote:** Automates 'Realised' status for past month cost lines with invoice numbers.
- **Home "Do Next":** Role-aware, ranked action items with snooze/dismiss functionality.
- **Canonical Phase Cycle:** Defines a 12-phase project lifecycle (`shared/phases.ts`) including 10 sequential and 2 terminal phases (`S_HOLD`, `S_DONE`).
- **Priority Linked Progress:** Allows `effectiveProgress` of priorities to be driven by various data sources (e.g., `project_phase`, `derived_project_kpis`).
- **Priorities UI Overhaul:** Streamlined priority management with unified add/edit dialogs, improved field parity, and role-based access controls.
- **Opportunities Management Board:** Centralizes project development activities under `/opportunities` with List, Kanban, and Calendar views, featuring role-scoped access and Pipedrive integration.
- **Project Development Dashboard:** Provides an overview of PD KPIs, pipeline status, and risk signals.
- **Engineering Ticket Tracking:** Integrated into the Opportunity Drawer, displaying ticket status, age, due dates, owners, and comments, with a mini engineering task board for `work_items`.
- **Opportunities Working List Hardening:** Enhances the opportunities working list with server-side authoritative gating, deep-link support, Pipedrive sync indicators, sortable columns, and refined engineering badges.
- **Opportunity ↔ PD Ticket Merge:** Unifies Pipedrive opportunities and PD tickets into a single `Opportunity` record.
- **Stage Gate Auto-Population:** `server/services/gate-auto-evaluator-service.ts` provides a deterministic evaluator registry for canonical gate criteria, reading from the data spine. Auto-detected statuses persist on `project_stage_requirements.auto_*` and are surfaced when manual status is `not_started`.
- **PD Dashboard Features:** Displays "Pipeline by Phase" KPI and "Expected sign dates" calendar, along with "Won Deals (this FY)" from Pipedrive.
- **Pending Approval Inbox:** App-wide queue (`pending_approvals` table) that intercepts write operations, staging proposals via `proposeApproval()`. UI at `/pending-approvals` for approver roles.
- **Company Overview Dashboard:** Executive-level dashboard at `/company` aggregating all departments. Service (`server/services/company-overview-service.ts`) pulls from canonical sources: `project_info`, `project_execution_state`, `normalized_revenue_lines`, `normalized_cost_lines`, `work_items`, `pending_approvals`, `opportunities`, `hse_incidents`, `corrective_actions`, `project_eng_*` tables, `project_stage_*` tables, QC/snag/handover tables. Features: trusted top strip (5 KPIs including pending approvals), department health grid (6 departments with weighted KPI scoring via `shared/config/kpi-registry.ts`), portfolio delivery snapshot with canonical phase distribution (via `resolveCanonicalPhase` from `shared/phases.ts`) and schedule health (avg actual vs expected %), financial snapshot (cash + realised concepts), exceptions/priorities, department KPI table, and recent signals.

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
- **Roles & Permissions Rework:** A canonical evaluator (`server/permission-middleware.ts`) centralizes permission checks. A canonical entity registry (`shared/permissions/registry.ts`) defines entities, and `shared/permissions/templates.ts` ships 13 curated role templates. The `/admin/roles` UI is a single screen for managing user and role permissions, supporting deep-linking and audit logging. Client-side gating is managed by `<PermissionGate>` and `usePermission()`.

### Microsoft 365 Integration
- Integration with Outlook, Teams, and SharePoint using `@microsoft/microsoft-graph-client` for calendar event metadata, emails, and attachments.

### Engineering-Ticket Consolidation (Path 2)
- The `work_items` table is the canonical source for engineering execution data, with `engineering_tickets` maintained as a back-compatible mirror for finance / PD / Pipedrive / gates. Server-side deduplication ensures only canonical `work_items` render on the `/opportunities` drawer board, and retired template-spawn endpoints (`/api/pd/tickets/:id/spawn-tasks`, `/api/pd/tickets/bulk-spawn-tasks`) now return HTTP 410 Gone.
- Migrations `0040_work_items_engineering_metadata.sql` (additive — adds `funding_type`, `size_kwp`, `province`, `gps_coordinates`, `batteries_needed`, `battery_size`, plus `idx_work_items_eng_ticket_active`) and `0041_work_items_batteries_needed_default.sql` (drops `DEFAULT false` so future linked-row backfills can inherit `true` from the ticket) are applied. Schema mirror lives in `shared/schema/tasks.ts`. Boot verifier prints `[DB] ✓ work_items engineering columns verified`.
- Bidirectional sync lives in `server/work-items-adapter.ts`:
  - Forward (work_item → ticket): `updateEngineeringWorkItem` mirrors status / priority / dueDate / title onto the linked `engineering_tickets` row using the canonical `workItemPriorityToTicketPriority` helper (`Urgent↔Critical`, `High↔High`, `Med↔Medium`, `Low↔Low`, null/empty preserved).
  - Reverse (ticket → work_item): `syncTicketEditToWorkItem`, wired into `PATCH /api/pd/tickets/:id`, mirrors status / priority / dueDate→endDate, identity (`projectSiteName→title`), linkage (`projectId`, `clientId`), and the 6 solar/site fields. Scoped to `workstream='ENG'` + non-deleted siblings; best-effort try/catch so a mirror failure never blocks the user's edit response.
  - The `POST /api/pd/tickets/:id/engineering-tasks` user-add flow normalises inbound priority via `ticketPriorityToWorkItemPriority` (defaults to `Med`) so the canonical store never accumulates the invalid `"Medium"` value.
- Regression coverage in `qa/tests/unit/opportunity-drawer-engineering-consolidation.test.ts` (28 tests) pins: dedupe scoping, drawer client-side flattening, opportunities-routes sibling insert source/fields, forward + reverse sync coverage including the title-fallback parity guard, the priority-helper matrix, dead-code removal of `SpawnEngineeringTasksButton` from `client/src/pages/pd-dashboard.tsx`, and migration 0041 invariants.

### Testing
- **Unit & API Tests:** Vitest.
- **E2E Tests:** Playwright.
- **Release Gate:** `qa/release-gate.ts` script ensures critical test validation.
- **Rules-of-Hooks Guard:** `qa/tests/unit/client-rules-of-hooks.test.ts` validates React Hooks usage.

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