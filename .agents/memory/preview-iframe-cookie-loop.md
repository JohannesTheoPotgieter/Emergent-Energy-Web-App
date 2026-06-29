---
name: Preview-iframe login loop (SameSite cookies)
description: Why dev login bounces back to login inside the Replit preview/canvas, and the SameSite=None;Secure fix scoped to dev only.
---

# Preview-iframe login loop

Browser auth is **session-cookie only** (the bearer-token path is intentionally
disabled — A3 XSS hardening; `getAuthToken()` returns null, no token in
localStorage). The Replit preview/canvas renders the app inside a **cross-site
iframe**, so a `SameSite=Lax` cookie is treated as third-party and dropped.
Symptom: `POST /api/auth/login` returns **200**, then every following request
(`/api/auth/me`, etc.) is **401** → bounce back to login → loop. The same flow
works fine in a normal top-level browser tab (first-party cookie), and prod in a
real tab is unaffected.

**Two cookies must agree**, or writes still fail after login: the session cookie
(`connect.sid`, `server/bootstrap/session.ts`) AND the CSRF double-submit cookie
(`csrf-token`, `server/middleware/csrf.ts`).

## Fix (in place)
In **development only**, both cookies default to `SameSite=None; Secure`.
Production stays `SameSite=Lax; Secure` (unchanged). An explicit
`COOKIE_SAMESITE` env override wins in either environment.

**Why:** preserves the cookie-only/no-localStorage-token security posture (does
NOT reintroduce the bearer token) while letting login survive the iframe. CSRF
double-submit protection stays enabled.

**How to apply / gotchas:**
- `SameSite=None` is only honoured by browsers when the cookie is also `Secure`,
  so `secure` is derived as `isProduction || sameSite === "none"`.
- Replit dev is HTTPS via the proxy with `trust proxy=1`, so `Secure` cookies
  work in dev. Over plain-HTTP localhost set `COOKIE_SAMESITE=lax` to opt out.
- express-session refuses to emit a `Secure` cookie over a non-HTTPS connection,
  so a plain `curl http://localhost:5000` login shows no `connect.sid`. Verify
  with `-H 'X-Forwarded-Proto: https'` to simulate the proxy.
- Even with this fix, browsers that block ALL third-party cookies won't send it
  in the iframe — the guaranteed fallback is opening the dev URL in its own tab.
- Startup logs the resolved policy: `[Session] Cookie policy resolved: sameSite=…, secure=…`.
