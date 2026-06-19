---
name: Dev DB is PostgreSQL, not SQLite
description: The development environment actually runs on PostgreSQL (host helium), despite replit.md claiming SQLite for dev.
---

# Dev DB is PostgreSQL (host helium)

The running dev environment connects to **PostgreSQL** (`host=helium`, `db=heliumdb`),
confirmed by startup logs (`[DB] ✓ Using PostgreSQL (host: helium)`) and the test run
auto-detecting Replit PostgreSQL.

**Why this matters:** `replit.md` Stack section says "SQLite (development)". That is
misleading — assume Postgres in dev. This is why a SQL `~` regex backfill is fine engine-
wise but still avoided (see milestone-wbs-rule.md): the chosen pattern is DB-agnostic
derive-at-read, not engine-specific SQL.
