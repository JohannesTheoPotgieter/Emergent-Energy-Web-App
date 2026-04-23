# Emergent Energy Web App — Claude Code Context

Internal operations platform for a South African C&I solar EPC company.
Full-stack TypeScript monorepo: React 19 + Vite (client) + Express 5 (server) +
Drizzle ORM + PostgreSQL. Hosted on Replit. See `replit.md` for full architecture
and `docs/architecture.md` for the architecture baseline.

**Last verified:** 2026-04-15 (see "Keeping this file fresh" at bottom)

## Commands

- `npm run dev` — Start Express server on port 5000. Vite is mounted as middleware
  via `server/vite.ts`, so the SPA is served from the same port in dev.
- `npm run dev:client` — Vite-only dev server (rarely needed; use `npm run dev`).
- `npm run build` — Build via `script/build.ts` (server → `dist/index.cjs` CJS,
  client → `dist/public/`).
- `npm run start` — Run production build (`node dist/index.cjs`).
- `npm run check` — Full TypeScript check (server + client scoped configs).
- `npm run check:client` — Client-only TS check (fastest).
- `npm run lint` / `npm run lint:fix` — ESLint 9 flat config.
- `npm run test` — Vitest unit tests (excludes API/e2e/integration).
- `npm run test:api` — API tests via `script/run-with-app.ts` wrapper (boots server).
- `npm run test:smoke` — Playwright smoke suite (all routes × all roles).
- `npm run qa:full-proof` — Full quality gate (check + test:api + test:smoke +
  test:routes + test:workflows + reconciliation + release:gate).
- `npm run db:push` — Sync `shared/schema.ts` to `$DATABASE_URL` via
  `drizzle-kit push --force`. Dev-only; destructive — will drop columns that
  exist in the DB but not in the schema.
- `npm run db:generate` — After editing `shared/schema/*.ts`, run this with
  `--name=<short_snake_case>` to produce a new migration file next to the
  baseline.
- `npm run db:migrate` — Apply pending migrations in order (tracked via
  `migrations/meta/_journal.json` + the `__drizzle_migrations` table on the
  target DB).
- `npm run db:check` — CI guard. Fails if `shared/schema/*.ts` was edited
  without a matching new migration file. Invoked on every PR.

## Project Structure

```
client/src/         React 19 SPA (Vite). Alias @/ → client/src/
server/             Express 5 API (TypeScript; tsx in dev, CJS bundle in prod)
server/routes/      NEW route location — use this for new routes (*.routes.ts)
server/*-routes.ts  LEGACY route location — do not create new files here
server/middleware/  Auth, RBAC, error handling, validation middleware
server/repositories/Data access layer — ALL db access goes through these
server/bootstrap/   Startup orchestrator (runs additive migrations & seeds)
server/lib/         Shared server utilities (api-error, logger, helpers)
server/imports/     Smart Import v2 runtime (conflict policy, etc.)
shared/schema/      Drizzle schema — 26 domain files (finance.ts, projects.ts, …)
shared/schema.ts    Barrel re-export of shared/schema/* — DO NOT add tables here
shared/             Shared types, permissions, roles, KPI defs, validators
migrations/         Drizzle-managed SQL migrations (repo root — NOT server/)
qa/                 Vitest unit + API tests, Playwright e2e
qa/release-gate.ts  Must pass before any release
```

**Aliases**

- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

## Schema Rules — CRITICAL

- **Source of truth is `shared/schema/*.ts` (26 domain files).** `shared/schema.ts`
  is only a barrel re-export — do NOT add tables there.
- When adding a table, edit the relevant domain file: `finance.ts`, `projects.ts`,
  `users.ts`, `engineering.ts`, `tasks.ts`, `quality.ts`, `imports.ts`, etc.
- Do not create route-local interfaces that duplicate inferred schema types. Use
  `typeof table.$inferSelect` or `$inferInsert`, or the exported `Insert*`/`*`
  types next to each table definition.
- Drizzle version: `drizzle-orm@0.45.2` with `drizzle-zod@0.7.0`.

## Database Rules — CRITICAL

