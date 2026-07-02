> Read `docs/AGENT_GUARDRAILS.md` first. This file holds tool-specific
> guidance only.

# Emergent Energy Web App — Claude Code Context

**Last verified:** 2026-05-07. Owner: Johannes Theo Potgieter (COO).

Internal operations platform for a South African C&I solar EPC company.
Full-stack TypeScript monorepo: React 19 + Vite (client) + Express 5 (server) +
Drizzle ORM + PostgreSQL. Hosted on Replit. See `replit.md` for full architecture
and `docs/architecture.md` for the architecture baseline.

## Finance — canonical source, Definition of Done, and FREEZE

- **Single source of finance rules:** `docs/finance-source-of-truth-audit.md` **Part I** (enforced by
  `docs/AGENT_GUARDRAILS.md` § 3 + § 3B, SETTLED). These rules are **locked** — implement and verify
  them; do **not** re-litigate or propose formula changes.
- **Definition of Done = the four goalposts (scope fence):** (GP1) replicate the tracker exactly;
  (GP2) REV/COS/GP by FY/month/project/line/invoice + cashflow by week/line/invoice; (GP3) tracker-vs-QB
  REV/COS at invoice level and GP at month level, matched on invoice no + ex-VAT amount; (GP4) AR/AP +
  past-dated missing-invoice worklist. **Deferred / out of scope:** VO impact, procure-to-pay
  (PO/payment/proof/financial-reviews/subcontractor — parked), VAT removal, board pack, commission.
- **FREEZE:** the finance computation paths (`server/repositories/finance-line-level-repository.ts`, the
  recognition/realisation predicates, `server/lib/fy-window.ts`, the cashflow engine, the QB matcher)
  are **frozen**. Do not modify them — formula/number/calculation changes need **explicit owner
  approval**. Number-preserving refactors are allowed only if `npm run verify:finance` and the finance
  unit tests stay green.

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
- `npm run db:migrate` — see `docs/AGENT_GUARDRAILS.md` § 6 (default:
  agents do not run; per-session user approval required). Chains
  `db:verify-schema --repair` after `drizzle-kit migrate`, so the deploy
  command cannot exit 0 while declared columns are missing.
- `npm run db:verify-schema` — ledger-independent proof that the live DB
  contains every table/column declared in `shared/schema/*.ts` (exit 1 on
  missing artifacts). Runs in CI (`migration-integrity` job) and the
  release gate.
- `npm run db:check` — CI guard. Fails if `shared/schema/*.ts` was edited
  without a matching new migration file, and validates migration-journal
  `when` integrity (strictly increasing, never future-dated). Invoked on
  every PR.

## Build & publish (Replit)

Deploys on Replit (**autoscale**), single port **5000**. The pipeline lives in
`.replit [deployment]` — do not change it without owner approval:

- **Deploy build:** `npm run build && npm run db:migrate`
- **Run:** `npm run start`

Rules that keep a change deploy-safe:

- **Every schema change ships as a committed Drizzle migration file.** Edit
  `shared/schema/*.ts`, then `npm run db:generate -- --name=<short_snake_case>`
  and commit the generated `migrations/*.sql` + `migrations/meta/*`. Deploy
  applies migrations via `drizzle-kit migrate`. A `db:push`-only change will
  **NOT** publish — `db:push` does not run on deploy.
- **A PR is not done until `npm run check`, `npm run db:check`, `npm run test`,
  and `npm run build` all pass.**
