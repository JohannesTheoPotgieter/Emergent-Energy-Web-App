---
name: route-conventions
description: Use when creating, editing, or reviewing Express route files. Enforces the current server/routes/*.routes.ts pattern, repository-layer boundary, RBAC middleware, and ApiError usage. Documents the legacy server/*-routes.ts files as read-only.
---

# Route Conventions

## New vs Legacy

The server has **two route-file layouts** because of an in-progress migration:

| Pattern                              | Status         | Use for                          |
|--------------------------------------|----------------|----------------------------------|
| `server/routes/<domain>.routes.ts`   | **Current**    | All new route files              |
| `server/<domain>-routes.ts`          | Legacy         | Edit existing only; don't create |

If you're creating a new route domain, it goes under `server/routes/` as a
`*.routes.ts` file. Register it in `server/routes/index.ts` and wire into
`server/routes.ts`. A script `scripts/check-routes-migration.ts` tracks the
migration progress — consult it before making structural decisions.

## Required Imports

```ts
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { validateBody } from "../middleware/validateBody";
import { ApiError } from "../lib/api-error";
import { COMPANY_ROLES } from "@shared/schema"; // always read the authoritative list
```

**Do NOT import `requireRole` from `server/permission-middleware.ts`** — that
module does something else. The canonical path is
`server/middleware/requireRole.ts`.

## Standard Handler Shape

```ts
router.post(
  "/foo",
  requireAuth,
  requireRole(["COO_ADMIN", "PROGRAM_FINANCE_MANAGER"]),
  validateBody(fooInputSchema),
  async (req, res, next) => {
    try {
      const result = await fooRepository.create(req.body, req.user!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
```

Key invariants:

1. **`requireAuth` + `requireRole` on every sensitive endpoint.**
2. **No `db.*` calls inside the handler.** All CRUD goes through
   `server/repositories/*`.
3. **Throw `ApiError(status, message)`** from `server/lib/api-error.ts` for
   known error cases — never leak raw Drizzle / pg errors to the client.
4. **Zod validation** via `validateBody(schema)` for any request body. Build
   schemas from Drizzle using `createInsertSchema(table)` where possible.
5. **Do NOT hardcode role strings.** Reference `COMPANY_ROLES` values from
   `shared/schema/users.ts:77` — the current list has 16 roles, not 7.

## Role Values (for reference — authoritative list lives in users.ts)

```
COO_ADMIN, CEO_ADMIN, CCO, CFO,
PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER,
CONSTRUCTION_MANAGER, QUALITY_MANAGER, ENGINEERING_MANAGER,
KEY_ACCOUNTS_MANAGER, ACCOUNTANT, ENGINEER,
PROJECT_MANAGER_SITE, PROJECT_DEVELOPER,
HSE_MANAGER, SSEG_MANAGER
```

If this list disagrees with `shared/schema/users.ts` `COMPANY_ROLES`, the
schema file wins — update this skill.

## SQL Portability

Dual-mode DB: Postgres in prod, `better-sqlite3` fallback in dev. When writing
a query (Drizzle or raw), avoid:

- `::` type cast syntax
- Postgres-only `RETURNING` edge cases (most simple cases work)
- JSON operators (`->`, `->>`) without a guard

If a Postgres-only feature is unavoidable, guard the code path by detecting
the driver and provide a SQLite branch.

## Testing

New routes should have at least:

- A unit test for the handler logic (mock the repository)
- An API test under `qa/tests/api/` if the endpoint is user-facing

Run targeted tests during iteration — never the full suite.