- **ORM:** Drizzle. Avoid raw SQL unless unavoidable; when you do, use
  `sql` tagged template + parameters — never string interpolation.
- **Dual-mode:** PostgreSQL in prod via `DATABASE_URL`; `better-sqlite3` fallback
  in dev. **Avoid PostgreSQL-specific syntax** (`::` casts, certain enum tricks,
  `RETURNING` edge cases) unless guarded — it breaks the SQLite dev path.
- **Snapshot tables — `effective_to IS NULL` guard:** Any aggregate query over
  the following tables MUST filter out historical snapshots with
  `isNull(table.effectiveTo)` (Drizzle) or `effective_to IS NULL` (raw SQL).
  Failing to do so double-counts history.
  - `normalizedCostLines` (current — use this)
  - `normalizedRevenueLines` (current — use this)
  - `cashflowPoints`
  - `financeRevenueMonthly`
  - `financeCosMonthly`
  - `categoryRevenueAllocations`
  - `projectRevenueSummary`
  - Note: `ProgramExpense` / `ProgramInflows` are **deprecated PE/PI type shapes**
    in `shared/schema/finance.ts` — do not use for new code; use
    `normalizedCostLines` / `normalizedRevenueLines` instead.
- **Migrations location:** `/migrations/` at the repo root. The current
  baseline is `0000_baseline_20260419.sql`; new migrations are generated
  next to it by `npm run db:generate`. Do NOT hand-write migrations — the
  journal (`migrations/meta/_journal.json`) is the source of truth for
  what Drizzle considers applied. Do NOT put migrations in
  `server/migrations/` — that directory only holds one-off TS scripts.
- **Historical migrations:** the 225 pre-baseline migrations live in
  `migrations/archive/` for reference only. They are NOT re-applied by
  any tooling; prod DBs already contain their effects. See
  `migrations/archive/README.md`.
- **Schema-drift CI guard:** `npm run db:check` runs `drizzle-kit generate`
  in a sandbox and fails if it would produce a new SQL file — meaning the
  schema and the committed migrations are out of sync. The CI workflows
  run this on every PR.
- **Migrations policy:** Additive only. Every new migration must use
  `IF NOT EXISTS` / `IF EXISTS` guards. Never destructively
  `ALTER TABLE … DROP` or `RENAME` without an explicit multi-step safe-
  migration plan.
- **`work_items`:** Writes go directly to `public.work_items` via Drizzle. The
  writable-view architecture was retired (see
  `migrations/20260409_retire_work_items_view.sql`). The files
  `server/work-items-adapter.ts` and `server/work-items-backfill.ts` are legacy
  — read-only reference; do not extend them for new features.
- **Repository layer:** CRUD in routes must go through `server/repositories/*`.
  Route files must not call `db.select()` / `db.insert()` directly.

## Authentication & RBAC

- **Primary:** Microsoft SSO via Azure MSAL (`@azure/msal-node`).
- **Fallback:** username/password (`bcryptjs`).
- **Secrets:** Azure Key Vault in production (`@azure/keyvault-secrets`).
- **Authoritative role list:** `shared/schema/users.ts` — `COMPANY_ROLES`
  constant (currently 16 roles: COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER,
  PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER, QUALITY_MANAGER,
  ENGINEERING_MANAGER, KEY_ACCOUNTS_MANAGER, ACCOUNTANT, ENGINEER,
  PROJECT_MANAGER_SITE, PROJECT_DEVELOPER, HSE_MANAGER, SSEG_MANAGER).
  Always read this file — never hardcode the list.
- **Server-side enforcement:** Use `requireAuth` from
  `server/middleware/requireAuth.ts` and `requireRole` from
  `server/middleware/requireRole.ts`. Do NOT implement client-side-only
  permission checks for sensitive actions.
- **Session:** `express-session` with role stored; MS identity maps via
  `ms_user_id` / email.

## API Style

- REST, grouped by domain.
- **NEW route files:** `server/routes/<domain>.routes.ts` (dot-separator pattern).
  Register in `server/routes/index.ts` and wire into `server/routes.ts`.
