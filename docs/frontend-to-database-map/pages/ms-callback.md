# Microsoft OAuth Callback (`/auth/ms-callback`)

**Source file:** `client/src/pages/ms-callback.tsx` (44 lines)
**Route:** `/auth/ms-callback` (registered in `client/src/App.tsx:413`, outside the `ProtectedRoute` gate)
**Permission entity:** none — public, unauthenticated endpoint
**Role landing:** n/a

## Purpose
Landing page the Microsoft identity platform redirects to after a successful
OAuth authorisation-code grant. Exchanges the short-lived `code` query param
for a JWT + user profile from the server, stores the token, and navigates to
the authenticated home.

## How the view is populated
No long-lived query state — this page does its work in a single
`useEffect` on mount:

- **Exchange authorization code for a session token** (`useEffect` in `ms-callback.tsx:9`):
  - Pulls `?code=` from `window.location.search`. If absent, redirects
    to `/auth/login?error=ms_auth_failed`.
  - `fetch("/api/auth/exchange-code", { method: "POST", body: { code } })`
  - Handler: `server/routes/auth-routes.ts:340`
    `app.post("/api/auth/exchange-code", ...)`
  - Looks up the code in an in-memory Map (`authCodes`) populated earlier in
    the Microsoft callback flow (`server/routes/auth-routes.ts` — the
    `GET /api/auth/microsoft/callback` handler immediately above on line 330).
    That earlier handler resolves the user against the `users` table and
    signs a JWT.
  - Reads tables: `users` (via the upstream `/api/auth/microsoft/callback`
    chain — see `login.md` and `server/microsoft-auth.ts`). The
    `exchange-code` handler itself only reads the in-memory cache.
  - Populates: `setAuthToken(data.token)` in `client/src/lib/api.ts`, then
    `localStorage.setItem("company_role", data.user.role)`, then a hard
    `window.location.href = "/"` redirect that bootstraps the authenticated
    SPA.

## Buttons / Actions
None. The page is purely transient: a spinner (`Loader2`) and the text
*"Completing sign in…"*.

## Forms / Inputs
None.

## Tabs / Sub-views / Filters / Sorts
None.

## Numbers / Counters / KPIs shown
None.

## Dialogs / Modals opened from this page
None.

## Navigation out of this page
- Success: `window.location.href = "/"` (full reload → authenticated home).
- Any error (missing code, exchange failure): `setLocation("/auth/login?error=ms_auth_failed")`.

## Database tables touched
- **Directly:** none — `exchange-code` is a pure in-memory cache lookup.
- **Transitively (via the earlier MS callback handler that populated the code):**
  - `users` (read / upsert) — resolved by
    `server/microsoft-auth.ts` when the OAuth code-for-token exchange succeeds.
