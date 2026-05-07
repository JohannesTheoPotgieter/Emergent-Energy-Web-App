> Read `docs/AGENT_GUARDRAILS.md` first. This file holds tool-specific
> guidance only.

# AGENTS.md — Emergent Energy Web App

## Stack
- TypeScript (version 6.0.3), Node.js, Express 5, React 19, Drizzle ORM 0.45.2, PostgreSQL
- Frontend: Vite, Tailwind CSS v4, Radix UI, TanStack Query v5, Wouter
- Testing: Vitest, Playwright, Supertest

## Commands
- `npm run build`
- `npm run check`
- `npm run test`
- `npm run test:api`
- `npm run check:routes-migration`
- `npm run check:duplicate-routes`
- `npm run db:generate`
- `npm run db:migrate` — See docs/AGENT_GUARDRAILS.md § 6.
- `npm run lint`
- `npm run format`

## File Patterns
- New route files go in: `server/routes/<name>.routes.ts`
- Register new routes in: `server/routes/index.ts`
- DB access only via: `server/repositories/`
- Shared types: `shared/types/`, `shared/schema/`
- Client pages: `client/src/pages/`
- Client components: `client/src/components/`

## Business Rule Invariants
Business Rule Invariants — see docs/AGENT_GUARDRAILS.md § 3, § 3A.

## Security Rules
Security Rules — see docs/AGENT_GUARDRAILS.md § 5, § 5A.

## Scope Rules
- If you notice something out of scope, log it in CODEX_FINDINGS.md and continue
- Do NOT refactor code you were not asked to change
- Do NOT rename variables outside the target file

## Verification
Last verified: 2026-05-07. Owner: Johannes Theo Potgieter (COO).
