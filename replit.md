> Read `docs/AGENT_GUARDRAILS.md` first. This file holds tool-specific
> guidance only.

# Emergent Energy Web App

Last verified: 2026-05-07
Owner: Johannes Theo Potgieter (COO)

## Run & Operate
- **Run Dev Server:** `npm run dev`
- **Build:** `npm run build`
- **Typecheck:** `npm run check`
- **Codegen (Drizzle Kit):** `drizzle-kit generate`
- **DB Push (Drizzle Kit):** `npm run db:push`
- **Required Env Vars:** Azure MSAL credentials, Key Vault URI, database connection string.

## Build & publish (Replit)
- **Deploy build:** `npm run build && npm run db:migrate` (from `.replit [deployment]` — do not change without owner approval).
- **Run:** `npm run start`
- **Hosting:** Replit **autoscale**, single port **5000**.
- **Schema changes:** every change ships as a committed Drizzle migration file (`npm run db:generate`); deploy applies them via `drizzle-kit migrate`. A `db:push`-only change will **NOT** publish.
- **PR done = green:** `npm run check`, `npm run db:check`, `npm run test`, and `npm run build` all pass.
- **Secrets:** Replit Secrets Manager only — never in `.replit` or committed files.

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
See `docs/AGENT_GUARDRAILS.md` § 4 (canonical spine), § 4A (Hold/Blocked), § 4B (comms-to-project linkage), and `docs/architecture.md`.

## Product
See the C&I Solar Delivery Playbook v2.0 at `docs/operating-model/playbook-v2.0.md`.

## User preferences
See `docs/AGENT_GUARDRAILS.md` § 2 (communication style — universal across all agents).

## Gotchas
See `docs/AGENT_GUARDRAILS.md` § 9 (Smart Import engine rules), § 6 (database & migrations governance), and § 3 (financial-formula integrity).

## Pointers
See `docs/AGENT_GUARDRAILS.md` for the canonical reference index.
