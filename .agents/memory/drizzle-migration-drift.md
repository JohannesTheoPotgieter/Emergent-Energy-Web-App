---
name: Drizzle migration drift on deploy
description: Why prod schema drifts despite the deploy running db:migrate, and the rule for adding new migrations
---

# Drizzle migration drift on deploy

The deploy build runs `npm run build && npm run db:migrate`, and
`db:migrate` = `tsx scripts/drizzle-bootstrap.ts && drizzle-kit migrate`.

`drizzle-kit migrate` only applies migrations whose journal row is absent from
`drizzle.__drizzle_migrations`. On this push-managed DB the bootstrap seeds that
table. A "modern" migration tag is **force-replayed only if it has a canary probe
registered in `MODERN_MIGRATION_PROBES`** and that probe returns false (artifact
missing → bootstrap deletes the journal row → migrate replays). Tags with **no
probe are "presumed applied" and silently skipped forever**, even when their DDL
never ran on prod. That is the drift mechanism behind the 0081/0084/0085 gap.

**Rule — for every new migration that adds schema artifacts:**
1. Register its exact journal tag in `MODERN_MIGRATION_PROBES`.
2. Make the probe **multi-artifact** (AND of table/column/constraint/index
   checks) so a *partial* apply also replays — a table-only canary returns true
   while a missing index/FK/column slips through.
3. Make the migration SQL **idempotent/additive** (`ADD COLUMN IF NOT EXISTS`,
   `CREATE TABLE IF NOT EXISTS`, FK in `DO $$ ... EXCEPTION WHEN duplicate_object`,
   `CREATE INDEX IF NOT EXISTS`) so the replay is safe.

**Why:** the column/table additions are the only signal that a migration ran;
without a probe drizzle-kit trusts the journal, and the journal can claim
"applied" when the DDL never executed.

**How to apply:** helpers available in `drizzle-bootstrap.ts` —
`tableExists`, `columnExists`, `constraintExists` (pg_constraint), `indexExists`
(pg_class relkind='i'; a `CREATE UNIQUE INDEX` is an index, NOT a constraint).
Validate by running `tsx scripts/drizzle-bootstrap.ts` against dev: a fully
up-to-date DB must report `deleted=0` (no needless replay).
