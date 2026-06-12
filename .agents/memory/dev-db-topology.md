---
name: dev DB topology vs database-skill executeSql
description: The database skill's executeSql targets a DIFFERENT Postgres than the running app; how to mutate the real dev DB.
---

# Two separate Postgres databases in this workspace

- The **running app** (dev + tests) connects to a Replit-managed Postgres at host
  `helium`, database `heliumdb`, via `process.env.DATABASE_URL` (auto-built from
  `PGHOST` in `server/db-config.ts`). This is where the **live dev data** lives
  (projects, finance cost lines, etc.).
- The **database skill's `executeSql`** (code_execution callback, target
  `replit_database`) connects to a **different**, app-unused built-in Postgres that
  happens to carry the **same app schema**. Mutations there do NOT affect the app.

**Why this matters:** A "clear/seed/migrate the dev DB" request run through
`executeSql` silently hits the wrong database — the app keeps showing old data.

**How to apply:** To read/mutate the data the app actually uses, connect via
`process.env.DATABASE_URL` from a Node script run through the **bash tool** (e.g.
`node script.mjs`), using `pg.Pool({ connectionString: process.env.DATABASE_URL })`.
Mirror `server/db-config.ts` (prefer `DATABASE_URL`, else build from `PG*`).
The **code_execution sandbox has no `process.env`** — its `executeSql` can't reach
`heliumdb`. Always print `current_database()`/host to confirm the target first; never
print the connection string.

**Prod safety:** Prod is a separate database (Neon `neondb`, read-only via
`CLAUDE_RO_DATABASE_URL`). In the dev workspace, `DATABASE_URL` = dev (`heliumdb`);
the deployment carries its own production `DATABASE_URL`.

**Test side effect:** the test suite seeds golden projects (Coega Steels Ph2,
De Drift, Mondi, Seshego Circle, Unitrans Brackenfell) plus `LinkTest Alpha/Ghost`
rows into `heliumdb`. Re-running tests re-populates the dev DB after a clear.
