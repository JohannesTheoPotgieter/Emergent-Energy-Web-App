---
name: Migration drift & probes
description: Why Drizzle migrations get silently skipped here, and why non-idempotent CREATE TABLE migrations fail against push-created tables.
---

# Migration drift & canary probes

The custom `scripts/drizzle-bootstrap.ts` reconciles the Drizzle journal before
`drizzle-kit migrate` runs. It keeps a registry of per-migration **canary
probes** (e.g. "does table/column/constraint/index/enum-value X exist?"). For
any migration whose probe is **missing from the registry**, the bootstrap
**presumes it applied** and skips it.

**Rule:** every new migration file MUST get a matching canary probe added to the
registry in `scripts/drizzle-bootstrap.ts`. If you forget, the migration is
silently presumed-applied and its DDL never executes on dev OR prod — surfacing
later as runtime 500s / "column does not exist".
**Why:** this is exactly how 0087→0088 and the finance batch (0090–0096)
drifted; the registry had stopped before them.
**How to apply:** when adding migration NNNN, add an `enumValueExists` /
table / column / constraint / index probe keyed to a real object that migration
creates. Use `constraintExists` with the **non-truncated** conname (Postgres
truncates identifiers to 63 chars and emits a NOTICE, not an error).

## Non-idempotent CREATE TABLE vs. push-created shells

`drizzle-kit migrate` applies all pending migrations in **one transaction** — if
any statement errors, the whole batch rolls back and the journal does not
advance (so nothing applies, even migrations that would have succeeded). Always
capture the real exit code; do NOT pipe through `| tail` (it masks the exit).

A prior `drizzle-kit push` can leave **partial table shells** (table + pkey,
missing FKs/indexes). A later migration that does raw `CREATE TABLE` (no guard)
then errors `relation "X" already exists` (42P07) and rolls back the batch.
**Fix / convention (see migrations/0089):** make migrations additive +
idempotent — `CREATE TABLE IF NOT EXISTS`, FK constraints in duplicate-safe DO
blocks (`EXCEPTION WHEN duplicate_object OR invalid_table_definition OR
duplicate_table THEN null`), and `CREATE INDEX IF NOT EXISTS`.
**Why editing a committed migration's SQL is safe here:** the bootstrap
watermark uses `_journal.json` `when` (not file hash), and `db:check` compares
`shared/schema.ts` ↔ the `migrations/meta` snapshot (not the .sql text), so
DO-block/IF-NOT-EXISTS guards don't change the resulting schema → check stays
green. Diagnose blockers by running each pending migration in `BEGIN; \i file;
ROLLBACK;`.