- **Secrets live in Replit Secrets Manager** — never in `.replit`, `replit.md`,
  or any committed file.

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
shared/schema/      Drizzle schema — 33 domain files (finance.ts, projects.ts, …)
shared/schema.ts    Barrel re-export of shared/schema/* — DO NOT add tables here
shared/             Shared types, permissions, roles, KPI defs, validators
migrations/         Drizzle-managed SQL migrations (repo root — NOT server/)
qa/                 Vitest unit + API tests, Playwright e2e
qa/release-gate.ts  Must pass before any release
```

**Aliases**

- `@/` → `client/src/`
- `@shared/` → `shared/`

## Pointers to canonical guardrails

Substantive rules live in `docs/AGENT_GUARDRAILS.md`. Do not duplicate them here.

- **Finance rules (SETTLED / frozen):** canonical = `docs/finance-source-of-truth-audit.md` Part I;
  enforcement = `docs/AGENT_GUARDRAILS.md` § 3 + § 3B. Do not propose finance formula changes.
- **Schema rules:** see `docs/AGENT_GUARDRAILS.md` § 6.
- **Database & migrations:** see `docs/AGENT_GUARDRAILS.md` § 6. Snapshot-table
  `effectiveTo IS NULL` guard is HARD — § 3.1.
- **Auth & RBAC:** see `docs/AGENT_GUARDRAILS.md` § 5. 16 company roles as of
  2026-05-07. Always read `shared/schema/users.ts` `COMPANY_ROLES` constant —
  never hardcode.
- **Frontend stack:** React 19 + Vite + wouter + TanStack Query v5 + React Hook
  Form + shadcn/ui (New York) + Tailwind v4 (white + emerald `#16A34A`). Boundary
  rules: see `docs/AGENT_GUARDRAILS.md`.
- **Smart Import v2:** see `docs/AGENT_GUARDRAILS.md` § 9 (load-bearing engine
  rules) and § 3.5–3.7 (HARD line-ID + planned-vs-actual rules).
- **Microsoft 365 integrations:** see `docs/AGENT_GUARDRAILS.md` § 4B and § 5.
  Metadata only — never store bodies / attachments (HARD § 5A).
- **TypeScript:** avoid `any` / `@ts-ignore`. See `docs/AGENT_GUARDRAILS.md` § 8.
- **Security:** see `docs/AGENT_GUARDRAILS.md` § 5 and § 5A (hard refusals).
- **Testing:** write tests in `qa/tests/`. Targeted runs during iteration;
  `npm run qa:full-proof` is release-only.

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

## Schema patterns to know

Three current vs deprecated surfaces agents currently miss:

- ✅ `email_project_links` and `teams_project_links` are the canonical
  comms-to-project tables. Use these for any new comms ingestion. Do not
  invent parallel "messages" / "activity" / "mentions" tables. See
  `docs/AGENT_GUARDRAILS.md` § 4B.
- ✅ `managed_documents` + `project_discipline_folders` (browse-and-bind) +
  `document_approval_requirements` are the current document-management surface.
  New document features attach here. Per project, per discipline, a user binds
  an EXISTING SharePoint folder (`project_discipline_folders`); tracked files
  hang off it via `managed_documents.discipline_folder_id`.
- 🚫 `controlled_documents`, `controlled_document_types`,
  `project_sharepoint_roots`, and (Phase 5) `folder_taxonomy` + `project_folders`
  + the manual folder-provisioning path are DEPRECATED/REMOVED. Do not
  reintroduce them.

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

## CI Rules

- **Authoritative PR workflow:** `.github/workflows/pr-checks.yml` on
  `pull_request` to `main` only. It runs:
  `npm run ci:compile` → `npm run db:check` → `npm run test` → `npm run test:api`
  → `npm run release:gate` (`SKIP_SMOKE_TESTS=true` in CI).
- **Push workflow:** `.github/workflows/ci.yml` runs on `push` to `main` only
  and mirrors the same gate logic for post-merge confidence.
- **Schema-drift guard** (`npm run db:check`) — runs `drizzle-kit generate`
  in a sandbox; fails any PR that edited `shared/schema/*.ts` without a
  matching new migration file.
- **Replit deploy health is NOT CI health.** Treat GitHub PR checks as merge
  authority.
- **Auth rate-limit loopback exemption** — `127.0.0.1` / `::1` are exempt
  from the auth rate-limiter when `NODE_ENV !== "production"`. Prod is always
  rate-limited.

## Working With This Codebase — Rules for Claude

1. **Constrain scope before coding.** Server has 60+ large route files. Never
   "explore the whole codebase" — name the specific files you will read for a
   task and ignore the rest.
2. **Plan before implementing.** For any non-trivial task, produce a plan
   (files changed, schema changes, migrations, RBAC, tests) and wait for
   approval before writing code.
3. **Trust canonical files over CLAUDE.md for volatile facts.** If this file
   disagrees with the actual role list in `shared/schema/users.ts`, the
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
- ❌ Silence TypeScript errors with `as any` or `@ts-ignore`.
- ❌ Run `npm run qa:full-proof` during normal iteration (too slow).
- ❌ Build a parallel comms / messages / activity table without `projectId`
  + `phaseAtLinkTime` (use `email_project_links` / `teams_project_links`).
- ❌ Mutate `phaseAtLinkTime` after creation (HARD — corrupts history).
- ❌ Extend `controlled_documents` / `controlled_document_types` /
  `project_sharepoint_roots`, or reintroduce `folder_taxonomy` /
  `project_folders` / manual folder provisioning (all deprecated/removed; use
  `managed_documents` + `project_discipline_folders` +
  `document_approval_requirements`).
- ❌ Store email bodies, attachment bytes, message contents, or transcripts
  in the DB (HARD — § 5A).
- ❌ Skip the canonical comms tables when ingesting from a new source
  (WhatsApp, Slack) — follow the email/teams `_project_links` shape.

## Keeping This File Fresh

This file is now a thin pointer. Re-verify when any of the following change:

- `shared/schema/users.ts` `COMPANY_ROLES` count → update the role-count line.
- Route-file migration progress (`server/routes/` vs `server/*-routes.ts`) →
  update API Style section.
- A new current/deprecated schema surface emerges → update Schema patterns
  to know.
- A guardrails section in `docs/AGENT_GUARDRAILS.md` is renumbered → update
  the pointer line.

**To refresh:** reconcile pointers against `docs/AGENT_GUARDRAILS.md`, bump the
`Last verified` date at the top, and commit.
