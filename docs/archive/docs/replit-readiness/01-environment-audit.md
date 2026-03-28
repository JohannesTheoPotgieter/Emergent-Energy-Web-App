# Replit Compatibility Audit — Environment & Config

**Date:** 2026-03-21
**Status:** Report only — no changes made

---

## 1. `.replit` File

**Status: PRESENT**

The `.replit` file exists and is well-configured:
- `run = "npm run dev"`
- Modules: `nodejs-20`, `web`, `python-3.11`, `postgresql-16`
- Deployment target: `autoscale`
- Build command: `["npm", "run", "build"]`
- Start command: `["npm", "run", "start"]`
- Public dir: `dist/public`
- PORT env set to `5000`
- Workflow configured for parallel project start

**Issues found:**
- `SESSION_SECRET` is hardcoded in `.replit` `[env]` section as `"replit-dev-session-secret-change-in-production"`. This is acceptable for dev but must be changed for production deployments.
- Sensitive values (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`) are exposed in `[userenv.shared]` section — these should use Replit Secrets instead.

---

## 2. `replit.nix` File

**Status: MISSING**

No `replit.nix` file found. The `.replit` file uses `modules` instead (`nodejs-20`, `postgresql-16`), which is the newer Replit module system and is acceptable. No action required unless specific Nix packages are needed.

---

## 3. `package.json` Scripts

| Script | Present | Command |
|--------|---------|---------|
| `dev` | YES | `node script/with-node-env.cjs development tsx server/index.ts` |
| `build` | YES | `tsx script/build.ts` |
| `start` | YES | `node script/with-node-env.cjs production node dist/index.cjs` |
| `db:push` | YES | `drizzle-kit push` |
| `check` | YES | `tsc -p tsconfig.check.json` |
| `test` | YES | `vitest run -c qa/vitest.config.ts` |

**Status: ALL REQUIRED SCRIPTS PRESENT**

---

## 4. Hardcoded Ports

| File | Line | Code | Severity |
|------|------|------|----------|
| `server/index.ts` | 138 | `parseInt(process.env.PORT \|\| "5000", 10)` | OK — uses env var with fallback |
| `server/microsoft-auth.ts` | 28 | `` `localhost:${process.env.PORT \|\| 5000}` `` | WARN — fallback port hardcoded |
| `server/config/environment.ts` | 10 | `PORT: z.coerce.number().default(3000)` | LOW — file is not imported anywhere (dead code), but default conflicts with actual port (5000) |
| `server/smart-import-routes.ts` | 2861 | `` fetch(`http://localhost:${process.env.PORT \|\| 5000}/...`) `` | FLAG — self-referencing via localhost (see Section 5) |
| `server/routes.ts` | 9097 | `` fetch(`http://localhost:${process.env.PORT \|\| 5000}/api/projects-summary`) `` | FLAG — self-referencing via localhost (see Section 5) |
| `package.json` | — | `"dev:client": "vite dev --port 5000"` | OK — dev only, overridden by `.replit` workflow |

**Primary port binding** (`server/index.ts:154`) correctly uses `0.0.0.0`:
```ts
httpServer.listen(port, "0.0.0.0", () => { ... });
```

**Verdict:** Port handling is mostly correct. The primary server reads `process.env.PORT` with a sensible fallback.

---

## 5. Hardcoded `localhost` / `127.0.0.1`

| File | Line | Code | Risk |
|------|------|------|------|
| `server/microsoft-auth.ts` | 28-29 | Domain detection uses `localhost` with protocol switching | MEDIUM — works correctly (detects localhost for dev vs production) |
| `server/smart-import-routes.ts` | 2861 | `fetch(\`http://localhost:${PORT}/api/smart-import/...\`)` | HIGH — Internal self-call via localhost. Will work on Replit (localhost resolves to self) but is fragile. Should use relative URL or `http://0.0.0.0:${PORT}` |
| `server/routes.ts` | 9097 | `fetch(\`http://localhost:${PORT}/api/projects-summary\`)` | HIGH — Same issue as above |
| `.env.test.example` | 4 | `API_URL=http://127.0.0.1:5000` | LOW — test config only |

**Verdict:** Two internal self-calls via `localhost` are fragile but functional on Replit. The server correctly listens on `0.0.0.0`. No client-side localhost references found.

---

## 6. Environment Variables

### Complete inventory of `process.env.*` references:

#### Core Runtime
| Variable | Files | In .env.example? | Default | Required for Startup? |
|----------|-------|-------------------|---------|----------------------|
| `NODE_ENV` | 12+ files | No | `"development"` (implicit) | No — defaults gracefully |
| `PORT` | `index.ts`, `microsoft-auth.ts` | Yes (test) | `5000` | No — has default |
| `SESSION_SECRET` | `env-guard.ts` | Yes (test) | Set in `.replit` [env] | YES — enforced at startup |
| `DATABASE_URL` | `db-config.ts`, `drizzle.config.ts`, `backfillInvoiceConfirmed.ts` | No | Auto-detected from PGHOST | YES for PostgreSQL mode |

#### Database (Replit PostgreSQL auto-detection)
| Variable | Files | Default | Notes |
|----------|-------|---------|-------|
| `PGHOST` | `db-config.ts` | — | Auto-detected by Replit PostgreSQL module |
| `PGPORT` | `db-config.ts` | `5432` | Auto-detected |
| `PGUSER` | `db-config.ts` | `runner` | Auto-detected |
| `PGPASSWORD` | `db-config.ts` | `""` | Auto-detected |
| `PGDATABASE` | `db-config.ts` | `postgres` | Auto-detected |
| `DB_MODE` | `db-config.ts` | Auto (`postgres`/`sqlite`) | Optional override |

#### Startup Mode Flags
| Variable | Default | Notes |
|----------|---------|-------|
| `ENABLE_STARTUP_MAINTENANCE` | `false` | Master switch |
| `ENABLE_STARTUP_SCHEMA_REPAIR` | `false` | Set to `"true"` in `.replit` [env] |
| `ENABLE_STARTUP_DATA_SEED` | `false` | Optional |
| `ENABLE_STARTUP_BACKFILL` | `false` | Optional |
| `ENABLE_STARTUP_SESSION_RESET` | `false` | Optional |
| `ENABLE_STARTUP_USER_SEED` | `false` | Optional |
| `LOCAL_DEV_MODE` | `false` | Optional |
| `ADMIN_MIGRATION_MODE` | `false` | Optional |
| `STARTUP_ENABLE_PERIODIC_SYNC` | `true` (via `!== "false"`) | Optional |

#### Azure / Microsoft Integration
| Variable | Files | Required? |
|----------|-------|-----------|
| `AZURE_TENANT_ID` | `microsoft-auth.ts`, `ms-account-service.ts` | YES for MS auth |
| `AZURE_CLIENT_ID` | `microsoft-auth.ts` | YES for MS auth |
| `AZURE_CLIENT_SECRET` | `microsoft-auth.ts`, `secrets/vault.ts` | YES for MS auth (loaded from vault) |

#### Replit-Specific
| Variable | Files | Notes |
|----------|-------|-------|
| `REPLIT_DOMAINS` | `security-middleware.ts` | Auto-set by Replit |
| `REPLIT_DEV_DOMAIN` | `security-middleware.ts` | Auto-set by Replit |
| `REPL_ID` | `security-middleware.ts` | Auto-set by Replit |
| `REPLIT_CONNECTORS_HOSTNAME` | `sharepoint.ts`, `sharepoint-list.ts`, `outlook.ts` | For Replit connectors |
| `REPL_IDENTITY` | `sharepoint.ts`, `outlook.ts` | Auto-set by Replit |
| `WEB_REPL_RENEWAL` | `sharepoint.ts`, `outlook.ts` | Auto-set by Replit |

#### Application-Specific
| Variable | Files | Required? |
|----------|-------|-----------|
| `QM_ACCESS_CODE` | `quality-routes.ts` | Optional (quality manager access) |
| `EPM_ACCESS_CODE` | `quality-routes.ts` | Optional (EPM access) |
| `AUTH_DEBUG` | `auth-context.ts` | Optional (debug flag) |
| `TR_DEFAULT_YEAR` | `tr-register-routes.ts` | Optional (defaults to 2026) |
| `ENABLE_RUNTIME_MAINTENANCE` | `runtime-mutation-policy.ts` | Optional |
| `ENABLE_STARTUP_MIGRATIONS` | `runtime-mutation-policy.ts`, `maintenance-guard.ts` | Optional |

**Missing:** No `.env.example` file exists at root level (only `.env.test.example` for QA).

---

## 7. Database Connection

**Status: WELL CONFIGURED FOR REPLIT**

- `server/db-config.ts` has **Replit-native PostgreSQL auto-detection** (lines 34-45)
- Automatically constructs `DATABASE_URL` from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- Falls back to SQLite in development if no PostgreSQL config found
- Refuses SQLite in production/staging (throws error)
- Drizzle ORM with PostgreSQL dialect configured in `drizzle.config.ts`
- Session store uses `connect-pg-simple` with PostgreSQL pool

**Verdict:** Database connection is fully Replit-compatible.

---

## 8. File System Dependencies

| File | Usage | Risk |
|------|-------|------|
| `server/invoice-capture-routes.ts` | Upload dir creation, file read/write/delete at `uploads/` | HIGH — Ephemeral on Replit |
| `server/ee-info-routes.ts` | Asset storage at `uploads/ee-info-assets/`, zip file operations | HIGH — Ephemeral on Replit |
| `server/quality-routes.ts` | QM approval uploads at `uploads/qm-approvals/` | HIGH — Ephemeral on Replit |
| `server/backfillInvoiceConfirmed.ts` | Reads Excel files from `uploads/` | MEDIUM — Migration script |
| `server/seed-data-migration.ts` | Reads/writes seed data files, done flag | LOW — One-time migration |
| `server/vite.ts` | Template file reading (Vite dev mode) | OK — Dev only |
| `server/static.ts` | Serves `dist/public` static files | OK — Built assets, expected |

**Verdict:** The `uploads/` directory is used for persistent file storage (invoices, assets, QM approvals). On Replit, this is **ephemeral** — files will be lost on reboot. For production, consider migrating to Object Storage (Replit) or external storage (S3, Azure Blob).

---

## 9. External Service Dependencies

| Service | Files | Optional? | App Starts Without It? |
|---------|-------|-----------|----------------------|
| **Azure AD (MSAL)** | `microsoft-auth.ts`, `ms-account-service.ts` | YES | YES — Auth falls back; MS features disabled |
| **Azure Key Vault** | `secrets/vault.ts` | YES | YES — Warns but continues with env vars |
| **Microsoft Graph** | `ms-sync-routes.ts`, `ms-sync-service.ts`, `outlook.ts` | YES | YES — SharePoint/Outlook sync just won't work |
| **SharePoint (Replit Connector)** | `sharepoint.ts`, `sharepoint-list.ts` | YES | YES — Connector availability checked at runtime |
| **Outlook (Replit Connector)** | `outlook.ts` | YES | YES — Connector availability checked at runtime |

**No Redis, SMTP, S3, or Google dependencies found.**

**Verdict:** All external services are optional. The app starts and runs core functionality without any of them.

---

## 10. Node.js Version

| Check | Value |
|-------|-------|
| `.node-version` file | MISSING |
| `.nvmrc` file | MISSING |
| Current `node --version` | v22.22.0 |
| `.replit` modules | `nodejs-20` |

**Potential Issue:** The Replit module specifies `nodejs-20` but the current runtime is Node v22.22.0. This may indicate the module was overridden or the runtime differs from the module specification. Verify that all dependencies are compatible with the actual Node version in use.

---

## Summary of Findings

### Critical Issues (0)
None — the app is fundamentally Replit-compatible.

### High Priority (3)
1. **Ephemeral file storage:** `uploads/` directory used for invoices, assets, and QM approval files. Data loss on Replit reboot.
2. **Self-referencing localhost fetch calls** in `server/smart-import-routes.ts:2861` and `server/routes.ts:9097` — fragile pattern.
3. **No `.env.example` at root** — new developers/Replit forks won't know required env vars.

### Medium Priority (2)
4. **Dead code:** `server/config/environment.ts` is never imported but has conflicting PORT default (3000 vs 5000).
5. **Azure credentials in `.replit` `[userenv.shared]`** — should use Replit Secrets for sensitive values.

### Low Priority (2)
6. **Node.js version mismatch:** Module says `nodejs-20`, runtime is v22.
7. **No `.node-version` / `.nvmrc` file** for version pinning.

### What's Working Well
- `.replit` file is comprehensive and correctly configured
- Server binds to `0.0.0.0` (not localhost)
- PORT is read from `process.env.PORT` with sensible default
- Database config has native Replit PostgreSQL auto-detection
- All external services (Azure, SharePoint, Outlook) are optional
- SQLite fallback available for dev without PostgreSQL
- All required npm scripts (`dev`, `build`, `start`, `db:push`) are present
- Deployment configuration is correct for Replit Autoscale
