# Login (`/auth/login`)

**Source file:** `client/src/pages/login.tsx` (347 lines)
**Route:** `/auth/login` (`client/src/App.tsx:411`). The legacy path `/login`
redirects here (`App.tsx:412`). This route is **outside** `ProtectedRoute`
— no auth required.
**Permission entity:** none (public).
**Role landing:** n/a — this is the *entry* to the app.

## Purpose
Unauthenticated landing page. Handles two sign-in paths:
1. **Microsoft 365 SSO** (primary) via a redirect to `/api/auth/microsoft`.
2. **Username + password** (development/admin fallback; hidden behind a
   toggle unless `passwordLoginEnabled`).
Also surfaces the current build version and a click-through dialog with
release notes.

## How the view is populated
Four independent on-mount fetches + a query-string parser in a single
`useEffect` (`login.tsx:35`):

- **Version / build metadata**
  - Hook: bare `fetch("/api/version")` (no TanStack Query).
  - API: `GET /api/version`
  - Handler: `server/routes/support-extracted-routes.ts:164`
    `app.get("/api/version", ...)`
  - Reads: **filesystem only** — `version.json`, `release-notes.json`
    (in dev) or `dist/public/build-version.json`, `dist/public/release-notes.json`
    (in prod). **No DB tables.**
  - Populates: `versionInfo.version`, `versionInfo.buildTime`,
    `versionInfo.buildNumber`, `releaseNotes[]` → shown in the footer
    "v0.0.xxx · Build …" link and the release-notes dialog.

- **Microsoft SSO config**
  - Hook: bare `fetch("/api/auth/microsoft/config")`.
  - API: `GET /api/auth/microsoft/config`
  - Handler: `server/routes/auth-routes.ts:252`
  - Reads: **no DB tables** — returns
    `{ enabled: msAuth.isMicrosoftAuthConfigured() }`, which is a pure
    check of environment variables in `server/microsoft-auth.ts`.
  - Populates: `msEnabled` boolean. Drives whether the "Sign in with
    Microsoft 365" button + admin-toggle block render, or the plain
    username/password form renders.

- **Password-login availability**
  - Hook: bare `fetch("/api/auth/login-modes")`.
  - API: `GET /api/auth/login-modes`
  - Handler: `server/routes/auth-routes.ts:256`
  - Reads: **no DB tables** — returns
    `{ passwordLoginEnabled: process.env.NODE_ENV === "development" }`.
  - Populates: `passwordLoginEnabled`. When false, the "Sign in with
    username & password" toggle is hidden.

- **Error query-string decoding (in-page, no network)**
  - Reads `?error=…&email=…` and maps to a friendly copy via
    `MS_ERROR_MESSAGES` (`login.tsx:11`). This is how the MS callback flow
    surfaces failures like `ms_auth_failed`, `ms_no_account`,
    `ms_no_email` back to the user.
  - Populates: red `error` banner at the top of the card.

## Buttons / Actions (exhaustive)

- **"Sign in with Microsoft 365"** (`data-testid="button-ms-login"`,
  `login.tsx:136`)
  - Handler: `handleMicrosoftLogin` — full-page redirect
    `window.location.href = "/api/auth/microsoft"`.
  - API: `GET /api/auth/microsoft`
  - Server handler: `server/routes/auth-routes.ts:261`. Calls
    `msAuth.getAuthorizationUrl()` (`server/microsoft-auth.ts`) and issues
    an HTTP redirect to Microsoft identity platform.
  - Downstream flow (DB touch point):
    1. Microsoft redirects to `GET /api/auth/microsoft/callback`
       (`server/routes/auth-routes.ts:274`).
    2. That handler calls `msAuth.handleCallback(code)` to fetch the
       Graph profile.
    3. Matches the profile to a row in the `users` table by
       `microsoft_id` → `email` → `username` prefix (lines 292–301). On
       first successful match by email/username, it **UPDATEs** `users`
       to set `microsoft_id`.
    4. Mints a JWT, stores it in the in-memory `authCodes` map, and
       redirects the browser to `/auth/ms-callback?code=…`.
    5. The client-side `MsCallbackPage` then calls
       `POST /api/auth/exchange-code` to swap the code for the token
       (see `ms-callback.md`).
  - **Writes table:** `users` (UPDATE on first-time `microsoft_id` link).
  - **Reads table:** `users` (SELECT by `microsoft_id`, `email`,
    `username`).
  - Side effect: full browser redirect chain → eventually lands on `/`
    with JWT persisted in `localStorage`.

