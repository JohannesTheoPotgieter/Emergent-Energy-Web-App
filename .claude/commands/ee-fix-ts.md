---
description: Drive npm run check to zero errors by fixing root causes, not suppressing.
---

Run `npm run check` and drive it to zero errors.

For each TypeScript error:

1. **Identify the root cause.** Is it a missing type, a wrong import path, a
   schema mismatch, an outdated cast, a legacy file being re-typed?
2. **Fix at the source.** Acceptable fixes:
   - Add/correct a type annotation
   - Fix an import path (e.g. `server/middleware/requireRole.ts`, not
     `server/permission-middleware.ts`)
   - Use the Drizzle-inferred type from `shared/schema/<domain>.ts`
     (`typeof table.$inferSelect` etc.)
   - Update a call site to match an updated signature
3. **Unacceptable fixes:**
   - `as any`
   - `@ts-ignore` / `@ts-expect-error` without an explanation comment
   - Casting to `unknown` then to the desired type just to silence errors
   - Duplicating a type that already exists in `shared/schema/`
4. **Verify no regressions.** After each batch of fixes, re-run
   `npm run check`. Do NOT check in changes until it exits 0.

Report back:
- Number of errors at start
- Grouped summary of fixes applied (e.g. "5 × wrong requireRole import path,
  3 × missing schema type import")
- Any errors you chose NOT to fix and why (escalate to me for a decision)

Do not touch unrelated files.
