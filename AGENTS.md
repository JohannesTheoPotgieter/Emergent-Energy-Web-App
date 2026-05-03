# AGENTS.md — Emergent Energy Web App

## Stack
- TypeScript (version 6.0.3), Node.js, Express 5, React 19, Drizzle ORM 0.45.2, PostgreSQL
- Frontend: Vite, Tailwind CSS v4, Radix UI, TanStack Query v5, Wouter
- Testing: Vitest, Playwright, Supertest

## Commands
- Type check: `npm run check`
- Unit tests: `npm run test`
- API tests: `npm run test:api`
- Route check: `npm run check:routes-migration`
- Duplicate routes: `npm run check:duplicate-routes`
- Generate migration: `npm run db:generate` (NEVER run `npm run db:migrate` — that is done manually)
- Lint: `npm run lint`
- Format: `npm run format`

## File Patterns
- New route files go in: `server/routes/<name>.routes.ts`
- Register new routes in: `server/routes/index.ts`
- DB access only via: `server/repositories/`
- Shared types: `shared/types/`, `shared/schema/`
- Client pages: `client/src/pages/`
- Client components: `client/src/components/`

## Business Rule Invariants — NEVER VIOLATE
1. COS is only realised when an invoice is captured under actuals.
2. An invoice without a PO must have `no_po_flag = true` and be logged in audit.
3. Payment receipt date drives revenue realisation logic.
4. Every query against a snapshot table MUST include `isNull(table.effectiveTo)`.
5. No approval bypass can exist without an entry in `server/audit-logger.ts`.
6. The PD → PM handover gate must be explicitly approved before lifecycle advances.

## Security Rules
- Do NOT read, log, or relay any file in `server/secrets/` or `.env`
- Do NOT run `env`, `printenv`, `cat .env`, or equivalent
- Do NOT run `npm run db:migrate` — generate only
- Do NOT run any `DROP TABLE` or destructive migration without my explicit approval
- Do NOT install new npm packages without listing them and getting my approval first

## Scope Rules
- If you notice something out of scope, log it in CODEX_FINDINGS.md and continue
- Do NOT refactor code you were not asked to change
- Do NOT rename variables outside the target file