- **"Sign in with username & password"** toggle
  (`data-testid="button-toggle-admin"`, `login.tsx:166`)
  - `onClick={() => setShowAdminLogin(true)}` — purely UI.
  - No API, no DB.

- **"Back to Microsoft sign-in"** toggle
  (`data-testid="button-hide-admin"`, `login.tsx:233`)
  - `onClick={() => setShowAdminLogin(false)}` — purely UI.

- **"Admin Sign In" / "Sign In"** form submit
  (`data-testid="button-login"`, `login.tsx:225` & `282`)
  - `onSubmit={handleSubmit}` → `login.tsx:77`.
  - Calls `login(username.toLowerCase(), password)` from
    `useAuth()` (`client/src/hooks/use-auth.tsx:77`), which calls
    `authApi.login(username, password)` in `client/src/lib/auth-api.ts`.
  - API: `POST /api/auth/login` with body `{ username, password }`.
  - Handler: `server/routes/auth-routes.ts:103`
    - In production this short-circuits with
      `PASSWORD_LOGIN_DISABLED` (403).
    - In development it runs Passport's `"local"` strategy
      (`server/bootstrap/passport.ts` — uses `users.username` +
      bcrypt `users.password_hash`).
    - On success: `enforceSessionLimit()` → `getTokenVersionForUser()` →
      `generateToken(...)` → `res.json({ token, user })`.
  - **Reads tables:** `users` (via Passport local strategy).
  - **Side effects:** helper tables possibly touched by session limiting
    (`sessions`-style state held in Passport session store + JWT token
    version stored in `users` or a dedicated table — see `server/jwt.ts`).
  - On success: `setUser`, `setAuthToken`, `localStorage.setItem("company_role", …)`,
    toast "Welcome back!", then `setLocation("/")`.
  - On failure: toast "Login Failed" + sets inline error banner.

- **Version info button** (`data-testid="button-version-info"`,
  `login.tsx:296`)
  - `onClick={() => setShowVersion(true)}` — opens the release-notes
    `Dialog`. No API call (data was already fetched on mount).

- **Release-notes `Dialog` open/close**
  - `onOpenChange={setShowVersion}` — pure UI state.

## Forms / Inputs

| Field | Input id | Type | Validation | Target |
|-------|----------|------|------------|--------|
| Username | `#username` | text | Non-empty (disables submit until both filled) | `handleSubmit` → `login(username.toLowerCase(), password)` |
| Password | `#password` | password | Non-empty | same |

Form renders twice in the source: once for the admin-only variant
(`login.tsx:189–241`) and once for the `msEnabled=false` fallback
(`login.tsx:246–290`). Both submit to the same handler.

## Tabs / Sub-views / Filters / Sorts
No tabs. One piece of UI state is `showAdminLogin` (toggles the
admin username/password block) and `showVersion` (dialog open/closed).

## Numbers / Counters / KPIs shown
- `vX.Y.Z · Build YYMMDD` in the footer — sourced from `versionInfo`
  (populated by `GET /api/version`, filesystem only, no DB).

## Dialogs / Modals opened from this page
- **Release-notes dialog** (inline in `login.tsx:307`). No nested
  queries or mutations — it renders the `releaseNotes` array that was
  already loaded on mount.

## Navigation out of this page
- `setLocation("/")` on successful password login → authenticated home.
- `window.location.href = "/api/auth/microsoft"` on MS button (server
  redirect → Microsoft → `/auth/ms-callback` → `/`).
- `setLocation("/auth/login?error=…")` from `MsCallbackPage` on failure
  (same URL, rendered with error banner).

## Database tables touched
- **`users`** — SELECT in Passport local strategy
  (`POST /api/auth/login`) and in `GET /api/auth/microsoft/callback`
  (by `microsoft_id`, `email`, `username`). UPDATE on first-time
  `microsoft_id` link (`auth-routes.ts:300`).
- All other calls on this page (`/api/version`, `/api/auth/microsoft/config`,
  `/api/auth/login-modes`) touch **no database** — they read filesystem
  or environment variables.
