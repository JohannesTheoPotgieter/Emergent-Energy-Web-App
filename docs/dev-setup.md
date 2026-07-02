# Developer Setup

Quick start for working on the Emergent Energy web app. Pair with the root
[`README.md`](../README.md), [`replit.md`](../replit.md) (architecture), and
[`AGENT_GUARDRAILS.md`](./AGENT_GUARDRAILS.md) (the rules).

## Prerequisites

- **Node.js 20 or 22** (Replit and CI pin Node 20; Node 22 works locally).
  npm 10+ ships with both.
- **PostgreSQL 16** only for work that needs a real database — the dev
  fallback uses `better-sqlite3`, which is enough for most local work and all
  unit tests.
- Optional: a Microsoft 365 dev tenant for live SharePoint/Outlook work. Not
  needed day-to-day — mock connectors cover it (see below).

## First-time setup (zero-config)

```bash
npm ci        # install pinned deps from package-lock.json
npm run dev   # Express + Vite middleware on http://localhost:5000
```

No `.env` and no database are required:

- **No `DATABASE_URL`** → the app uses a local SQLite fallback
  (`server/db-config.ts` falls back only when `DATABASE_URL` is absent).
- **No integration creds** → mock connector data is served for MS 365 /
  QuickBooks / Pipedrive when `NODE_ENV !== "production"` (see
  `server/lib/connector-mode.ts` and `server/mocks/*-fixtures.ts`), so every
  integrated page works on a fresh clone.

### Only if you need Postgres or a real integration locally

Read the top of [`.env.example`](../.env.example) **before** creating a `.env`.
Do **not** `cp .env.example .env` and uncomment the placeholder
`DATABASE_URL`/`SESSION_SECRET`/`JWT_SECRET` — that forces Postgres mode against
a bogus URL and breaks the zero-config path. Set only the vars you actually need:

```bash
# with a real DATABASE_URL exported/set in .env:
npm run db:push   # sync shared/schema/*.ts to $DATABASE_URL (dev only; destructive)
npm run db:setup  # db:push + seed users & reference data (needed for login)
```

## Common commands

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Express + Vite on port 5000                           |
| `npm run check`        | Server + client TS check                              |
| `npm run check:client` | Client-only TS check (fastest)                        |
| `npm run lint`         | ESLint flat config                                    |
| `npm run test`         | Vitest unit tests (no DB, no server)                  |
| `npm run test:api`     | API tests via `script/run-with-app.ts` (boots server) |
| `npm run test:smoke`   | Playwright smoke (all routes × all roles)             |
| `npm run db:push`      | Apply schema to `$DATABASE_URL` (dev only; destructive) |
| `npm run qa:full-proof`| Full local gate (check + api + smoke + gates) — slow  |

Iterate with targeted single-test runs; `qa:full-proof` is for release only.
Turbo (`.turbo/`) caches `lint`/`check`/`build`/`test` locally — no remote
cache or extra credentials are involved.

## Local Playwright (smoke tests)

`script/run-with-app.ts` boots Express, waits for `/api/health`, runs
Playwright, then shuts the server down:

```bash
# In this remote environment Chromium is preinstalled; locally, one-time:
npm run test:smoke:install   # playwright install chromium
npm run test:smoke           # boots app + runs the suite
```

Iterate on one spec against an already-running `npm run dev`:

```bash
npx playwright test -c qa/playwright.config.ts qa/tests/e2e/smoke.spec.ts
npx playwright show-report qa/artifacts/e2e/report   # open a failed run's trace
```

### Test users

The suite logs in as four fixture users (see `qa/tests/e2e/smoke.spec.ts`
`TEST_USERS`). They exist in the seed data — run `npm run db:setup` against a
fresh `DATABASE_URL` first.

| Role key         | Username | Password | App role             |
| ---------------- | -------- | -------- | -------------------- |
| `admin`          | johannes | 2023     | COO_ADMIN            |
| `pm`             | eon      | 2035     | PROJECT_MANAGER_SITE |
| `engineer`       | paul     | 2029     | ENGINEER             |
| `qualityManager` | dean     | 2025     | QUALITY_MANAGER      |

> These are local seed/fixture credentials only. Production admin passwords are
> set via `SEED_COO_ADMIN_PASSWORD` / `SEED_CEO_ADMIN_PASSWORD` — see
> [`.env.example`](../.env.example).