- **LEGACY route files:** `server/*-routes.ts` (hyphen pattern). Do not create
  new files in this style — only edit existing ones when fixing or extending
  legacy domains.
- **Errors:** throw `ApiError` from `server/lib/api-error.ts`. Never expose raw
  DB errors, stack traces, or Drizzle error objects to the client.
- **Validation:** validate all request bodies with Zod (`validateBody` middleware
  in `server/middleware/validateBody.ts`).

## Frontend Rules

- **State:** TanStack React Query v5 for server state. React local state for UI.
- **Forms:** React Hook Form + `@hookform/resolvers` + Zod schemas.
- **Components:** shadcn/ui (New York style) + Radix UI primitives + Lucide icons.
- **Styling:** Tailwind CSS v4. Theme: white + emerald (`#16A34A`).
  Fonts: Barlow / Inter / JetBrains Mono.
- **Routing:** `wouter` (lightweight — NOT React Router). SPA only; no RSC.

## Smart Import v2 (Excel) Rules

- **Current pipeline:** `server/smart-import-routes.ts` + `server/imports/`.
  See `docs/smart-import-v2-spec.md`, `smart-import-v2-operator-guide.md`, and
  `smart-import-v2-known-limitations.md`.
- `server/excelParser.ts` and `server/importPipeline.ts` are **legacy** — do not
  extend for new Smart Import v2 work; reference only.
- **Projects upsert by `projectCode`.** NEVER wipe other projects on import.
- **Line IDs are hash-based** (`expense_line_id`, `inflow_line_id`) — preserve
  them across imports.
- **Overrides/scenarios are stored separately with an audit trail.** Never
  overwrite imported baseline rows with override values.

## Local QA: mock connectors

- **External integrations** (MS Graph / Outlook / SharePoint / Teams,
  QuickBooks, Pipedrive) auto-serve fixture data when their creds are
  absent AND `NODE_ENV !== "production"`. This lets a fresh clone exercise
  every integrated page without real tenant tokens.
- Gate lives in `server/lib/connector-mode.ts`. Decision order per
  integration: (1) prod → real only; (2) `USE_MOCK_CONNECTORS=false` →
  force real; (3) `USE_MOCK_CONNECTORS=true` → force mock; (4) creds
  present → real; (5) creds absent → mock.
- Fixtures live in `server/mocks/{ms-graph,quickbooks,pipedrive}-fixtures.ts`.
  Adjust them when the UI needs new realistic data for a scenario.
- Prod is strictly `NODE_ENV`-gated — the flag has no effect there.

## Microsoft 365 Integration

- **Graph client:** `@microsoft/microsoft-graph-client` via
  `server/ms-account-service.ts`.
- **Sync service:** `server/ms-sync-service.ts` (delta queries + subscriptions).
- **SharePoint intake:** `server/sharepoint-list.ts` → Engineering Support
  "Proposals Pipeline" list. Sync is **COO-only**, manual trigger (Pull/Push).
- **NEVER store full email bodies or file contents in the DB.** Store metadata
  + deep links only. Full attachments live in SharePoint/Outlook.
- Mock connector is available for dev/test when Graph tokens are unavailable.

## TypeScript Rules

- Avoid `any`. Use Drizzle-inferred types from `shared/schema/*` or add to
  `server/types/`. See `server/TYPING_GUIDE.md` for server conventions.
- ES modules everywhere in source. Server builds to CJS for prod (see
  `script/build.ts`); dev runs under `tsx`.
- Run `npm run check` (or `check:client` for frontend-only changes) after any
  batch of edits. Do NOT silence errors with `@ts-ignore` or `as any`.

## Security Rules

- NEVER commit `.env*`. All prod secrets go through Azure Key Vault.
- Bank detail fields are encrypted — follow the pattern in
  `scripts/encrypt-existing-bank-details.ts`.
- Input validation with Zod at all system boundaries (request bodies,
  file uploads, external API payloads).
- `helmet` + CSRF middleware are configured in `server/middleware/` — don't
  disable them.

## Testing Rules

