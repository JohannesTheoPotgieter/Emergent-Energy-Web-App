---
name: Deploy "failed" — build vs promote phase
description: How to tell a build-phase failure from a promote/health-check failure on autoscale deploys, and what it means when there are no runtime logs.
---

# Distinguishing build-phase vs promote-phase deploy failures

An autoscale/cloud_run deploy goes **build → promote → serve**. A build whose
`status: "failed"` is NOT necessarily a build error.

**How to read it:** fetch the build log (`getDeploymentBuild`). If the log ends with
`[✓] migrations applied successfully!` followed by `Pushing/Created ... layer` lines
(image layers pushed) and THEN nothing, the **build phase succeeded**. The failure is
the **promote step** — the container started but the startup probe (`GET /`, needs HTTP
200) never passed.

**Why it matters:** A promote failure does NOT take prod down — `getDeploymentInfo`
will still show `hasSuccessfulBuild: true` and the previous build keeps serving.

## Diagnosing a promote failure with NO runtime logs
`fetchDeploymentLogs` returns "No deployment logs found" for a failed promote because
the container never went live (it only retains logs for the live deployment). So you
cannot see the prod startup crash directly. Triangulate instead:

1. **Reproduce the prod start locally:** `PORT=<free> npm run start` (this app's start
   wrapper `script/with-node-env.cjs` runs with `NODE_ENV=production`, which forces
   `JWT_SECRET`/`SESSION_SECRET` to `undefined` if they are not real secrets — in dev
   they get `local-dev-*` fallbacks). Let it run ~10s; curl `GET /` and `/healthz` for
   200. If it stays up and serves 200, the code is healthy.
2. **Confirm env parity:** `viewEnvVars` — secrets are global (not env-scoped) and this
   repl has no production-only env vars (prod/dev both only inherit `shared`). So a
   "missing prod secret" is rarely the cause here; verify before assuming it.
3. **Confirm migrations applied:** the build's `db:migrate` runs in the BUILD step, so a
   promote failure means migrations already committed to prod. Verify via RO prod
   (`CLAUDE_RO_DATABASE_URL`, pg_catalog only) by diffing constraint/index objects vs dev.

**Conclusion pattern:** build succeeded + migrations applied to prod + app serves 200
locally in production mode + dev/prod env parity + no runtime logs ⇒ the promote was a
transient/health-check blip. Re-publishing is safe (the migrate step is a clean no-op
because the bootstrap canary recognizes already-applied migrations).
