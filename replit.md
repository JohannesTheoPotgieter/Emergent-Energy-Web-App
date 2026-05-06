# Emergent Energy Web App
An internal operations platform for a South African C&I solar EPC company, streamlining project lifecycle management, centralizing data, and providing critical business insights.

## Run & Operate
- **Run Dev Server:** `npm run dev`
- **Build:** `npm run build`
- **Typecheck:** `npm run typecheck`
- **Codegen (Drizzle Kit):** `drizzle-kit generate`
- **DB Push (Drizzle Kit):** `ddrizzle-kit push`
- **Required Env Vars:** Azure MSAL credentials, Key Vault URI, database connection string.

## Stack
- **Frontend:** React 19, TypeScript, Vite, wouter, Tailwind CSS v4, shadcn/ui, TanStack React Query v5, React Hook Form, Zod.
- **Backend:** Node.js, Express 5, TypeScript, Zod.
- **Database:** PostgreSQL (production), SQLite (development).
- **ORM:** Drizzle ORM.
- **Build Tool:** Vite.

## Where things live
- **Client Source:** `client/src/`
- **Server Source:** `server/src/`
- **Shared Code:** `shared/` (e.g., `shared/schema/*.ts` for DB schema, `shared/permissions/` for permission definitions, `shared/phases.ts` for canonical phase cycle, `shared/config/kpi-registry.ts` for KPI definitions, `shared/config/qb-allocations.ts` for QuickBooks allocation rules)
- **Database Migrations:** `migrations/` (output dir for `drizzle-kit generate`; recreated on demand — was purged to slim deploy uploads)
- **Public Assets:** `client/public/`
- **Theme Files:** Defined via CSS variables in `client/src/index.css` and `tailwind.config.ts`.
- **API Contracts:** Defined implicitly by Zod schemas in `server/src/api/` and `shared/schema/`.

## Architecture decisions
- **Monorepo Structure:** Separates client, server, shared code, and tooling for streamlined development and consistent dependencies.
- **Dual-Mode Database:** PostgreSQL for production and SQLite for local development allows for easy local setup without complex database provisioning.
- **Canonical Phase Cycle:** Enforces a standardized 12-phase project lifecycle across the platform, driving business logic and UI states.
- **Permission-Driven Access Control:** Centralized server-side and client-side permission evaluation via a canonical registry ensures robust and consistent authorization.
- **Engineering Ticket Consolidation:** Unifies disparate engineering ticket systems into a canonical `work_items` table with bidirectional sync, improving data consistency and reducing redundancy.
- **Smart Import v2 with Conflict Resolution:** Implements a sophisticated import mechanism for Excel workbooks, featuring 3-way merge conflict detection and resolution with value normalization to reduce noise.

## Product
- Centralized project lifecycle management for C&I solar projects.
- Data consolidation from various sources, replacing Excel-based workflows.
- Operational efficiency improvements and data-driven insights.
- Financial reconciliation with QuickBooks, including multi-line allocations.
- Revenue recognition system.
- Role-aware "Do Next" action items.
- Opportunities management board with List, Kanban, and Calendar views.
- Project Development and Company Overview dashboards with key performance indicators.
- Engineering ticket tracking and management.
- Pending approval workflow for critical operations.
- Microsoft 365 integration for email, calendar, and document management.

## User preferences
Preferred communication style: Simple, everyday language.

## Gotchas
- **Deploy upload size matters.** Replit autoscale ships the entire workspace. Do NOT re-add large dirs to the repo (`attached_assets/`, `qa/`, `docs/`, raw `migrations/*.sql`, `drift-report.json`) — they were purged to keep publishes fast. Agent-uploaded files in chat should not be checked in.
- Always run `npm run typecheck` before committing to catch type errors early.
- Database migrations must be additive; use `drizzle-kit generate` and review generated SQL carefully before pushing.
- Changes to `shared/schema` require corresponding Drizzle Kit commands.
- Smart Import conflict resolution requires careful user intervention for 3-way merges.
- **Smart Import baseline lookup is id-first**, not business-key-first. The S001 externalRef pre-pass in `row-matcher.ts` can pair a file row to a DB row whose business keys differ (e.g. renamed task) — `mr.businessKey` then holds the FILE row's key while the baseline row lives under the DB row's key. `buildBaselineLookup` (server/lib/import/conflict-engine.ts) returns both `byRowId` and `byBusinessKey`; `mergeSection` MUST prefer `mr.existingRowId` and fall back to business key only for the legacy `summaryJson.normalization` baseline path. Reverting to a key-only lookup re-introduces the "BASELINE: empty" false-conflict bug.

## Pointers
- **React Query Docs:** _Populate as you build_
- **Drizzle ORM Docs:** _Populate as you build_
- **Tailwind CSS Docs:** _Populate as you build_
- **Zod Docs:** _Populate as you build_
- **Express Docs:** _Populate as you build_
- **Microsoft Graph API Docs:** _Populate as you build_
- **Shadcn/ui Docs:** _Populate as you build_