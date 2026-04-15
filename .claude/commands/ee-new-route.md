---
description: Scaffold a new route domain following the current server/routes/*.routes.ts convention.
---

I need a new route domain: $ARGUMENTS

Follow the **current** (not legacy) conventions from `CLAUDE.md`:

## Step 1 — Read only these files

- `server/routes.ts` — top-level router wiring
- `server/routes/index.ts` — new-style route registration
- Any existing `server/routes/<similar>.routes.ts` that resembles the domain
  (pick ONE representative; don't read the whole directory)
- `server/middleware/requireAuth.ts`
- `server/middleware/requireRole.ts`
- `server/lib/api-error.ts`
- `shared/schema/users.ts` — for the `COMPANY_ROLES` constant (authoritative
  role list — never hardcode roles)

Do NOT read the legacy `server/*-routes.ts` files unless I specifically ask.

## Step 2 — Plan (do not write code yet)

Produce a plan covering:

1. New file path: `server/routes/<domain>.routes.ts` (dot-separator, NOT
   `server/<domain>-routes.ts`).
2. Which `COMPANY_ROLES` values gate each endpoint.
3. Which repository in `server/repositories/` the handlers will call.
   If a new repository is needed, name it and list its methods.
4. Request/response Zod schemas (use `validateBody` middleware).
5. Where the new router is registered in `server/routes/index.ts` +
   `server/routes.ts`.
6. Tests to add under `qa/tests/` (unit first, API second if needed).

**Wait for my approval before implementing.**

## Step 3 — Implement

After I approve:

- Create the route file at `server/routes/<domain>.routes.ts`.
- Use `requireAuth` from `server/middleware/requireAuth.ts`.
- Use `requireRole([...])` from `server/middleware/requireRole.ts`.
- Throw `ApiError(status, message)` from `server/lib/api-error.ts` for all
  error cases. Never leak raw DB errors.
- All DB access goes through the repository — no `db.select()` etc. in the
  route file.
- Register the router in `server/routes/index.ts` and `server/routes.ts`.
- Add tests.

## Step 4 — Verify

- Run `npm run check` and fix any TypeScript errors at the source (no
  `as any`, no `@ts-ignore`).
- If tests were added, run them with a targeted vitest invocation (not the
  full suite).
