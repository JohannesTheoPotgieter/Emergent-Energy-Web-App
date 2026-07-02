# Emergent Energy Web App

Internal operations platform for a South African C&I solar EPC company —
project delivery, finance/reporting, document management, and Microsoft 365 /
QuickBooks / Pipedrive integrations.

Full-stack TypeScript monorepo: **React 19 + Vite** (client) · **Express 5**
(server) · **Drizzle ORM + PostgreSQL** · hosted on **Replit** (autoscale,
single port 5000).

> 🔒 **FINANCE FROZEN** — the finance feature is under an owner-imposed lock.
> Do **not** change finance computation code. The frozen surface and the only
> permitted human touches are documented in
> [`FINANCE_FROZEN.md`](FINANCE_FROZEN.md) and
> [`docs/finance-freeze-runbook.md`](docs/finance-freeze-runbook.md).

## Quick start (zero-config)

Requires **Node 20 or 22** and npm 10.

```bash
npm ci        # install pinned deps from package-lock.json
npm run dev   # Express + Vite (SPA) on http://localhost:5000
```

That's it — no `.env` or database needed to run locally:

- With **no `DATABASE_URL`**, the app uses a local **SQLite** fallback.
- With **no integration credentials**, it serves **mock connector data** for
  Microsoft 365 / QuickBooks / Pipedrive, so every integrated page works on a
  fresh clone. (See `server/lib/connector-mode.ts`; details in
  [`docs/dev-setup.md`](docs/dev-setup.md).)

Only create a `.env` if you need real Postgres or a live integration locally —
and if you do, read the top of [`.env.example`](.env.example) first (copying it
verbatim will disable the zero-config path).

## Everyday commands

```bash
npm run dev            # dev server (Express + Vite middleware) on :5000
npm run check          # full TypeScript check (server + client)
npm run lint           # ESLint (flat config)
npm run test           # unit tests (vitest; no DB, no server)
npm run build          # production build -> dist/
npm run db:check       # schema-drift guard (no DB needed)
```

DB-backed suites (`test:api`, `test:smoke`, `test:workflows`) boot a server via
`script/run-with-app.ts`. The full local gate is `npm run qa:full-proof`.

## What CI actually runs

The single PR gate is `.github/workflows/pr-checks.yml` (on PRs to `main`):
`ci:compile` (turbo lint + check + build, then permission-contract tests) →
`db:check` → `check:agent-docs` → `test`. API/smoke/release-gate suites are
**not** run in CI — run them locally before a substantial merge.
`.github/workflows/db-backup.yml` runs the daily backup + tested-restore drill.

## Deploy (Replit)

Autoscale, single port 5000. Build = `npm run build && npm run db:migrate`;
run = `npm run start`. Secrets live in the Replit Secrets Manager (never in
committed files). Full procedure and rollback:
[`docs/runbooks/deploy-and-rollback.md`](docs/runbooks/deploy-and-rollback.md).

## Where to go next

- **New maintainer? Start here:** [`HANDOVER.md`](HANDOVER.md)
- **Local dev / testing:** [`docs/dev-setup.md`](docs/dev-setup.md)
- **Documentation index:** [`docs/README.md`](docs/README.md)
- **Architecture & rules (canonical):** [`docs/AGENT_GUARDRAILS.md`](docs/AGENT_GUARDRAILS.md)
  and [`docs/architecture.md`](docs/architecture.md)
- **AI-agent context:** [`CLAUDE.md`](CLAUDE.md)
