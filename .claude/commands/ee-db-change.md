---
description: Plan and apply an additive schema change + root-level /migrations/ SQL file.
---

I need a schema change: $ARGUMENTS

Follow the Drizzle + migrations rules in `CLAUDE.md`.

## Step 1 — Read only these files

- The relevant domain file under `shared/schema/` (e.g. `finance.ts`,
  `projects.ts`, `users.ts`). Do NOT read `shared/schema.ts` — it's just a
  barrel re-export.
- `drizzle.config.ts` (for migration dir path confirmation)
- One or two recent migrations under `/migrations/` to match the existing
  timestamp + SQL style. Do NOT read `server/migrations/` — that directory
  holds one-off TS maintenance scripts, NOT the migration pipeline.

## Step 2 — Plan (do not write code yet)

Produce a plan covering:

1. Which `shared/schema/<domain>.ts` file changes and what table / column /
   type is added.
2. The corresponding SQL migration:
   - File path: `/migrations/<YYYYMMDD>_<short_snake_name>.sql`
   - **Additive only.** No `DROP COLUMN`, no destructive `RENAME`, no
     non-nullable columns without a default or backfill plan.
   - **Every statement uses `IF NOT EXISTS` / `IF EXISTS` guards.**
   - **No PostgreSQL-specific syntax** that would break the dev SQLite
     fallback unless the statement is already guarded to Postgres-only.
3. Which repositories / queries in `server/repositories/` need updating to
   use the new column.
4. Whether any snapshot-table invariants apply (`effectiveTo IS NULL` guard
   on reads).
5. Whether any tests in `qa/tests/` need updating.

**Wait for my approval before implementing.**

## Step 3 — Implement

After I approve:

- Edit the `shared/schema/<domain>.ts` file.
- Create the SQL file under `/migrations/`.
- Update any affected repositories.
- Run `npm run check` and fix errors at the source.

Do NOT run `npm run db:push` — I'll apply the migration manually after review.