- Write tests in `qa/tests/`.
- Prefer targeted single-test runs during iteration — the full suite is slow.
- API tests require the `script/run-with-app.ts` wrapper (starts server first).
- Before release, `npm run qa:full-proof` must pass (`qa/release-gate.ts`
  enforces this).

## CI Rules

- **Authoritative PR workflow:** `.github/workflows/pr-checks.yml` on
  `pull_request` to `main` only. It runs:
  `npm run ci:compile` → `npm run db:check` → `npm run test` → `npm run test:api`
  → `npm run release:gate` (`SKIP_SMOKE_TESTS=true` in CI).
- **Push workflow:** `.github/workflows/ci.yml` runs on `push` to `main` only
  and mirrors the same gate logic for post-merge confidence.
- **Unit tests** (`npm run test`) run on every PR — no Postgres needed. A new
  regression in any pinned invariant (finance math, error leaks, schema
  drift, route inventory) fails at this stage.
- **Schema-drift guard** (`npm run db:check`) — runs `drizzle-kit generate`
  in a sandbox; fails any PR that edited `shared/schema/*.ts` without a
  matching new migration file.
- **Replit deploy health is NOT CI health.** Replit deploy uses `.replit`
  (`npm run build` / `npm run start`) and can be green while PR checks are red.
  Treat GitHub PR checks as merge authority.
- **Branch protection on `main`** is configured via GitHub UI. Docs in this
  repo can describe intent, but only the GitHub settings are authoritative.
- **Auth rate-limit loopback exemption** — `127.0.0.1` / `::1` are exempt
  from the auth rate-limiter when `NODE_ENV !== "production"`, so local
  `npm run test:api` and dev flows aren't blocked after 20 logins. The gate
  is strictly NODE_ENV-based — prod is always rate-limited.

## Working With This Codebase — Rules for Claude

1. **Constrain scope before coding.** Server has 60+ large route files. Never
   "explore the whole codebase" — name the specific files you will read for a
   task and ignore the rest.
2. **Plan before implementing.** For any non-trivial task, produce a plan
   (files changed, schema changes, migrations, RBAC, tests) and wait for
   approval before writing code.
3. **Trust canonical files over CLAUDE.md for volatile facts.** If this file
   disagrees with the actual role list in `shared/schema/users.ts:77`, the
   schema file wins.
4. **Do not run the full test suite during iteration.** Use targeted runs;
   `npm run qa:full-proof` is for release only.
5. **Do not create files you were not asked to create.** No speculative helpers,
   no README updates, no doc rewrites unless explicitly requested.

## Do NOT

- ❌ Put new migrations in `server/migrations/` (they belong in root `/migrations/`).
- ❌ Add tables to `shared/schema.ts` (it's a barrel — edit `shared/schema/*.ts`).
- ❌ Use `::` cast syntax in queries (breaks SQLite dev fallback).
- ❌ Create route files as `server/<name>-routes.ts` (use `server/routes/<name>.routes.ts`).
- ❌ Call `db.select()` / `db.insert()` directly inside route handlers
  (go through `server/repositories/`).
- ❌ Import `requireRole` from `server/permission-middleware.ts`
  (correct path is `server/middleware/requireRole.ts`).
- ❌ Skip `isNull(effectiveTo)` on snapshot-table aggregate queries.
- ❌ Store full email bodies / attachment content in the DB.
- ❌ Silence TypeScript errors with `as any` or `@ts-ignore`.
- ❌ Run `npm run qa:full-proof` during normal iteration (too slow).

## Keeping This File Fresh

This file encodes facts that will drift. Re-verify each section when any of
the following change:

- `shared/schema/users.ts` `COMPANY_ROLES` constant → update role list.
- Schema temporal columns (`effectiveTo`) → update snapshot-table list.
- Route-file migration progress (`server/routes/` vs `server/*-routes.ts`) →
  update API Style section.
- Migration retirements (view retirements, legacy-file deprecations) →
  update Database Rules / Do NOT sections.
- Smart Import v2 pipeline location → update Excel Rules section.

**To refresh:** re-run the same checks used when this file was first drafted
(see `docs/claude-code-mastery-guide.md` § "Keeping CLAUDE.md fresh"), bump
the `Last verified` date at the top, and commit.
