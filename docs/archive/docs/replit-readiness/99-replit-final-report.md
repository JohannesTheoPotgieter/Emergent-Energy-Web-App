# Replit Compatibility — Final Report

**Date:** 2026-03-21
**Branch:** `claude/replit-compatibility-audit-MBavG`
**Status:** Ready for Replit deployment

---

## Configuration Files

### `.replit` (updated)
- Run command: `npm run dev` (development)
- Deployment: `autoscale` target, build via `npm run build`, start via `npm run start`
- Port: 5000 → external 80
- PATH includes `node_modules/.bin`
- Modules: `nodejs-20`, `web`, `python-3.11`, `postgresql-16`

### `replit.nix` (created)
- `nodejs-20_x`, `typescript`, `postgresql` system deps
- Supplements the module system for Nix-based tooling

### `vite.config.ts` (unchanged — already correct)
- `server.host: "0.0.0.0"`, `allowedHosts: true`
- Replit plugins conditionally loaded (`@replit/vite-plugin-runtime-error-modal`, cartographer, dev-banner)

### `server/vite.ts` (updated)
- HMR `clientPort: 443` when running on Replit (detected via `REPL_ID` / `REPLIT_DEV_DOMAIN`)
- Ensures hot-reload WebSocket connects through Replit's HTTPS proxy

---

## Environment Variables

### `.env.example` (created)
Documents all environment variables with REQUIRED vs OPTIONAL grouping:

| Category | Variables | Status |
|----------|-----------|--------|
| Core | `DATABASE_URL`, `SESSION_SECRET` | REQUIRED |
| Runtime | `PORT`, `NODE_ENV`, `DB_MODE` | Optional (defaults) |
| Startup flags | `ENABLE_STARTUP_*` (6 vars) | Optional (all default false) |
| Azure/MS | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Optional |
| App codes | `QM_ACCESS_CODE`, `EPM_ACCESS_CODE` | Optional |
| Debug | `AUTH_DEBUG`, `LOCAL_DEV_MODE`, `ADMIN_MIGRATION_MODE` | Optional |

### Replit-specific variables (auto-set by Replit)
- `REPL_ID`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`
- `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (PostgreSQL module)

---

## Port Binding

| Check | Result |
|-------|--------|
| Server listens on `0.0.0.0` | YES — `server/index.ts:154` |
| PORT from env with fallback | YES — `process.env.PORT \|\| "5000"` |
| Port retry on EADDRINUSE | YES — 3 retries with 2s delay |
| Vite dev host | `0.0.0.0` with `allowedHosts: true` |
| HMR clientPort for Replit | `443` (auto-detected) |

### Fixed: localhost self-fetch calls
- `server/smart-import-routes.ts:2861` — `localhost` → `0.0.0.0`
- `server/routes.ts:9097` — `localhost` → `0.0.0.0`

---

## Database Connection

| Check | Result |
|-------|--------|
| Uses `DATABASE_URL` from env | YES |
| Replit PG auto-detection | YES — constructs `DATABASE_URL` from `PGHOST`/`PGPORT`/etc. |
| SQLite fallback (dev only) | YES — refuses SQLite in production |
| Pool max connections | 10 (suitable for Replit) |
| Pool error handling | YES — Replit-specific non-fatal handler |
| Session store | `connect-pg-simple` (PostgreSQL) / `memorystore` (dev) |
| SSL | Not needed for Replit local PostgreSQL |
| Schema sync | `drizzle-kit push` on startup (dev), additive DDL (always) |

### `db:setup` script (created)
```
npm run db:setup
```
Runs `drizzle-kit push --force` then starts server with all seed/backfill flags enabled.

---

## Build Pipeline

| Step | Command | Output |
|------|---------|--------|
| Client build | `vite build` | `dist/public/` (index.html, assets/) |
| Server build | `esbuild` | `dist/index.cjs` (3.6MB, minified CJS) |
| Combined | `npm run build` | Both in `dist/` |

