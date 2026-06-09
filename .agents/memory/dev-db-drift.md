---
name: Dev DB schema drift
description: How to recognise and safely reconcile a dev Postgres that is missing columns despite the migration ledger reporting all migrations applied.
---

# Dev DB schema drift (ledger says applied, columns absent)

In this repo the dev Postgres can report `N/N migrations applied` at startup yet be
**missing columns** that those migrations add. Observed twice: `change_requests`
workflow columns from migration 0071, and test-user passwords needing
`npm run seed:test-users`.

**Symptom:** an endpoint 500s; server log shows a Drizzle/`pg` error with
`code: '42703'` `column "<x>" does not exist`. The Drizzle schema mirror declares the
column but the table lacks it.

**Root-cause method:**
1. Read the real Postgres error — it carries `code` + `column`. (Beware routes that
   wrap errors and only log the wrapper; check `.cause`.)
2. List actual columns: `SELECT column_name FROM information_schema.columns WHERE
   table_name='<t>'` (use the `executeSql` sandbox callback).
3. Find the migration that adds them (`rg -n "<column>" migrations`).

**Safe reconciliation (dev only):** the migrations use `ADD COLUMN IF NOT EXISTS`, so
re-applying just the relevant statements via `executeSql` is idempotent and scoped.
`drizzle-kit migrate` will NOT help — it thinks the migration is already applied.

**Why:** lets QA/dev proceed without rewriting the ledger. Production risk is usually
low because the committed migration exists and is idempotent — but confirm prod has the
columns and recommend a proper ledger reconciliation rather than relying on the manual
re-apply.

**Boundary:** never touch production data this way; only reconcile the dev DB to match
already-committed migrations.
