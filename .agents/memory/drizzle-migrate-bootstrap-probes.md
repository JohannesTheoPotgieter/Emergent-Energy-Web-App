---
name: Drizzle migrate bootstrap probes
description: Why every new migration must get a probe in scripts/drizzle-bootstrap.ts, or its DDL silently never runs on prod and the deploy build fails.
---

# New migrations MUST get a probe in scripts/drizzle-bootstrap.ts

**Rule:** Whenever a new Drizzle migration ships (`migrations/NNNN_*.sql` + a
`_journal.json` entry), add a matching entry to `MODERN_MIGRATION_PROBES` in
`scripts/drizzle-bootstrap.ts` with a cheap, SELECT-only, multi-artifact canary
that returns true iff the migration's DDL actually exists in the live DB.

**Why:** The deploy build runs `db:migrate` = `drizzle-bootstrap` →
`drizzle-kit migrate` → `db:verify-schema --repair`. `drizzle-kit migrate`
applies a journal entry only when its `when` > a single `MAX(created_at)`
watermark in `drizzle.__drizzle_migrations` (NOT per-migration). The bootstrap
backfills the ledger so the non-idempotent baseline isn't re-run. A migration
tag **with no probe is "presumed applied"** — the bootstrap inserts its ledger
row without running the DDL, so `drizzle-kit migrate` then sees nothing pending
and the tables/types are never created on prod. `db:verify-schema --repair` is
the last line of defense but its `planAdditiveRepair` only emits
`CREATE TABLE` / `ADD COLUMN` — it does **NOT** create enum `TYPE`s. So a
missing enum-typed table makes the repair's CREATE TABLE fail on the absent
type and the whole deploy build exits non-zero. (Observed: 0108 execution
review + 0109 milestone links shipped probe-less → prod missing
`execution_review_status` type → publish failed.)

**How to apply / fix a drift:**
- Don't add a probe to the *original* migration if its SQL is non-idempotent
  (plain `CREATE TYPE` / `ALTER TABLE ADD CONSTRAINT`) — forcing a replay would
  crash healthy DBs.
- Instead write a NEW drift-repair migration that re-asserts the missing
  objects **fully guarded**: `CREATE TYPE` inside
  `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS`, FKs in `duplicate_object` DO blocks,
  `CREATE [UNIQUE] INDEX IF NOT EXISTS`.
- Give the new migration the largest `when` in the journal, and add ITS probe
  (multi-artifact canary). On healthy DBs the canary passes → backfilled, no
  replay (no-op). On drifted DBs the canary fails → bootstrap drops the
  watermark below it → `drizzle-kit migrate` replays it idempotently.
- This mirrors the established precedent (0102 re-asserting 0071; 0088, 0089,
  0097). Drift-repair migrations carry NO `meta/*_snapshot.json` — snapshots
  are only needed by `drizzle-kit generate`, not by the migrator.
- The `.replit` `[deployment]` build/run COMMANDS are owner-locked, but adding
  a migration + a bootstrap probe is the sanctioned mechanism and needs no
  command change.