| Check | Result |
|-------|--------|
| Build succeeds | YES |
| Output directory | `dist/` (server) + `dist/public/` (client) |
| Static serving | `express.static(distPath)` with cache headers |
| SPA catch-all | `app.use("/{*path}")` → `sendFile("index.html")` |
| Production start | `node dist/index.cjs` (compiled, not tsx) |

---

## Smoke Test Results

### Build test
```
npm run build → SUCCESS
  Client: ✓ built in 15s (789KB JS bundle)
  Server: ✓ built in 1.1s (3.6MB CJS)
```

### Startup test (dev mode, SQLite fallback)
```
npm run dev → SUCCESS
  [DB] Using SQLite file: data/app.sqlite
  [DB] ✓ SQLite schema verified
  [Schema] Additive alignments skipped for SQLite
  [Startup:Routes] All route groups registered
  [Startup] serving on port 5000
```

### Production start (requires DATABASE_URL)
```
npm run start → Correctly requires DATABASE_URL
  [DB] Production requires PostgreSQL. Set a valid DATABASE_URL.
  (Expected behavior — Replit provides DATABASE_URL via PostgreSQL module)
```

---

## Session & Restart Resilience

| Check | Result |
|-------|--------|
| Session storage | PostgreSQL-backed (`connect-pg-simple`) in production |
| Session fallback | In-memory store in dev (acceptable) |
| Session secret | Enforced at startup; fails in production without it |
| Cookie config | `secure: true`, `httpOnly: true`, `sameSite: "none"` in production |
| Trust proxy | `app.set("trust proxy", 1)` — required for Replit's reverse proxy |
| Restart survival | Sessions persist in PostgreSQL across container restarts |

---

## Known Limitations

### 1. Ephemeral file storage (HIGH)
The `uploads/` directory is used for:
- Invoice documents (`server/invoice-capture-routes.ts`)
- EE info assets (`server/ee-info-routes.ts`)
- QM approval uploads (`server/quality-routes.ts`)

Files in `uploads/` will be lost on Replit container restart. For production persistence, migrate to Replit Object Storage or external storage (Azure Blob, S3).

### 2. Large client bundle (MEDIUM)
The main JS chunk is 790KB (211KB gzipped). Consider code-splitting with dynamic `import()` for better initial load times.

### 3. No WebSocket support needed (INFO)
No WebSocket/Socket.io usage found. All data fetching uses HTTP REST with `@tanstack/react-query` polling.

### 4. External services are optional (INFO)
Azure AD, SharePoint, and Outlook integrations are all optional. The app starts and runs core functionality without any external service credentials.

---

## Changes Made (4 commits)

1. **`bbbf5cc`** — Initial environment audit report (`docs/replit-readiness/01-environment-audit.md`)
2. **`2b9208f`** — Fixed `.replit` (port mapping, PATH, deployment commands), created `replit.nix`, configured Vite HMR `clientPort: 443`
3. **`9e28d31`** — Fixed 2 localhost self-fetch calls → `0.0.0.0` in `smart-import-routes.ts` and `routes.ts`
4. **`7048667`** — Created `.env.example` (all vars documented), added `db:setup` script to `package.json`

---

## Quick Start (Replit)

1. Fork this Repl
2. Ensure the PostgreSQL module is enabled (should be via `.replit` modules)
3. Add Secrets in the Replit Secrets tab:
   - `SESSION_SECRET` — any strong random string
   - `AZURE_TENANT_ID` — (optional, for Microsoft 365 integration)
   - `AZURE_CLIENT_ID` — (optional, for Microsoft 365 integration)
   - `AZURE_CLIENT_SECRET` — (optional, for Microsoft 365 integration)
4. Click **Run** — app auto-builds and starts
5. First time only: run `npm run db:setup` in the Shell to initialize the database schema and seed data

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (Vite + Express) |
| `npm run build` | Production build (client + server) |
| `npm run start` | Start production server |
| `npm run db:push` | Push schema changes to database |
| `npm run db:setup` | Full database init (schema + seeds + backfills) |
| `npm run check` | TypeScript type checking |
| `npm run test` | Run unit tests |
