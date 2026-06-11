> Read `docs/AGENT_GUARDRAILS.md` first. This file holds tool-specific
> guidance only.

# AGENTS.md — Emergent Energy Web App

## Finance — READ THIS FIRST (Codex)
Before doing **any** finance work, read, in order:
1. `docs/finance-source-of-truth-audit.md` **Part I** — the single, canonical source of finance rules.
2. `docs/AGENT_GUARDRAILS.md` § 3 and § 3B (SETTLED — do not re-litigate).

Hard rules for Codex on finance:
- **Never propose finance formula / number / calculation changes.** The settled rules (revenue =
  category-scoped per-line POC `(Q ÷ X_category) × J_category`, recognised on invoice-raised date col T;
  receipt date col W = cashflow only; no-PO flag retired; single read path
  `finance-line-level-repository.ts`) are **final**. If a task seems to require changing one, stop and
  log it in `CODEX_FINDINGS.md` — do not edit.
- **Obey the audit-validity rule** (§ 3B S7): only Postgres / production audits with current guardrails
  count toward finance sign-off; local-SQLite runs report environment health only, never finance trust.
- **Run finance audits READ-ONLY against Postgres / production.** No writes, no mutations on prod.
- Finance code is **FROZEN** — changes need explicit owner approval (§ 3B S10).

The standalone `codex_finance_end_to_end_audit_prompt.md` is **superseded** by the canonical doc above.

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
Business Rule Invariants — see docs/AGENT_GUARDRAILS.md § 3, § 3A. **Finance invariants are SETTLED — see § 3B and `docs/finance-source-of-truth-audit.md` Part I; do not propose changes.**

## Security Rules
Security Rules — see docs/AGENT_GUARDRAILS.md § 5, § 5A.

## Scope Rules
- If you notice something out of scope, log it in CODEX_FINDINGS.md and continue
- Do NOT refactor code you were not asked to change
- Do NOT rename variables outside the target file

## Verification
Last verified: 2026-05-07. Owner: Johannes Theo Potgieter (COO).
