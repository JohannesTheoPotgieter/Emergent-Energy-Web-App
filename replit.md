> Read `docs/AGENT_GUARDRAILS.md` first. This file holds tool-specific
> guidance only.

# Emergent Energy Web App

Last verified: 2026-05-07
Owner: Johannes Theo Potgieter (COO)

An internal operations platform for a South African C&I solar EPC company, streamlining project lifecycle management, centralizing data, and providing critical business insights.

## Run & Operate
- **Run Dev Server:** `npm run dev`
- **Build:** `npm run build`
- **Typecheck:** `npm run check`
- **Codegen (Drizzle Kit):** `drizzle-kit generate`
- **DB Push (Drizzle Kit):** `npm run db:push`
- **Required Env Vars:** Azure MSAL credentials, Key Vault URI, database connection string.

## Stack
- **Frontend:** React 19, TypeScript, Vite, wouter, Tailwind CSS v4, shadcn/ui, TanStack React Query v5, React Hook Form, Zod.
- **Backend:** Node.js, Express 5, TypeScript, Zod.
- **Database:** PostgreSQL (production), SQLite (development).
- **ORM:** Drizzle ORM.
- **Build Tool:** Vite.

## Where things live
- **Client Source:** `client/src/`
- **Server Source:** `server/`
- **Shared Code:** `shared/` (e.g., `shared/schema/*.ts` for DB schema, `shared/permissions/` for permission definitions, `shared/phases.ts` for canonical phase cycle, `shared/config/kpi-registry.ts` for KPI definitions, `shared/config/qb-allocations.ts` for QuickBooks allocation rules)
- **Database Migrations:** `/migrations/` at repo root
- **QA & Tests:** `qa/`
- **Public Assets:** `client/public/`
- **Theme Files:** Defined via CSS variables in `client/src/index.css` and `tailwind.config.ts`.
- **API Contracts:** Defined implicitly by Zod schemas in `server/routes/<name>.routes.ts` (new) or `server/*-routes.ts` (legacy) and `shared/schema/`.

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
- Always run `npm run typecheck` before committing to catch type errors early.
- Database migrations must be additive; use `drizzle-kit generate` and review generated SQL carefully before pushing.
- Changes to `shared/schema` require corresponding Drizzle Kit commands.
- Smart Import conflict resolution requires careful user intervention for 3-way merges.
- **Smart Import baseline lookup is id-first**, not business-key-first. The S001 externalRef pre-pass in `row-matcher.ts` can pair a file row to a DB row whose business keys differ (e.g. renamed task) — `mr.businessKey` then holds the FILE row's key while the baseline row lives under the DB row's key. `buildBaselineLookup` (server/lib/import/conflict-engine.ts) returns both `byRowId` and `byBusinessKey`; `mergeSection` MUST prefer `mr.existingRowId` and fall back to business key only for the legacy `summaryJson.normalization` baseline path. Reverting to a key-only lookup re-introduces the "BASELINE: empty" false-conflict bug.
- **`scripts/drizzle-bootstrap.ts` MUST get a probe entry for every new migration.** The deploy build runs `tsx scripts/drizzle-bootstrap.ts && drizzle-kit migrate`. The bootstrap seeds `drizzle.__drizzle_migrations` so the migrator doesn't try to re-apply the non-idempotent `0000_baseline_*.sql` against the long-lived push-managed prod DB. Critically, the pg dialect's migrator (`node_modules/drizzle-orm/pg-core/dialect.js`) only applies entries with `when > MAX(created_at)` — it's a watermark, NOT per-hash matching. So if you add a new migration after the journal rebuild and DON'T register a probe in `MODERN_MIGRATION_PROBES`, the bootstrap will mark it as "presumed applied" (insert a row) and prod will silently skip the DDL. Symptom: 500s on routes that touch the new table/column with `Failed query: ... column does not exist`. Required: every migration with `when > 1777895558912` (post-rebuild) needs a tag → canary-probe entry. The probe must be a cheap SELECT-only check that returns true iff the migration's signature DDL artifact already exists. When a probe says "missing", the bootstrap drops the watermark below that entry's `when` so drizzle replays it (and every later journal entry, in order). All modern migrations MUST therefore be idempotent (`IF NOT EXISTS` / `DO` blocks) so the replay is a safe no-op when the artifact already partially exists.
- **Smart Import snapshot fallback is FIELD-level, not row-level.** Both engines (planner: `loadBaselineFromSnapshots` in `server/lib/import/baseline.ts`; writer: `mergeRow` in `server/lib/import/merge-engine.ts`) must skip null/undefined values inside `importSnapshot` and fall back to the live DB row at the field level. Reverting to row-level fallback (`importSnapshot ?? existingRow`) re-introduces hundreds of phantom "BASELINE: empty" conflicts whenever a row's snapshot was written by an older import with a smaller tracked-fields set, or stored explicit nulls for fields the workbook left empty. The two engines MUST use the same rule or the planner and writer disagree on the conflict set and the wizard bounces with "More conflicts found — data changed while you were resolving".

## Pointers
- **React Query Docs:** _Populate as you build_
- **Drizzle ORM Docs:** _Populate as you build_
- **Tailwind CSS Docs:** _Populate as you build_
- **Zod Docs:** _Populate as you build_
- **Express Docs:** _Populate as you build_
- **Microsoft Graph API Docs:** _Populate as you build_
- **Shadcn/ui Docs:** _Populate as you build_