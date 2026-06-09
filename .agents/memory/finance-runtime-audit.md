---
name: Finance runtime audit harness
description: How to drive the Emergent Energy app + DB for runtime finance audits, what is/isn't testable, and the durable finance-data defects.
---

# Authenticating for runtime API audits (dev only)
The app gates every finance endpoint behind MSAL + JWT. For programmatic API testing in dev:
1. `GET /api/auth/dev-login` → 302 to `/auth/ms-callback?code=<64-hex>` (logs in the seeded COO_ADMIN account).
2. `POST /api/auth/exchange-code {code}` → `{token}` (JWT, ~60s code TTL).
3. Send `Authorization: Bearer <token>` to any endpoint.
**Why:** captures the exact payloads React-Query pages render. **Blocked when NODE_ENV=production.**

# Dev browser UI cannot authenticate through the supported flow (auth-contract defect)
The client was migrated to **cookie-only** auth: `getAuthToken()` returns null, `setAuthToken()` is a no-op,
requests use `credentials:"include"`. But the server only accepts a passport session (set solely by
`req.logIn` on the REAL MS callback) OR a Bearer header. `dev-login`/`exchange-code` **never call `req.logIn`**
(just `res.json({token})`), so the dev `connect.sid` cookie is unauthenticated → cookie-only requests get 401
everywhere; the page redirects to login. Proven: `/api/auth/me` cookie-only=401, Bearer=200.
**Workaround that DOES render the real browser UI:** inject `Authorization: Bearer <dev JWT>` on every request
via the browser context (Playwright `newContext({extraHTTPHeaders:{Authorization:'Bearer '+TOK}})`) — then full
authenticated UI renders and per-page button/UX testing is possible. (Supersedes the old "screenshot tool is
unauthenticated, browser UX not testable" note — it IS testable with header injection.)
**Why it matters:** prod MS login calls `req.logIn` so prod cookie auth works; this break is dev-login–specific
but makes the dev UI unreachable without the workaround.

# Playwright button-pass harness gotchas
Use `process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Pattern that survives hangs: fresh context per route +
~28s watchdog + capped `ctx.close()` (force-aborts) + resume-from-JSON. `browser.newContext()` itself is the one
un-capped step and can stall after many open/close cycles (a couple routes may not finish — accept partial).
Treat clicks on "Microsoft"/"Back to Dashboard" as logout/nav false-positives, and Vite HMR ws errors as benign.

# DB access (dev + prod read-only)
`psql "$DATABASE_URL"` = live dev DB (helium/heliumdb). **Prod, read-only:** `psql "$CLAUDE_RO_DATABASE_URL"`
(neondb) — finance tables exposed as views in schema **`claude_views`** (e.g. `claude_views.v_project_revenue_summary`).
`amount_ex_vat` is TEXT in both — guard casts: `case when btrim(x) ~ '^-?[0-9]+([.][0-9]+)?$' then x::numeric else 0 end`.
Active snapshot row = `effective_to IS NULL`.

# Durable finding: cross-surface finance numbers don't reconcile (and PROD is WORSE)
The PRS (`project_revenue_summary`) snapshot is mis-keyed (project_id != project_info.id), orphaned, and
duplicated. PRS-reading surfaces (admin kpi-traceability, GP pages, v2 project-finance `costedSummary`) disagree
with canonical normalized_* line totals by up to ~R200M; project-detail can show a different project's summary
(id=19 "Mondi" → costedSummary "Hungry Lion Citrusdal"). cashflow_points + finance_*_monthly are 0 rows in BOTH
dev and prod. **Dev is a stale subset of prod and defects scale up there:** prod has 91 projects vs 42, and
**~90% of prod PRS revenue (R416M, 50 orphan rows) is orphaned** vs dev's R121.8M/27 rows — freezing/promoting
does not escape the corruption.
**Why:** any "is finance correct?" task must compare the same number across pages (not just internal
consistency) AND check prod, since prod is the authoritative-but-more-corrupt dataset.
**Report:** consolidated into a single file `docs/finance-source-of-truth-audit.md` (V1+V2+button-pass+dev-vs-prod
recon merged; the former `-v2.md` was removed).
