# Server TypeScript Typing Guide

## Which tsconfig does CI use?

CI runs `tsc -p tsconfig.check.json` (see `.github/workflows/ci.yml`).

`tsconfig.check.json` extends `tsconfig.json` and includes a specific subset of
server files. Both configs have `strict: true` and `noImplicitAny: true`.

Any file reachable through imports from the included files is also checked.
This means even if a file is not listed in `include`, removing `@ts-nocheck`
from it will expose type errors in CI if it's imported by a checked file.

**Always test locally with `npx tsc -p tsconfig.check.json --noEmit` before pushing.**

## How to type route handlers

### Query parameters

Express v5 types `req.query.*` as `string | ParsedQs | string[] | ParsedQs[]`.
Never use `req.query.param as string` — this hides a real type gap.

Use the helpers in `server/lib/req-parse.ts`:

```ts
import { queryStr, queryInt, paramStr, paramInt } from "../lib/req-parse";

// String query param with fallback
const status = queryStr(req, "status", "all");   // string (never undefined)
const filter = queryStr(req, "type");             // string | undefined

// Integer query param
const page = queryInt(req, "page", 1);            // number (never undefined)
const limit = queryInt(req, "limit");             // number | undefined

// Route params (always string in Express)
const name = paramStr(req, "name");               // string
const id = paramInt(req, "id");                   // number | null
```

### Callback parameters on DB query results

Drizzle `select()` returns typed rows, but TypeScript sometimes loses the type
through `.map()` / `.filter()` chains. When this happens:

```ts
// Preferred: let TS infer the type (works for simple chains)
const names = rows.map(r => r.projectName);

// When inference fails: add explicit `: any` on the callback param
const names = rows.map((r: any) => r.projectName);
```

Do **not** use `as any` on the entire array. Type the callback parameter instead.

### Drizzle `inArray` overload issues

When passing an array to `inArray()` and TS infers `unknown[]`:

```ts
import { toNumberArray } from "../lib/drizzle-helpers";

// Instead of: inArray(users.id, ids)  // TS2769 if ids is unknown[]
// Use:        inArray(users.id, toNumberArray(ids))
```

### Transaction callbacks

Type the transaction parameter explicitly:

```ts
await db.transaction(async (tx: any) => {
  // use tx for queries
});
```

## Files with temporary @ts-nocheck

Files with `@ts-nocheck` have a header comment documenting:
- Total error count
- Error breakdown by type
- Fix instructions

To clean up a file:
1. Remove the `@ts-nocheck` line
2. Run `npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "filename"`
3. Fix errors using the patterns above
4. Verify `npx tsc -p tsconfig.check.json --noEmit` passes

## Adding new routes

New route files should be written without `@ts-nocheck` from the start.
Use the helper patterns above for query/param parsing and type all callback
parameters explicitly.
