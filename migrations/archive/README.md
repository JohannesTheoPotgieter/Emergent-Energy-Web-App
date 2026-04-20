# Archived migrations (pre-2026-04-19)

This directory contains the 225 migration files that existed before the
Phase 3b re-baseline. They are retained **for historical reference only**
and are **not** invoked by any npm script or CI step.

## Why these are here

From the start of the project through 2026-04-18, schema changes were
applied via a mix of:

- 2 Drizzle-Kit generated files (`0000_neat_juggernaut.sql`,
  `0001_useful_the_initiative.sql`).
- 221 hand-written timestamp-prefixed files (`20260309_*.sql` through
  `20260418_*.sql`), applied to prod by an ops process outside this
  repository.
- 2 miscellaneous (`add-execution-gate.sql`, `add-smart-import-tables.sql`).

The Drizzle journal (`migrations/meta/_journal.json`) tracked only the 2
Drizzle-Kit files. It was 9 months stale against reality. The prior stale
`meta/` directory is preserved here as `_stale_meta_20260419/`.

## What replaces them

A single **baseline migration** (`migrations/0000_baseline_20260419.sql`)
captures the full schema as of 2026-04-19, derived directly from
`shared/schema/*.ts`. It is marked reference-only — prod DBs already have
everything it creates.

All **future** schema changes use `npm run db:generate`, which writes a
new incremental migration next to the baseline. `npm run db:check` (run
in CI) fails any PR that edits `shared/schema/*.ts` without a
corresponding new migration file.

## When to read a file in this archive

- You need to trace when a specific column / table was added.
- You're investigating a production-only historical bug whose fix lives
  in a handwritten migration (search `grep -r column_name`).
- You're writing a new migration and want to reuse a DDL pattern from
  one of the historical files.

## Do NOT

- Copy one of these files back into `/migrations/` expecting it to run.
- Run any `psql -f migrations/archive/...` against prod — most of these
  are already applied.
- Treat this directory as authoritative for schema shape — that belongs
  to `shared/schema/*.ts` and the baseline migration.
