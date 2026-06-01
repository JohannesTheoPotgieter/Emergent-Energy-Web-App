---
name: Deploy & DB ops (Emergent Energy)
description: Non-obvious facts about this app's deploy pipeline, database topology, and migration self-heal that aren't visible in code.
---

# Deploy & DB ops

## Dev and prod share ONE database
`DATABASE_URL` is a single global secret (not environment-scoped), so the dev server, the deploy's build-time `db:migrate`, and the prod serve container all hit the **same external `helium` Postgres**. Consequence: running the dev server (or any local migration) mutates the same data prod uses. `CLAUDE_RO_DATABASE_URL` is a SEPARATE read-only analytics DB ("claude" DB) — it does NOT contain the app tables (`sp_settings`, `folder_taxonomy`, etc. all return false there), so do not use it to verify prod app schema.
**How to apply:** to inspect the real app DB, query via `DATABASE_URL` (e.g. a Node `pg` script in bash — `process.env` is NOT exposed in the code_execution sandbox, but is in bash). Treat schema changes as production changes.

## drizzle-bootstrap watermark can be poisoned by an out-of-order `when`
Deploy build = `npm run build && npm run db:migrate`; `db:migrate` = `tsx scripts/drizzle-bootstrap.ts && drizzle-kit migrate`. drizzle's pg migrator only applies journal entries whose `when` > `MAX(created_at)` in `drizzle.__drizzle_migrations`. Migration `0079_dev_drift_repair` was given an inflated `when` (~1.782e12, far in the future) to force-run last. Once recorded, the watermark sits at that inflated value, so **any migration authored later with a normal timestamp (smaller `when`) is silently skipped forever**. Separately, drizzle-bootstrap marks any journal entry with NO probe in `MODERN_MIGRATION_PROBES` as "presumed applied" and inserts a bookkeeping row without running it — so a table that was never actually created (e.g. `folder_taxonomy` from 0044, `document_nodes`) stays missing while `db:migrate` reports "migrations applied successfully".
**Why:** this is how tables end up missing in the shared DB even though deploys report migrate success; it causes live 500s on the affected routes (e.g. `/api/folder-taxonomy` → `relation "folder_taxonomy" does not exist`).
**How to apply:** every new push-managed migration needs (a) a real probe in `MODERN_MIGRATION_PROBES`, and (b) awareness that a normal `when` below the 0079 watermark won't auto-apply — verify the table/column actually exists in the DB, don't trust the "applied successfully" line.

## Which deploy logs are retrievable
`getDeploymentBuild(buildId).logs` returns only **build-phase** logs (npm install, vite build, server bundle, db:migrate). For a failed autoscale build these end at "successfully uploaded cached layer" — the promote/serve (health-probe) phase logs are NOT in there and `fetchDeploymentLogs` has consistently returned "No deployment logs found" for this repl. So a promote-phase boot crash is invisible to the agent's tooling; the actual error is only in the Publishing pane UI. Reproduce locally instead: `PORT=<free> NODE_ENV=production node script/with-node-env.cjs production node dist/index.cjs` then curl `/` (probe is `GET /`). Boot only `process.exit(1)`s if an awaited step in `bootstrap()` throws; the `unhandledRejection`/`uncaughtException` handlers only log, they do not exit.
