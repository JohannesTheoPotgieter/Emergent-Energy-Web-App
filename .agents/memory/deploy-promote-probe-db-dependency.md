---
name: Deploy promote probe must be DB-free
description: Why prod publishes flaked ~1 in 4 at the autoscale promote step, and the rule that GET / must not depend on the database.
---

# Autoscale promote probe must not touch the database

Replit autoscale's **promote** step (after the build phase succeeds) sends a
startup health probe to **`GET /`** and requires a `200` before cutting traffic
to the new build. If it gets a non-200, the publish is **aborted** and the
previous good build keeps serving. This is a *promote-step* failure, NOT a build
failure — the build logs will show full success through "Creating Autoscale
service" and migrations applied clean. Runtime logs for a failed-promote build
are generally **not retained** (traffic never cut over), so diagnose from the
build logs + this known mechanism, not from runtime logs.

**Why it flaked (~1 in 4 publishes):** in production the app mounted the
Postgres-backed session store (connect-pg-simple) + passport + jwtAuth + CSRF
**globally**, so `GET /` did a Postgres round-trip via the session store. On a
cold publish, Neon wakes from scale-to-zero **and** boot schedulers
(dashboard-refresh, canonical-dashboard-kpi, etc.) saturate the small pool
(max ~10) → the session lookup on `/` times out → `/` returns 500 → probe fails
→ publish aborts. `server/db.ts` documents this exact "~1 in 4, clears on retry"
behavior. Retrying usually succeeds (warm Neon, schedulers settled).

**The rule:** keep the probe path (`GET /`) **DB-independent**. In production,
serve the SPA shell (`dist/public/index.html`) for the bare root `/` *before*
the session/passport/jwt/CSRF chain in `server/index.ts`. The HTML shell never
needed a session; the SPA still authenticates via `/api/*`, and the CSRF cookie
is (re)issued on **every** response (`server/middleware/csrf.ts`), so it is
still bootstrapped from the SPA's immediate `/api/version` + `/api/auth/me`
calls — bypassing CSRF on `/` alone does not weaken CSRF.

**How to apply:** never reintroduce a global middleware that makes `GET /` hit
the DB. If you must add per-request DB work to the root path, gate it behind
`/api` scoping or a DB-free liveness path first. Deep-link first hits
(`/some-route`) still flow through the full chain — that's fine; only the exact
`/` probe path needs to be DB-free.
