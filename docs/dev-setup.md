# Developer Setup

Quick start for working on the Emergent Energy web app. Pair this doc with
`replit.md` for the full architecture overview and `setup-and-runbook.md` for
runtime/operational notes.

## Prerequisites

- Node.js 20 (matches CI; see `.github/workflows/ci.yml`).
- npm 10+ (ships with Node 20).
- PostgreSQL 16 for any work touching the database (the dev fallback uses
  `better-sqlite3`, but anything realistic needs Postgres).
- Optional: Microsoft 365 dev tenant for SharePoint/Outlook integrations
  (the mock connector is fine for most local work).

## First-time setup

```bash
npm ci --prefer-offline --no-audit
cp .env.example .env   # then fill in DATABASE_URL, JWT_SECRET, SESSION_SECRET, etc.
npm run db:push        # apply schema against $DATABASE_URL
npm run dev            # Express + Vite middleware on port 5000
```

## Turborepo Remote Cache (shared with CI)

PR #677 introduced Turborepo for `lint` / `check` / `build` / `test`. Remote
cache extends that local task cache by sharing artifacts between dev machines
and GitHub Actions:

- A green build on your laptop warms CI for the next push.
- A green CI run warms every other developer's next `turbo run`.
- Typical compound speedup is ~30% on top of the local cache PR #677 already
  delivers.

The backend is **Vercel Remote Cache** (free tier, hosted, zero infra). We
only use the cache — no Analytics, no other Vercel features.

### Get your Vercel token

1. Sign in at <https://vercel.com> with your work account.
2. Make sure you're a member of the Emergent Energy Vercel team
   (ask the COO/Eng admin to invite you if you aren't).
3. Open <https://vercel.com/account/tokens> → **Create Token**.
   - Scope: the Emergent Energy team.
   - Expiration: pick the longest acceptable for your laptop.
4. Copy the token once — Vercel will not show it again.

### Configure the env vars

Set both vars in your shell profile (or `~/.turbo/config.json` /
`~/.turborc`). Either works; the env-var approach is the most reliable
across shells, editors, and `npx` invocations.

```bash
# ~/.zshrc or ~/.bashrc
export TURBO_TOKEN="vercel_pat_xxx_your_token"
export TURBO_TEAM="emergent-energy"   # the team slug, NOT the display name
```

Reload your shell (`exec $SHELL -l`) and verify:

```bash
npx turbo run check --dry-run=json | head -20
# Look for: "remoteCache": { "enabled": true, ... }

npx turbo run check
# First successful line should read:
#   • Remote caching enabled
# (instead of "• Remote caching disabled")
```

If you see `Remote caching disabled`, the token or team slug is wrong — check
for typos and that the token hasn't expired.

### Don't commit the token

- `TURBO_TOKEN` is a personal credential. Never commit it, never paste it into
  a PR description, never store it in `.env` (which is repo-tracked via
  `.env.example`).
- `.gitignore` already ignores `.env*`, but if you choose `~/.turbo/config.json`,
  keep that outside the repo too.
- Rotate the token from <https://vercel.com/account/tokens> if you suspect
  exposure.

### CI configuration

CI passes `TURBO_TOKEN` and `TURBO_TEAM` from GitHub Secrets at the **job
level** in both `.github/workflows/ci.yml` and `pr-checks.yml`. Repo admins
need to add:

| Secret name   | Value                              |
| ------------- | ---------------------------------- |
| `TURBO_TOKEN` | A Vercel team token (CI-scoped)    |
| `TURBO_TEAM`  | The Vercel team slug (e.g. `emergent-energy`) |

Until those secrets exist the workflows still pass — the env vars resolve to
empty strings, Turbo silently disables remote cache, and the existing
`actions/cache@v4` step (`.turbo` + `.eslintcache`) handles caching as
before.

### Fallback layers

The cache strategy is layered so a remote-cache outage never blocks CI:

1. **Remote cache** (Vercel) — shared between dev + CI when secrets are set.
2. **GitHub Actions cache** (`actions/cache@v4` on `.turbo` + `.eslintcache`)
   — branch-scoped fallback inside CI.
3. **Local Turbo task cache** (`.turbo/`) — per-machine fallback for devs.

## Common commands

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Express + Vite on port 5000                           |
| `npm run check`      | Server + client TS check (cached by turbo)            |
| `npm run check:client` | Client-only TS check (fastest)                      |
| `npm run lint`       | ESLint flat config (cached by turbo)                  |
| `npm run test`       | Vitest unit tests (cached by turbo)                   |
| `npm run test:api`   | API tests via `script/run-with-app.ts` (uncacheable)  |
| `npm run db:push`    | Apply enums + schema to `$DATABASE_URL`               |

Targeted single-test runs are recommended during iteration —
`npm run qa:full-proof` is for release only.
