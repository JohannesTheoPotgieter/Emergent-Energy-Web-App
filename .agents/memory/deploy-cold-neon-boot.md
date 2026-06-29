---
name: Deploy cold-Neon boot crash
description: Why publishes intermittently failed at the autoscale promote/health-check and how the DB boot probe must behave
---

# Intermittent publish failures = cold-Neon boot crash, NOT a build error

Symptom: a publish fails ~1 in 4 attempts and clears on retry. In the build logs the
build phase fully succeeds (compile, `db:migrate`, schema verify/repair, image push,
security scan) and the status flips to `failed` ~2s after the last build line. That 2s
gap is the build record finalizing — the real failure is the **promote/startup health
check** (autoscale boots the new container and waits for `GET /` 200). The failed
promote container's crash log is **not** exposed by the deployment tooling
(`fetchDeploymentLogs` returns the live/healthy build's runtime logs, not the failed
container's). Don't keep chasing it — diagnose from the boot sequence.

**Root cause:** `bootstrap()` runs several fail-loud DB-touching gates *before*
`httpServer.listen()`. The prod DB is **Neon (scale-to-zero)**, so a fresh container's
**first** connection can refuse/time out while the compute wakes. The boot probe was a
single attempt → it threw → `bootstrap().catch → process.exit(1)` ran before the port
opened → the probe failed → promote rejected. Retry (Neon now warm) succeeds. That is
why it's flaky, not constant.

**Why retry/backoff is the right fix (and port-first is NOT):** making the `GET /`
probe pass before the schema gates run would let a genuinely-broken-schema deploy
**promote and go live serving 503s on finance**, instead of failing the publish and
leaving the known-good version serving. For this finance app's fail-loud governance
that's a *downgrade*. Bounded retry/backoff on the connection probe tolerates the
transient cold start while still **failing loud** when the DB is truly down (all
attempts exhausted → returns false → existing prod guard throws → exit 1 → publish
fails → old version keeps serving).

**Where:** `server/db.ts` `initializeDatabase()` → `testPostgresConnectionWithRetry()`.
Defaults 5 attempts (prod) / 1 (dev), 10s per-attempt timeout, 1s base backoff capped
4s; clamped + tunable via `DB_CONNECT_RETRY_ATTEMPTS`, `DB_CONNECT_TIMEOUT_MS`,
`DB_CONNECT_RETRY_BACKOFF_MS`.

**Known caveat / open follow-up:** worst-case pre-listen time (all retries against a
truly-down DB, ~50–61s + boot gates) could itself exceed the promote probe budget. Open
follow-ups worth doing: define a startup time budget aligned to the promote SLA, and add
per-gate startup timing instrumentation so future publish failures are attributable.
