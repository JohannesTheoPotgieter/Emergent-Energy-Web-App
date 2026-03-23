# EMERGENT ENERGY — FULL REPOSITORY AUDIT REPORT

**Date:** 2026-03-23
**Auditor:** Claude (Senior Full-Stack Engineer & Solutions Architect)
**Codebase:** Emergent-Energy-Web-App
**Tech Stack:** React 19 (TypeScript) · Node.js/Express · Drizzle ORM · Neon PostgreSQL · Vite 7 · Wouter · TanStack React Query

---

## EXECUTIVE SUMMARY

### Overall Health Scores (out of 10)

| Area | Score | Rationale |
|------|-------|-----------|
| Database & Schema Design | 7/10 | 223 tables, strong temporal tracking, but inconsistent soft-delete patterns, wide `workItems` table with column duplication, and no explicit indexes on many high-query columns |
| Backend API | 7/10 | 830+ endpoints with consistent auth middleware and RBAC, but validation is handler-level (not centralized), `routes.ts` is 680KB monolith, and no rate limiting beyond auth endpoints |
| Frontend | 7/10 | 117 registered pages with role-based access, lazy loading, good React Query caching — but 240KB single component file (EngineeringTasksPage), no ESLint/Prettier, TypeScript `strict: false` |
| Security | 6/10 | Auth rate limiting, JWT + session dual auth, secrets vault, security headers — but no CSP header, no helmet, in-memory rate limiter (not distributed), no file content scanning |
| Performance | 6/10 | React Query with 30s staleTime, lazy loading — but no server-side caching (Redis), no job queue for imports, in-process Excel parsing, 680KB route file loaded at startup |
| Code Quality | 5/10 | 98 test files (good coverage intent) — but no ESLint, no Prettier, no CI/CD pipeline, `strict: false` in TypeScript, 178+ `any` type usages, no GitHub Actions |
| Microsoft Integration | 7/10 | MSAL auth, Graph API for SharePoint/Outlook/Teams, calendar sync, email sync — but no push notifications to Teams, no auto-created project document libraries, no SSO for all users |
| Smart Import | 8/10 | Full preview→commit flow, validation, issue resolution rules, template profiles, conflict handling, import history — strongest module in the codebase |
| Financials | 7/10 | Temporal tracking, revenue/COS/GP/cashflow, programme rollup — but no budget variance alerts, no multi-currency, no approval workflow on financial edits |
| Engineering & QA | 7/10 | Stage-gate templates, RACI, deliverable versioning, QC checklists with evidence — but no NCR register, no ISO compliance tracking, no formal inspection forms |

### Top 8 Critical Findings

1. **[BUG] MS tokens stored unencrypted** — Column named `refresh_token_encrypted` stores plaintext. SSO access tokens also plaintext in DB. File: `server/ms-account-service.ts`
2. **[BUG] SharePoint List auth broken** — Header typo `X_REPLIT_TOKEN` (underscores) instead of `X-Replit-Token` (hyphens) in `server/sharepoint-list.ts:24`. All SharePoint List operations fail silently.
3. **[BUG] Graph API scope mismatch** — Code sends Teams/channel messages but only requests `Chat.Read` scope. Needs `Chat.ReadWrite`. Returns 403.
4. **[DEBT] No CI/CD pipeline** — No GitHub Actions, no ESLint, no Prettier. Zero automated quality gates on merge.
5. **[DEBT] TypeScript `strict: false`** — 178+ explicit `any` usages. Type safety is advisory, not enforced.
6. **[DEBT] `server/routes.ts` is 680KB** — Monolithic route file excluded from TypeScript checking (`tsconfig.json` excludes it).
7. **[GAP] No distributed rate limiting or caching** — Rate limiter is in-memory Map (lost on restart, per-instance only).
8. **[GAP] No Content Security Policy (CSP)** — Security headers exist but CSP is missing.

---

## PHASE 1 — CODEBASE ORIENTATION

### 1.1 Top-Level Structure

```
Emergent-Energy-Web-App/
├── client/                  # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── components/      # 100+ reusable components (11 subdirectories)
│   │   ├── config/          # Page registry, navigation, role-aware UX
│   │   ├── hooks/           # 12 custom React hooks
│   │   ├── lib/             # 31 utility files
│   │   └── pages/           # 93 page components
│   └── index.html
├── server/                  # Express backend (TypeScript)
│   ├── api/v2/              # New RESTful API (controllers, services, repos, validators)
│   ├── bootstrap/           # 20+ startup scripts (orchestrator, seeds, backfills)
│   ├── departments/         # 8 department-specific route files
│   ├── lib/                 # 25 helper libraries
│   ├── repositories/        # 3 data access repositories
│   ├── routes/              # 12 route registration files
│   ├── secrets/             # Vault for secrets management
│   ├── services/            # 23 business logic services
│   ├── routes.ts            # [DEBT] 680KB monolithic route file
│   ├── storage.ts           # [DEBT] 110KB storage operations file
│   ├── db.ts                # 47KB database schema + operations
│   └── 80+ individual route files
├── shared/                  # Shared types, schemas, config
│   ├── schema/              # Drizzle ORM schema files (by domain)
│   └── *.ts                 # Shared utilities (permissions, flags, status logic)
├── migrations/              # 67 SQL migration files
├── qa/                      # Test suite (Vitest + Playwright)
│   ├── tests/               # 98 test files (87 unit, 10 API, 1 E2E)
│   └── reports/
├── docs/                    # 16 documentation directories
├── scripts/                 # 11 migration/utility scripts
├── seed/                    # Database seeding data
├── data/                    # Static data files
└── config/                  # Shared configuration
```

### 1.2 Major Modules/Domains Identified

| Module | Schema Tables | API Routes | Frontend Pages | Status |
|--------|--------------|------------|----------------|--------|
| Users & Auth | 7 | ~50 | 2 (login, roles) | [CONFIRMED] |
| Project Management | 18 | ~100 | 12+ | [CONFIRMED] |
| Work Items & Tasks | 24 | ~50 | 5+ | [CONFIRMED] |
| Engineering | 11 | ~120 | 6+ | [CONFIRMED] |
| Quality | 20 | ~80 | 1 (dashboard) | [CONFIRMED] |
| Finance | 60+ | ~90 | 8+ | [CONFIRMED] |
| Smart Import | 25 | ~70 | 2 | [CONFIRMED] |
| Collaboration | 23 | ~35 | 5+ | [CONFIRMED] |
| MyTool / Daily Planner | 14 | ~30 | 6+ | [CONFIRMED] |
| Project Development (PD) | 13 | ~40 | 5+ | [CONFIRMED] |
| Portfolios | 5 | ~15 | 2 | [CONFIRMED] |
| Reporting | 5 | ~35 | 8+ | [CONFIRMED] |
| Microsoft Integration | 3 | ~30 | 3 | [CONFIRMED] |
| Gamification | 2 | ~5 | 2 | [PLACEHOLDER] |
| Legacy | 2 | 0 | 0 | [DEBT] |

### 1.3 Frontend Routes (117 registered pages)

Key route groups via Wouter + Page Registry (`client/src/config/page-registry.ts`):

| Group | Routes | Examples |
|-------|--------|---------|
| Authentication | 2 | `/auth/login`, `/auth/ms-callback` |
| Home & Dashboard | 5 | `/`, `/execution-board`, `/execution-board/program` |
| Project Lifecycle | 5 | `/project-lifecycle`, `/lifecycle-board`, `/clients` |
| Project Management | 8 | `/projects`, `/project/:projectName`, `/portfolios` |
| Project Development | 6 | `/pd`, `/pd/tickets`, `/pd/tickets/:id` |
| Engineering | 6 | `/engineering`, `/engineering/tasks`, `/engineering/audit` |
| Quality | 1 | `/quality` |
| Finance | 8 | `/cashflow`, `/cos`, `/revenue-tracker`, `/gp-tracker` |
| My Work | 6 | `/my-work`, `/my-work/tasks`, `/my-work/calendar` |
| Reports | 8 | `/reports/pm/monthly`, `/reports/engineering/monthly` |
| Admin | 12 | `/admin/control-center`, `/admin/smart-import`, `/admin/roles` |
| Knowledge | 4 | `/ee-info`, `/leaderboard`, `/training` |
| Tasks & Standups | 2 | `/tasks`, `/standups` |
| Collaboration | 3 | `/collaboration`, `/teams/chats` |
| Priorities | 3 | `/priorities`, `/priorities/:id` |

### 1.4 API Endpoints (830+ total)

Organized via modular route registration (`server/routes/register-all-routes.ts`):

- **Auth middleware stack:** `jwtAuth → requireAuth → requirePermission(domain, action)`
- **API v2** (`server/api/v2/`): 75+ RESTful endpoints with controllers, services, repositories, validators, policies
- **Legacy v1** (`server/routes.ts` + 80 individual route files): 750+ endpoints

### 1.5 Database (223 tables via Drizzle ORM)

Schema files in `shared/schema/` organized by domain:
- `users.ts` — 7 tables (auth, roles, permissions)
- `projects.ts` — 18 tables (project info, execution state, settings, history)
- `tasks.ts` — 24 tables (work items, extensions, assignments, dependencies)
- `engineering.ts` — 11 tables (deliverables, stages, templates, approvals)
- `quality.ts` — 20 tables (checklists, evidence, commissioning, postmortem)
- `finance.ts` — 60+ tables (expenses, inflows, cashflow, counterparties, invoices)
- `imports.ts` — 25 tables (SharePoint, smart import, snapshots, mapping)
- `collaboration.ts` — 23 tables (notifications, meetings, approvals, knowledge base)
- `mytool.ts` — 14 tables (personal tasks, timeblocks, priorities)
- `legacy.ts` — 2 tables (upload metadata, refresh logs)

### 1.6 Third-Party Libraries (125+ production dependencies)

| Category | Libraries |
|----------|-----------|
| UI Framework | React 19, Radix UI (24 packages), Tailwind CSS, Framer Motion |
| Routing | Wouter 3.3.5 |
| Data Fetching | TanStack React Query |
| Forms | React Hook Form + @hookform/resolvers |
| Charts | Recharts |
| Backend | Express, Express-Session, Passport (local strategy) |
| ORM | Drizzle ORM + drizzle-zod |
| Auth | bcryptjs, jsonwebtoken, @azure/msal-node |
| Microsoft | @microsoft/microsoft-graph-client, @azure/identity, @azure/keyvault-secrets |
| File Handling | ExcelJS, Multer, JSZip |
| PDF | PDFKit, jsPDF, html2canvas |
| Validation | Zod |
| Logging | Winston |
| Build | Vite 7.1.9, esbuild, TypeScript 5.6.3 |
| AI | OpenAI SDK (v6.25.0) |

### 1.7 Environment Variables (30+ from `.env.example`)

| Variable | Purpose | Status |
|----------|---------|--------|
| `DATABASE_URL` | PostgreSQL connection | [CONFIRMED] |
| `SESSION_SECRET` | Session encryption | [CONFIRMED] |
| `AZURE_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | Microsoft auth | [CONFIRMED] |
| `PORT` | Server port (default 5000) | [CONFIRMED] |
| `NODE_ENV` | Environment mode | [CONFIRMED] |
| `ENABLE_STARTUP_*` | Boot-time schema repair, seeding, backfills | [CONFIRMED] |
| `QM_ACCESS_CODE` / `EPM_ACCESS_CODE` | Role access codes | [DEBT] Hardcoded role gating |
| `AUTH_DEBUG` / `LOCAL_DEV_MODE` | Debug flags | [CONFIRMED] |

### 1.8 Microsoft Integration Files

| File | Purpose | Status |
|------|---------|--------|
| `server/microsoft-auth.ts` | MSAL OAuth flow, token caching | [CONFIRMED] |
| `server/ms-account-service.ts` | Account management, token refresh | [CONFIRMED] |
| `server/ms-sync-service.ts` | Calendar/email/Teams sync | [CONFIRMED] |
| `server/outlook.ts` | Outlook calendar + email via Graph | [CONFIRMED] |
| `server/sharepoint.ts` | SharePoint file access via Graph | [CONFIRMED] |
| `server/sharepoint-list.ts` | SharePoint list CRUD | [CONFIRMED] |
| `client/src/pages/teams-chats.tsx` | Teams chat UI | [CONFIRMED] |
| `client/src/pages/collab-email.tsx` | Outlook email UI | [CONFIRMED] |

---

## PHASE 2 — DATABASE & DATA LAYER AUDIT

### 2.1 Schema Design Findings

| # | Table/Area | Finding | Tag | File |
|---|-----------|---------|-----|------|
| 1 | `workItems` | Wide table (60+ columns) duplicates columns that also exist in extension tables (`workItemPm`, `workItemEngineering`, `workItemScheduling`). Both the master and extension tables store `duration`, `percentComplete`, `isMilestone`, etc. This creates dual-source-of-truth risk. | [DEBT] | `shared/schema/tasks.ts` |
| 2 | Soft-delete pattern | Inconsistent across codebase: `deletedAt` (timestamp) in `workItems`, `mytoolTasks`; `deletedFlag` (integer 0/1) in `workingPlanDependencyOverride`; `isActive` (boolean) in 15+ tables; `isActive` (integer) in `workingPlanScenario`. No single pattern. | [DEBT] | `shared/schema/*.ts` |
| 3 | Indexes | **Zero indexes defined in Drizzle schema files.** All indexes are created only via raw SQL migrations. This means schema-driven tooling (introspection, type generation) is unaware of indexes. ~30 indexes exist in migrations but many high-query columns lack indexes. | [DEBT] | `shared/schema/*.ts`, `migrations/` |
| 4 | Missing indexes | `workItems.projectId`, `workItems.status`, `workItems.ownerUserId`, `workItems.workstream` — primary filter columns for the most-queried table — have no explicit indexes in schema or migrations. | [GAP] | `shared/schema/tasks.ts` |
| 5 | Missing indexes | `programExpense.projectName`, `programInflows.projectName`, `notifications.recipientUserId` — high-traffic lookup columns with no indexes. | [GAP] | `shared/schema/finance.ts`, `collaboration.ts` |
| 6 | FK enforcement | Foreign keys are consistently defined via Drizzle `.references()` with `onDelete: "cascade"` on child tables. Orphan risk is low for CASCADE relations. | [CONFIRMED] | `shared/schema/*.ts` |
| 7 | FK gap | `programExpense.projectName` and `programInflows.projectName` use string-based project name references alongside `projectId` FK. Dual-key lookup creates inconsistency risk if project names change. | [CONFLICT] | `shared/schema/finance.ts` |
| 8 | Temporal columns | 6 financial tables correctly implement temporal tracking (`effectiveFrom`, `effectiveTo`, `snapshotRunId`): `projectRevenueSummary`, `programExpense`, `programInflows`, `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`. | [CONFIRMED] | `shared/schema/finance.ts` |
| 9 | Temporal gap | No automated mechanism (trigger or scheduled job) to close `effectiveTo` on prior records when new records are inserted. This must be handled in application code, creating risk of overlapping temporal windows. | [GAP] | `shared/schema/finance.ts` |
| 10 | `projectInfo.projectName` | Used as a de facto business key across 20+ tables (expenses, inflows, plan, cashflow, etc.) alongside `projectId` FK. Renaming a project would break references in all these tables. | [DEBT] | `shared/schema/projects.ts` |
| 11 | Decimal precision | Financial columns use `decimal(15,2)` consistently for monetary values and `decimal(6,4)` for percentages/margins. Appropriate for ZAR currency. | [CONFIRMED] | `shared/schema/finance.ts` |
| 12 | JSON columns | Heavy use of JSONB for flexible data (`sopData`, `changesJson`, `configJson`, `summaryJson`, `scoringRuleJson`). These are not queryable without specialized JSON indexes. | [DEBT] | Multiple schema files |
| 13 | Audit tables | Comprehensive audit trail via `auditEvents`, `taskActivityLog`, `changesets`, `fieldChanges`, `projectPhaseHistory`, `projectRagAudit`, `workItemStatusHistory`. Good coverage. | [CONFIRMED] | `shared/schema/collaboration.ts`, `tasks.ts`, `projects.ts` |
| 14 | Multi-tenancy | `organizations` table exists with `slug` unique constraint, but `organizationId` FK is not present on most tables. Multi-tenancy is schema-ready but not enforced. | [PLACEHOLDER] | `shared/schema/users.ts` |

### 2.2 Missing Tables (Business Logic Implies)

| # | Expected Table | Reason | Tag |
|---|---------------|--------|-----|
| 1 | `budget_versions` | No budget versioning table. Budget changes overwrite in-place. Cannot compare budget v1 vs v2. | [GAP] |
| 2 | `currency_exchange_rates` | All financial values are single-currency. No multi-currency support for international projects. | [GAP] |
| 3 | `ncr_register` (Non-Conformance Reports) | QA module has checklists, evidence, and warnings but no formal NCR tracking table. | [GAP] |
| 4 | `inspection_forms` | Quality inspections are handled via generic QC items. No purpose-built inspection form schema. | [GAP] |
| 5 | `document_register` | No master document register linking all project documents. SharePoint integration exists but no local tracking table. | [GAP] |
| 6 | `email_notifications_log` | Notification table tracks in-app notifications but no record of emails actually sent. | [GAP] |
| 7 | `project_budget_baseline` | No formal budget baseline snapshot for variance analysis. | [GAP] |

### 2.3 Migration Files Review

- **67 migration files** in `/migrations/` directory
- Sequential naming convention: `YYYYMMDD_description.sql` — clean and consistent
- Rollback files exist for major changes (multischema, extensions, temporal columns)
- [CONFIRMED] Migrations are additive and non-destructive (ALTER ADD, CREATE IF NOT EXISTS)
- [DEBT] Some migration dates use day numbers beyond 31 (e.g., `20260332`, `20260345`) — these are synthetic sequence numbers, not real dates, which could confuse tooling

### 2.4 Smart Import Data Flow

| Step | Status | Detail |
|------|--------|--------|
| File upload → `smartImportRuns` | [CONFIRMED] | Records upload with status, file hash, record counts |
| Validation → `importIssues` | [CONFIRMED] | Issues logged with severity (INFO/WARNING/BLOCKER), section, fingerprint |
| Auto-resolution → `issueResolutionRules` | [CONFIRMED] | Rules auto-resolve known issue patterns |
| Preview before commit | [CONFIRMED] | Status flow: PREVIEW → AWAITING_REVIEW → COMMITTED |
| Write to financial tables | [CONFIRMED] | Writes to `programExpense`, `programInflows`, `projectPlan`, `cashflowPoints` |
| Rollback support | [CONFIRMED] | Status can be set to ROLLED_BACK |
| Cascade to KPIs | [GAP] | No automatic recalculation of derived KPIs after import commit |
| Import diff preview | [GAP] | No side-by-side comparison of old vs new data before commit |

### 2.5 Derived KPI Tables

| Table | Status | Issue |
|-------|--------|-------|
| `derived_project_kpis` | [CONFIRMED] | Exists in migrations but no trigger or scheduled job to refresh |
| `derived_rag_summary` | [CONFIRMED] | Same — computed on-demand, not kept in sync automatically |
| `dashboard_program_metrics` | [CONFIRMED] | Materialized metrics with manual refresh endpoint |
| `dashboard_project_metrics` | [CONFIRMED] | Same — requires explicit refresh call |
| Sync mechanism | [GAP] | No database triggers, no cron jobs, no event-driven refresh. All KPI refresh is manual API call. |

---

## PHASE 3 — BACKEND API AUDIT

### 3.1 Input Validation

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Zod validation exists but is inconsistent | [DEBT] | Only 12 out of 80+ route files use Zod schemas. V2 API (`server/api/v2/validators/`) has proper validators. V1 routes rely on ad-hoc `if (!req.body.field)` checks. |
| 2 | `server/routes.ts` — 680KB monolith | [DEBT] | Main route file has inline validation mixed with business logic. No separation of concerns. File is excluded from `tsconfig.json` type checking. |
| 3 | `server/storage.ts` — 110KB data layer | [DEBT] | Massive data access file. No structured validation before writes. Direct DB operations mixed with business logic. |
| 4 | V2 API has proper validation | [CONFIRMED] | `server/api/v2/validators/project-v2-validators.ts` uses Zod schemas. Controllers → Services → Repositories pattern properly separates concerns. |
| 5 | File upload validation | [CONFIRMED] | Multer config limits file size (50-100MB). MIME type validation present on upload routes. |
| 6 | No schema validation on PATCH routes | [GAP] | Most PATCH endpoints accept partial updates without validating allowed fields. Could accept unexpected or dangerous fields. |

### 3.2 Authentication & Authorization

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Dual auth: JWT + Session | [CONFIRMED] | `jwtAuth` middleware validates Bearer tokens; session-based auth via `express-session` + `connect-pg-simple`. Both paths converge on `requireAuth`. |
| 2 | RBAC via `requirePermission` | [CONFIRMED] | Permission middleware checks `(domain, action)` tuples against role. Defined in `shared/permission-resolver.ts`. |
| 3 | Admin enforcement | [CONFIRMED] | `requireAdmin` middleware gates admin routes to `COO_ADMIN` and `CEO_ADMIN` roles. |
| 4 | Session limit enforcement | [CONFIRMED] | Max 3 concurrent sessions per user. Enforced in auth routes. |
| 5 | Token revocation on logout | [CONFIRMED] | Tokens invalidated server-side on logout. |
| 6 | Dev login endpoint | [DEBT] | `GET /api/auth/dev-login` exists — convenience login that should be disabled in production. Guards exist (`LOCAL_DEV_MODE`) but risky if misconfigured. File: `server/routes/auth-routes.ts` |
| 7 | Role-based access codes | [DEBT] | `QM_ACCESS_CODE` / `EPM_ACCESS_CODE` env vars used as role-level passwords. Shared credentials are a security anti-pattern. File: `.env.example` |

### 3.3 Error Handling

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Global error handler exists | [CONFIRMED] | `server/bootstrap/error-handling.ts` catches unhandled errors. Returns structured JSON responses. |
| 2 | `ApiError` class | [CONFIRMED] | Custom error class in `server/lib/api-error.ts` with status code, user message, and retryable flag. |
| 3 | Inconsistent status codes | [DEBT] | Many V1 routes return `500` for all errors instead of appropriate `400`, `409`, `422` codes. V2 routes use proper codes. |
| 4 | Error logging via Winston | [CONFIRMED] | `server/lib/logger.ts` provides structured logging. Errors logged with correlation IDs. |

### 3.4 Query Patterns

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Transactions used | [CONFIRMED] | 26 transaction usages across 11 files. Used for multi-write operations (smart import commit, subcontractor updates, lifecycle transitions). |
| 2 | Transaction gaps | [GAP] | Several multi-write operations (e.g., creating a project + execution state + settings) do not use transactions. Partial failure could leave orphaned records. |
| 3 | Pagination | [CONFIRMED] | ~71 usages of `.limit()` / `.offset()` across 15 route files. Task management, notifications, and list endpoints are paginated. |
| 4 | Pagination gaps | [GAP] | Several list endpoints in `routes.ts` return all results without pagination (e.g., project lists, expense lists for a project). |
| 5 | N+1 risk | [DEBT] | V1 routes frequently fetch a list then loop through items to fetch related data. V2 uses consolidated queries with joins. |
| 6 | Over-fetching | [DEBT] | `storage.ts` frequently uses `select *` equivalent (no column selection). Returns all columns when frontend only needs a subset. |

### 3.5 Rate Limiting

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Auth rate limiting | [CONFIRMED] | In-memory rate limiter on `/api/auth/login`, `/api/auth/microsoft`, `/api/auth/microsoft/callback`. 20 requests per 15 minutes per IP. File: `server/bootstrap/security-middleware.ts` |
| 2 | No rate limiting on API endpoints | [GAP] | No rate limiting on any non-auth API endpoint. A malicious or misbehaving client can spam any endpoint. |
| 3 | In-memory limiter | [DEBT] | Rate limiter uses `Map` — resets on server restart, per-instance only (useless with horizontal scaling). |

---

## PHASE 4 — FRONTEND AUDIT

### 4.1 Component Architecture

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | `EngineeringTasksPage.tsx` — 4,758 lines (240KB) | [DEBT] | Single component file larger than many entire applications. Should be broken into 15-20 focused components. File: `client/src/pages/EngineeringTasksPage.tsx` |
| 2 | Lazy loading with React Suspense | [CONFIRMED] | All non-critical pages are lazy-loaded via `React.lazy()`. Only login, home, and 404 are eagerly loaded. File: `client/src/App.tsx` |
| 3 | Page Registry pattern | [CONFIRMED] | Centralized page registry (`client/src/config/page-registry.ts`) with 117 entries. Clean, declarative routing configuration. |
| 4 | Role-based navigation | [CONFIRMED] | `client/src/config/role-aware-ux.ts` maps roles to navigation sections. `PermissionGate` component gates UI elements. |
| 5 | Radix UI component library | [CONFIRMED] | 24 Radix UI packages provide accessible, unstyled primitives. Consistent pattern across UI components. |

### 4.X Frontend BUGS (from deep audit)

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | 401 redirect goes to wrong URL | [BUG] | `client/src/lib/queryClient.ts:183` redirects to `/login` but actual login route is `/auth/login`. Users hit the 404 page instead of login on session expiry. |
| 2 | Dashboard queries skip auth token | [BUG] | `client/src/pages/dashboard.tsx:450-475` uses raw `fetch()` without `Authorization: Bearer` header. Bypasses `apiRequest`/`getQueryFn`. Will 401 if server requires Bearer token. |
| 3 | 10+ queries silently swallow errors | [BUG] | `client/src/pages/project-detail.tsx` lines 95, 334, 1027+ all do `if (!res.ok) return []`. HTTP 403/500 errors display as empty data with no user feedback. |
| 4 | Five different fetch utility patterns | [CONFLICT] | `lib/api.ts`, `lib/queryClient.ts`, `lib/eng-fetch.ts`, `pages/qm-dashboard.tsx` (local `qFetch`), `pages/project-detail.tsx` (local `engFetch`) — each has different error handling, token injection, and correlation ID behavior. |
| 5 | Two `engFetch` with different return types | [CONFLICT] | `lib/eng-fetch.ts` returns parsed JSON. `pages/project-detail.tsx:124` local version returns raw `Response`. Same name, different semantics. |
| 6 | Hardcoded FY26 months | [PLACEHOLDER] | `client/src/pages/cashflow.tsx:138-151` has static `FY26_MONTHS` array (Sep 2025–Aug 2026). API path `/api/cashflow-2026` is also FY-specific. Breaks on FY rollover. |
| 7 | `smart-import.tsx` is 4,101 lines | [DEBT] | Second-largest component file. Multi-step wizard all in one file. |
| 8 | 15+ parallel queries on project-detail mount | [DEBT] | V2 consolidated queries exist BUT legacy V1 queries also fire alongside — data fetched twice through different endpoints. File: `client/src/pages/project-detail.tsx:1023-1170` |
| 9 | Feature flags fetch omits auth token | [DEBT] | `client/src/lib/feature-flags.ts` calls `fetch()` without Bearer token. |
| 10 | `User` role type union is incomplete | [DEBT] | `client/src/lib/api.ts:192` defines only 5 roles but app has 14+. False type safety. |

### 4.2 Data Fetching & Caching

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | TanStack React Query | [CONFIRMED] | Well-configured `QueryClient` with 30s staleTime, 5min gcTime, smart retry logic (no retry on 401/403/404). File: `client/src/lib/queryClient.ts` |
| 2 | Global error handling | [CONFIRMED] | `QueryCache.onError` and `MutationCache.onError` handle 401 (redirect to login), 403 (toast), 429 (toast), 500+ (toast). |
| 3 | Correlation IDs | [CONFIRMED] | Every query includes `X-Correlation-ID` header for request tracing. |
| 4 | JWT + session dual auth | [CONFIRMED] | `apiRequest()` attaches both JWT Bearer token (localStorage) and session cookie (`credentials: "include"`). |
| 5 | JWT in localStorage | [DEBT] | Auth token stored in `localStorage` — vulnerable to XSS. Should use httpOnly cookies. File: `client/src/lib/queryClient.ts:33` |
| 6 | Query invalidation helpers | [CONFIRMED] | `invalidateDashboardQueries()` and `invalidateProjectQueries()` ensure stale data is refreshed after mutations. |
| 7 | `refetchOnWindowFocus: false` | [UPGRADE] | Disabled globally. For a multi-user platform, consider enabling on critical dashboards to show fresh data when users tab back. |

### 4.3 Forms & Validation

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | React Hook Form + Zod | [CONFIRMED] | Form management library present in `package.json`. Used in V2 API-connected forms. |
| 2 | Inconsistent client-side validation | [DEBT] | Many forms use basic `required` attributes without Zod schema validation. Some forms have no client-side validation at all. |
| 3 | No form field length limits | [GAP] | Text inputs generally lack `maxLength` constraints. Users can submit arbitrarily long strings. |

### 4.4 Loading, Error & Empty States

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | `NetworkStatus` component | [CONFIRMED] | `client/src/components/NetworkStatus.tsx` shows online/offline status. |
| 2 | `ErrorBoundary` component | [CONFIRMED] | `client/src/components/ErrorBoundary.tsx` catches React rendering errors. |
| 3 | Loading state coverage | [DEBT] | Not all pages show loading spinners during data fetch. Some pages flash empty content before data loads. |
| 4 | Empty state handling | [DEBT] | Some list views show empty tables with no message. Should display "No items found" or contextual call-to-action. |

### 4.5 Performance

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | `useMemo` / `useCallback` usage | [CONFIRMED] | 48 usages across 10 page files. Present but not comprehensive. |
| 2 | Virtual scrolling available | [CONFIRMED] | `@tanstack/react-virtual` in dependencies for large list rendering. |
| 3 | Code splitting via Vite | [CONFIRMED] | Lazy loading creates per-page bundles. |
| 4 | Missing memoization on heavy pages | [DEBT] | Large pages like `EngineeringTasksPage`, `cashflow`, and `fye-revenue-tracking` have complex filter/sort logic without memoization. |

### 4.6 Dead Code & Hardcoded Values

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | `client/src/lib/mockData.ts` | [PLACEHOLDER] | Contains hardcoded mock projects ("Solar Farm Alpha", "Wind Park Beta") with fake data. Still importable. |
| 2 | Legacy redirect pages | [DEBT] | `/dashboard` redirects to `/execution-board`, `/pm-dashboard` redirects to `/execution-board`, `/revenue` redirects to `/revenue-tracker`. Old paths still in codebase. |
| 3 | `client/src/lib/types.ts` | [DEBT] | Contains types (`ProjectInfo`, `ExpenditureItem`) used only by mockData. Likely dead code. |
| 4 | Feature flags | [CONFIRMED] | `client/src/lib/feature-flags.ts` and `shared/feature-flags.ts` manage feature toggles. Properly gated. |

### 4.7 Accessibility

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Radix UI provides base a11y | [CONFIRMED] | Radix primitives include ARIA attributes, keyboard navigation, focus management by default. |
| 2 | No explicit a11y testing | [GAP] | No axe-core, jest-axe, or Playwright a11y assertions in test suite. |
| 3 | No skip-to-content link | [GAP] | Sidebar navigation has no skip link for keyboard users. |
| 4 | Contrast not verified | [GAP] | Theme system (light/dark/system) exists but no documented contrast ratio verification. |

---

## PHASE 5 — MODULE-BY-MODULE DEEP AUDIT

### 5.1 Smart Excel Import

**Files:** `server/smart-import-routes.ts`, `server/lib/import/`, `client/src/pages/smart-import.tsx`, `shared/schema/imports.ts`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Full preview→commit flow | [CONFIRMED] | Status lifecycle: PREVIEW → AWAITING_REVIEW → COMMITTED. User sees preview before data is written. |
| 2 | File hash tracking | [CONFIRMED] | `sourceFileHash` in `smartImportRuns` enables duplicate detection. |
| 3 | Validation with issue tracking | [CONFIRMED] | `importIssues` table logs every validation issue with severity (INFO/WARNING/BLOCKER), section, and fingerprint. |
| 4 | Auto-resolution rules | [CONFIRMED] | `issueResolutionRules` can auto-resolve known issue patterns on subsequent imports. |
| 5 | Template profiles & mapping rules | [CONFIRMED] | `templateProfiles` + `mappingRules` allow different Excel formats to map to canonical fields. |
| 6 | Import history | [CONFIRMED] | `smartImportRuns` tracks every import with record counts, status, and timestamps. |
| 7 | Rollback support | [CONFIRMED] | Import runs can be set to `ROLLED_BACK` status. |
| 8 | No import diff preview | [GAP] | Cannot see side-by-side comparison of current vs incoming data before commit. |
| 9 | No version history on imported rows | [GAP] | Once data is written to financial tables, the previous version is overwritten (temporal tracking via `effectiveFrom`/`effectiveTo` provides some history but not a user-facing diff). |
| 10 | No async processing | [GAP] | Excel parsing happens synchronously in the request handler. Large files (10MB+) could timeout. No job queue. |
| 11 | Cascade to KPIs not automatic | [GAP] | After import commit, derived KPI tables are not automatically refreshed. Requires separate API call. |

### 5.2 Project Financials

**Files:** `shared/schema/finance.ts`, `server/departments/finance-routes.ts`, `server/departments/financial-integration-routes.ts`, `client/src/pages/cashflow.tsx`, `client/src/pages/cos.tsx`, `client/src/pages/revenue-tracker.tsx`, `client/src/pages/gp-tracker.tsx`, `client/src/pages/fye-revenue-tracking.tsx`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Contract value tracking | [CONFIRMED] | `projectInfo.contractValue` (decimal 15,2). Variations tracked via `currentVoTotal` in `projectEditableFields`. |
| 2 | Revenue line tracking | [CONFIRMED] | `normalizedRevenueLines` tracks milestones with status (PLANNED/INVOICED/PAID/IN_BANK/REALISED). |
| 3 | COS tracking | [CONFIRMED] | `normalizedCostLines` tracks costs with PO, invoice, approval status. Pattern matching via `invoicePatternRules`. |
| 4 | GP calculation | [CONFIRMED] | Gross Profit = Revenue - COS. Tracked in `projectRevenueSummary` with planned vs actual margins. |
| 5 | Temporal snapshots | [CONFIRMED] | Financial tables use `effectiveFrom`/`effectiveTo` for point-in-time queries. |
| 6 | Cashflow management | [CONFIRMED] | `cashflowWeeklyManual` for opening balances, `cashflowBalanceHistory` for change tracking, planning overrides supported. |
| 7 | FYE revenue tracking | [CONFIRMED] | `fyeBudgets`, `forecastPipeline`, `lostDeals`, `fyeKpiCounters`, `fyeReportSnapshots` — comprehensive year-end module. |
| 8 | Programme-level rollup | [DEBT] | Rollup to programme/portfolio level is computed at query time, not materialized. Slow on large portfolios. |
| 9 | No budget variance alerts | [GAP] | No automated alerts when actuals exceed budget thresholds. |
| 10 | No multi-currency | [GAP] | All values assumed to be single currency (ZAR). No exchange rate tables or currency conversion. |
| 11 | No approval workflow on financial edits | [GAP] | `financialEditRequests` table exists but the approval flow is not wired end-to-end. |
| 12 | No forecast vs actuals comparison view | [GAP] | Forecast pipeline exists for FYE but no visual comparison dashboard of forecast vs actual per project. |
| 13 | Dual-key issue | [CONFLICT] | Finance tables reference both `projectName` (string) and `projectId` (FK). Risk of mismatch if project renamed. |

### 5.3 Engineering Task Management

**Files:** `server/engineering-routes.ts`, `server/task-management-routes.ts`, `shared/schema/tasks.ts`, `shared/schema/engineering.ts`, `client/src/pages/EngineeringTasksPage.tsx`, `client/src/pages/engineering-dashboard.tsx`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Work item lifecycle | [CONFIRMED] | Status lifecycle with 9 states. `workItemStatusHistory` tracks all transitions with reason and actor. |
| 2 | Assignment system | [CONFIRMED] | `workItemAssignments` supports OWNER, ASSIGNEE, REVIEWER, VIEWER roles with allocation percentage. |
| 3 | Dependency tracking | [CONFIRMED] | `workItemDependencies` supports FS/SS/FF/SF dependency types with lag days. |
| 4 | Stage-gate templates | [CONFIRMED] | `engStageTemplates` with RACI, failure modes, stage gate rules. Applied to projects via `projectEngStages`. |
| 5 | Deliverable versioning | [CONFIRMED] | `deliverableVersions` tracks version history with change reasons and impact. |
| 6 | Time tracking | [CONFIRMED] | `taskTimeEntries` records duration, description, and date per user per work item. |
| 7 | Task tags system | [CONFIRMED] | `taskTags` + `workItemTags` with categories (BUG, IMPROVEMENT, FEATURE, CUSTOM). |
| 8 | Watcher/notification system | [CONFIRMED] | `taskWatchers` tracks users watching tasks. `notifications` sent on status changes. |
| 9 | Activity log | [CONFIRMED] | `taskActivityLog` records field-level changes with old/new values. |
| 10 | Standup functionality | [CONFIRMED] | `server/standup-routes.ts` — dedicated standup schedules, participants, entries with mood tracking (great/good/okay/struggling/blocked). Cadence options: DAILY, EVERY_2_DAYS, EVERY_3_DAYS, WEEKLY. |
| 11 | No Gantt chart integration | [GAP] | Dependencies exist but no frontend Gantt visualization. Schedule is table-based only. |
| 12 | No workload view | [GAP] | No view showing resource allocation across projects (who is overloaded). |
| 13 | No blocked task escalation | [GAP] | Blocked tasks have `blockerReason` field but no automated escalation to managers. |
| 14 | No recurring task auto-creation | [GAP] | Recurrence fields exist (`isRecurring`, `recurrenceFrequency`) but no background job to auto-create instances. |
| 15 | No bulk actions on tasks | [GAP] | No batch status update, batch assign, or batch delete for work items. |
| 16 | 4,758-line page component | [DEBT] | `EngineeringTasksPage.tsx` is massive. Needs decomposition into focused sub-components. |

### 5.4 Quality Task Management (QA)

**Files:** `server/quality-routes.ts`, `shared/schema/quality.ts`, `shared/quality-governance.ts`, `client/src/pages/qm-dashboard.tsx`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | QC template system | [CONFIRMED] | Hierarchical: Template → Phase → Group → Item. Supports evidence-required flag and default severity. |
| 2 | Project-level checklists | [CONFIRMED] | `qcChecklist` instances created per project from templates. Item-level applicability and approval tracking. |
| 3 | Evidence management | [CONFIRMED] | `qcItemEvidence` stores evidence URL and notes per checklist item. |
| 4 | Risk assessment questions | [CONFIRMED] | `qcTemplateRiskQuestion` supports yes/no, text, numeric responses. Trigger conditions for warnings. |
| 5 | Warning system | [CONFIRMED] | `qcWarning` tracks quality warnings with severity (HIGH/MED/LOW), type (11 types), status, ownership, and due dates. |
| 6 | Postmortem metrics | [CONFIRMED] | `qcPostmortem` + `qcPostmortemMetricValue` + `qcPostmortemSummary` — contractor and engineering quality scores. |
| 7 | Commissioning items | [CONFIRMED] | `commissioningItems` with status lifecycle (not_started → in_progress → ready_for_review → approved → closed). |
| 8 | Evidence scoring model | [CONFIRMED] | `evidenceRequirementDefinitions` with weights, thresholds. `evidenceEvaluations` with pass/fail and score percentage. |
| 9 | No NCR register | [GAP] | No formal Non-Conformance Report table. Quality issues tracked as warnings but not as structured NCRs with root cause, corrective action, and close-out. |
| 10 | No inspection forms | [GAP] | No purpose-built inspection form schema. Inspections handled via generic QC checklist items. |
| 11 | No QA reporting dashboard | [GAP] | Quality dashboard exists but no aggregated QA report showing trends, defect rates, or compliance metrics across projects. |
| 12 | No ISO compliance tracking | [GAP] | No ISO 9001/14001 standard mapping. Checklists are project-specific, not standards-linked. |
| 13 | Quality-to-engineering link | [CONFIRMED] | `qcPlanLink` links QC items to plan items. `linkedQualityItemInstanceId` on work items. |

### 5.5 Project Dashboard & RAG Status

**Files:** `server/services/dashboard-metrics.ts`, `server/services/canonical-dashboard-kpi-service.ts`, `shared/status-logic.ts`, `shared/kpi-definitions.ts`, `client/src/pages/execution-dashboard/`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | RAG status stored on execution state | [CONFIRMED] | `projectExecutionState.ragStatus` with audit trail via `projectRagAudit`. |
| 2 | Status logic defined centrally | [CONFIRMED] | `shared/status-logic.ts` defines rules for computing health indicators. |
| 3 | KPI definitions centralized | [CONFIRMED] | `shared/kpi-definitions.ts` defines all KPI formulas and thresholds. |
| 4 | Dashboard materialized metrics | [CONFIRMED] | `dashboard_program_metrics` and `dashboard_project_metrics` tables for pre-computed metrics. Refreshable via API. |
| 5 | Execution dashboard with sub-views | [CONFIRMED] | Overview, Program, Construction, Finance sub-pages in `client/src/pages/execution-dashboard/`. |
| 6 | Manual RAG override possible | [CONFIRMED] | RAG can be overridden with reason via `projectRagAudit`. |
| 7 | No RAG consistency validation | [GAP] | No automated check that RAG status "Green" is consistent with underlying KPIs (e.g., schedule overdue, over budget). |
| 8 | No trend history | [GAP] | `projectRagAudit` stores transitions but no frontend visualization of RAG trend over time. |
| 9 | No comparison view | [GAP] | Cannot compare two projects or two time periods side-by-side on dashboard. |
| 10 | No exportable dashboard report | [GAP] | Dashboard data cannot be exported as PDF or Excel from the execution board. |

### 5.6 User Management & Permissions

**Files:** `server/routes/auth-routes.ts`, `server/role-auth-routes.ts`, `shared/permission-resolver.ts`, `client/src/pages/admin-roles.tsx`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | 14 defined company roles | [CONFIRMED] | From COO_ADMIN to PROJECT_DEVELOPER. Comprehensive role hierarchy. |
| 2 | Permission resolver | [CONFIRMED] | `shared/permission-resolver.ts` maps roles to `(entity, action)` permission tuples. |
| 3 | User permission overrides | [CONFIRMED] | `userPermissionOverrides` table allows per-user exceptions to role-based defaults. |
| 4 | Admin roles UI | [CONFIRMED] | `client/src/pages/admin-roles.tsx` provides UI for managing role permissions. |
| 5 | Workstream visibility | [CONFIRMED] | `workstreamVisibilityConfig` limits what workstreams each user/role can see. |
| 6 | No SSO for all users | [GAP] | Microsoft OAuth exists for admin users but not enforced as SSO for all users. Local password auth is primary. |
| 7 | No invite-by-email | [GAP] | No user invitation workflow. Users must be created by admin directly. |
| 8 | No password reset flow | [GAP] | No "forgot password" endpoint or email-based reset mechanism. |
| 9 | No session timeout configuration | [GAP] | Session expiry is not configurable per user/role. No idle timeout enforcement. |
| 10 | No comprehensive user activity audit | [GAP] | `auditEvents` captures some actions but no dedicated user activity log showing all pages visited, features used, etc. |
| 11 | Shared role passwords | [DEBT] | `roleCredentials` table stores role-level passwords. Multiple users sharing one credential is a security anti-pattern. |

### 5.7 Project Development Pipeline

**Files:** `server/pd-routes.ts`, `client/src/pages/pd-dashboard.tsx`, `client/src/pages/pd-tickets.tsx`, `client/src/pages/pd-ticket-detail.tsx`, `client/src/pages/pd-ticket-create.tsx`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | PD ticket system | [CONFIRMED] | `pdTickets` table with SharePoint integration for intake. Full create/view/edit UI. |
| 2 | PD-PM handover | [CONFIRMED] | `project_pd_pm_handover` table with gate tracking. Dedicated handover pages for both PD and PM sides. |
| 3 | Financial estimates on PD tickets | [CONFIRMED] | Migration `20260343` adds financial estimate fields to PD tickets. |
| 4 | PD visibility controls | [CONFIRMED] | `pdVisibilityConfig` controls which roles/users can see which PD tickets. |
| 5 | PD reports page | [CONFIRMED] | `client/src/pages/pd-reports.tsx` provides PD-specific reporting. |
| 6 | No win/loss tracking | [GAP] | No outcome field on PD tickets to track won vs lost opportunities. `lostDeals` table exists in FYE module but not linked to PD tickets. |
| 7 | No conversion analytics | [GAP] | No funnel visualization or conversion rate metrics from lead → proposal → contract → project. |
| 8 | No client CRM fields | [GAP] | `clients` table is minimal (id, name). No fields for industry, contact details, relationship history, or communication log. |
| 9 | No proposal document tracking | [GAP] | No structured tracking of proposal documents, versions, or submission dates on PD tickets. |

### 5.8 Reporting & Dashboards

**Files:** `server/report-routes.ts`, `server/services/monthly-report-*`, `server/routes/engineering-monthly-report-routes.ts`, `server/routes/pm-monthly-report-routes.ts`

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Monthly reports (PM & Engineering) | [CONFIRMED] | Full monthly report generation with PDF export (`monthly-report-pdf-service.ts`, `monthly-report-excel-service.ts`). |
| 2 | Report snapshots | [CONFIRMED] | `monthly_report_snapshots` stores point-in-time report data. |
| 3 | Report comparison | [CONFIRMED] | Compare page exists for both PM and Engineering monthly reports. |
| 4 | Report history | [CONFIRMED] | History pages with access to previous months' reports. |
| 5 | Programme reports | [CONFIRMED] | `client/src/pages/programme-reports.tsx` for portfolio-level reporting. |
| 6 | PDF and Excel export | [CONFIRMED] | Both PDFKit and ExcelJS used for report export. |
| 7 | No scheduled report generation | [GAP] | Reports must be manually triggered. No cron/scheduler to auto-generate monthly reports. |
| 8 | No custom date range reports | [GAP] | Reports are month-based. Cannot generate a report for an arbitrary date range. |
| 9 | No board-pack summary | [GAP] | No single-page executive summary suitable for board meetings. |
| 10 | No email distribution of reports | [GAP] | Generated reports must be downloaded manually. No email distribution list. |

---

## PHASE 6 — MICROSOFT INTEGRATION AUDIT

### 6.1 MS Teams Integration

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Teams chat read access | [CONFIRMED] | Scopes include `Chat.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`. Can read Teams messages. File: `server/microsoft-auth.ts:18-20` |
| 2 | Teams chats UI | [CONFIRMED] | `client/src/pages/teams-chats.tsx` displays Teams conversations within the app. |
| 3 | No push notifications to Teams | [GAP] | No outbound messages to Teams channels. Cannot send standup reminders, task notifications, or status alerts to Teams. |
| 4 | No Teams bot | [GAP] | No Microsoft Bot Framework integration. No interactive bot for task management via Teams. |
| 5 | No @mention support | [GAP] | Cannot @mention users in Teams from within the app. |
| 6 | No daily/weekly digest to Teams | [GAP] | No automated summary messages to Teams channels. |

### 6.2 SharePoint / OneDrive Integration

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | SharePoint site/list discovery | [CONFIRMED] | `server/sync-routes.ts` has endpoints to discover sites, lists, columns, items. Full CRUD on SharePoint lists. |
| 2 | SharePoint file access | [CONFIRMED] | `server/sharepoint.ts` reads files from SharePoint drives via Graph API. Used for Excel import source. |
| 3 | SharePoint list sync | [CONFIRMED] | `spListConfig` table stores sync configuration with column mapping and field ownership (SP_OWNED/APP_OWNED/SHARED). |
| 4 | File pointer tracking | [CONFIRMED] | `spFilePointers` tracks references to SharePoint files per entity. |
| 5 | Sync audit log | [CONFIRMED] | `syncAuditLog` records sync operations with counts and status. |
| 6 | No auto-created project document libraries | [GAP] | No logic to automatically create a SharePoint folder/library when a new project is created. |
| 7 | No document version control UI | [GAP] | SharePoint provides versioning but no UI within the app to view/compare document versions. |
| 8 | No deliverable document tracking | [GAP] | Engineering deliverables can point to SharePoint files but no structured tracking of required documents per project phase. |

### 6.3 Outlook Integration

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Calendar read/write | [CONFIRMED] | Scope: `Calendars.ReadWrite`. `server/outlook.ts` reads and creates calendar events. |
| 2 | Email read/write | [CONFIRMED] | Scope: `Mail.ReadWrite`, `Mail.Send`. Can read inbox and send emails via Graph. |
| 3 | Email-to-task linking | [CONFIRMED] | `mytoolEmailLinks` table links emails (by Outlook message ID) to tasks and priorities. |
| 4 | Calendar sync for timeblocks | [CONFIRMED] | `mytoolTimeblocks` has `outlookEventId` and `outlookCalendarId` for bidirectional calendar sync. |
| 5 | Email triage rules | [CONFIRMED] | `triageRules` table allows users to define rules for auto-categorizing emails (keyword, sender, domain). |
| 6 | No automated email notifications | [GAP] | App does not send emails for task assignments, status changes, or approvals. All notifications are in-app only. |
| 7 | No calendar sync for milestones | [GAP] | Project milestones and deadlines are not synced to Outlook calendar. Only personal timeblocks sync. |
| 8 | No meeting scheduling from app | [GAP] | Cannot create Outlook meetings (standup, site visit) directly from the app. |
| 9 | No email-to-task auto-creation | [GAP] | Emails can be manually linked to tasks but no inbound email processing to auto-create tasks. |

### 6.X Microsoft Integration BUGS (from deep audit)

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Refresh tokens stored unencrypted | [BUG] | Column is named `refresh_token_encrypted` in `ms_accounts` table but value stored is plaintext MSAL serialized cache. Zero encryption anywhere. File: `server/ms-account-service.ts`, `shared/schema/collaboration.ts:669` |
| 2 | SSO access token stored in plaintext | [BUG] | `ssoAccessToken: text("sso_access_token")` written directly to Postgres with no encryption. File: `shared/schema/collaboration.ts:670` |
| 3 | SharePoint List header typo | [BUG] | `server/sharepoint-list.ts:24` uses `X_REPLIT_TOKEN` (underscores) instead of `X-Replit-Token` (hyphens). Compare to `server/sharepoint.ts:22` which is correct. This causes auth failures on all SharePoint List operations. |
| 4 | Insufficient Graph API scopes for sending | [BUG] | Scope list includes `Chat.Read` but code calls `sendChatMessage` and `sendChannelMessage`. Needs `Chat.ReadWrite` and `ChannelMessage.Send`. Will get 403 errors. File: `server/microsoft-auth.ts:18` |
| 5 | `graphPost` fails on 202 No Content | [BUG] | `server/outlook.ts` `graphPost` calls `res.json()` on all success responses, but `sendMail` returns 202 with empty body. JSON parse will throw. |
| 6 | Duplicate Graph API helpers | [DEBT] | `graphGet` (line 119) and `graphGetWithToken` (line 434) are separate implementations. Bug fixes in one don't propagate. File: `server/outlook.ts` |
| 7 | Hardcoded timezone inconsistency | [DEBT] | `graphGet`/`graphPost` set `Africa/Johannesburg` timezone but `graphGetWithToken` (Teams functions) does not. File: `server/outlook.ts` |

### 6.4 Azure AD / SSO

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | MSAL ConfidentialClient auth | [CONFIRMED] | Azure AD OAuth 2.0 flow implemented via `@azure/msal-node`. Tokens cached and refreshed. File: `server/microsoft-auth.ts` |
| 2 | Azure Key Vault | [CONFIRMED] | `@azure/keyvault-secrets` used in `server/secrets/vault.ts` for secrets management. |
| 3 | Not enforced as SSO | [GAP] | Microsoft auth is optional. Users can still log in with local username/password. Not enforced as the sole auth method. |
| 4 | No Azure AD group sync | [GAP] | No syncing of Azure AD groups to app roles. Roles must be manually assigned in the app. |
| 5 | No conditional access policies | [GAP] | No integration with Azure AD conditional access (MFA enforcement, device compliance). |

---

## PHASE 7 — SECURITY AUDIT

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | Secrets in environment variables | [CONFIRMED] | `DATABASE_URL`, `SESSION_SECRET`, `AZURE_CLIENT_SECRET` all via env vars. `server/secrets/vault.ts` provides centralized access with Azure Key Vault fallback. |
| 2 | No hardcoded secrets in code | [CONFIRMED] | Searched codebase — no API keys, passwords, or tokens committed to source. |
| 3 | Security headers | [CONFIRMED] | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Frame-Options`. File: `server/bootstrap/security-middleware.ts:78-93` |
| 4 | No CSP header | [GAP] | Content Security Policy is not set. Critical for XSS mitigation. |
| 5 | No helmet middleware | [GAP] | Not using `helmet` npm package. Security headers are manually set (incomplete). |
| 6 | JWT token storage | [DEBT] | JWT stored in `localStorage` on client side. Vulnerable to XSS. Should use `httpOnly` session cookies. File: `client/src/lib/queryClient.ts:33` |
| 7 | SQL injection protection | [CONFIRMED] | Drizzle ORM parameterizes all queries by default. No raw SQL in application code (only in migration files). |
| 8 | XSS protection | [CONFIRMED] | `dompurify` in dependencies for HTML sanitization. Markdown rendering via `react-markdown` with built-in sanitization. |
| 9 | File upload validation | [CONFIRMED] | Multer limits file size. MIME type checks on upload routes. |
| 10 | No file content scanning | [GAP] | Uploaded files are not scanned for malicious content (viruses, macros). Only MIME type checked. |
| 11 | CORS configuration | [CONFIRMED] | `Cross-Origin-Resource-Policy` set. Replit-aware CORS allows dev preview. Production restricts to `same-origin`. |
| 12 | HTTPS enforcement | [DEBT] | No explicit HTTPS redirect middleware. Relies on hosting platform (Replit) for HTTPS termination. |
| 13 | Auth rate limiting | [CONFIRMED] | 20 requests per 15 minutes on auth endpoints. In-memory store with 5000-entry cap and periodic cleanup. |
| 14 | No rate limiting on API | [GAP] | Non-auth endpoints have zero rate limiting. |
| 15 | Session management | [CONFIRMED] | `connect-pg-simple` stores sessions in PostgreSQL. Session secret from env vars. |
| 16 | Password hashing | [CONFIRMED] | `bcryptjs` used for password hashing. |

---

## PHASE 8 — PERFORMANCE & SCALABILITY AUDIT

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | React Query caching | [CONFIRMED] | 30s staleTime, 5min gcTime. Prevents redundant API calls on tab switches and component remounts. |
| 2 | Lazy loading | [CONFIRMED] | All non-critical pages lazy-loaded via React Suspense. Reduces initial bundle size. |
| 3 | Virtual scrolling available | [CONFIRMED] | `@tanstack/react-virtual` in deps. Used for long lists. |
| 4 | No server-side caching | [GAP] | No Redis, no in-memory cache, no CDN caching headers. Every API request hits the database. |
| 5 | No job queue | [GAP] | Excel import, report generation, and data backfills run synchronously in HTTP request handlers. No BullMQ, SQS, or similar. Large imports could timeout. |
| 6 | DB connection pooling | [CONFIRMED] | PostgreSQL connection via `pg` pool. Neon PostgreSQL provides serverless connection pooling. |
| 7 | 680KB route file startup cost | [DEBT] | `server/routes.ts` is loaded in full at startup. 680KB of JavaScript parsed at boot time. |
| 8 | 110KB storage file | [DEBT] | `server/storage.ts` loaded entirely at startup. Should be split into domain-specific repositories. |
| 9 | No pagination on some list endpoints | [DEBT] | Several V1 list endpoints return all results. Could return thousands of records for active organizations. |
| 10 | Dashboard metrics not materialized | [DEBT] | Dashboards compute metrics on every request. Materialized views exist but require manual refresh. |
| 11 | No database query monitoring | [GAP] | No slow query logging, no query performance monitoring. |
| 12 | Missing database indexes | [GAP] | Key filter columns (`workItems.projectId`, `workItems.status`, `notifications.recipientUserId`) lack indexes. |

---

## PHASE 9 — CODE QUALITY & MAINTAINABILITY AUDIT

| # | Finding | Tag | Detail |
|---|---------|-----|--------|
| 1 | TypeScript `strict: false` | [DEBT] | `tsconfig.json` has `strict: false`. No strict null checks, no strict property initialization. File: `tsconfig.json:22` |
| 2 | 178+ `any` type usages | [DEBT] | Explicit `: any` found across 20+ files. Highest concentration: `server/quality-routes.ts` (69 occurrences). |
| 3 | `routes.ts` excluded from type checking | [DEBT] | `tsconfig.json` explicitly excludes `server/routes.ts` and `server/storage.ts` — the two largest backend files have zero type safety. |
| 4 | No ESLint | [GAP] | No `.eslintrc` file. No linting rules enforced. Code style is convention-only. |
| 5 | No Prettier | [GAP] | No `.prettierrc` file. No automated formatting. |
| 6 | No CI/CD pipeline | [GAP] | No `.github/workflows` directory. No GitHub Actions. No automated testing, linting, or build on PR. |
| 7 | Test coverage | [CONFIRMED] | 98 test files: 87 unit, 10 API, 1 integration, 1 E2E. Vitest + Playwright. Good coverage intent but no coverage threshold enforcement. |
| 8 | Test configuration | [CONFIRMED] | `qa/vitest.config.ts` (30s timeout, JSON reporter) and `qa/playwright.config.ts` (Chromium, 1 retry, screenshots on failure). |
| 9 | Release gate | [CONFIRMED] | `qa/release-gate.ts` (8.6KB) defines rollout quality gates. Manual execution. |
| 10 | No coverage threshold | [GAP] | No minimum test coverage percentage enforced. Tests could pass with 0% coverage. |
| 11 | Circular dependency risk | [DEBT] | Large files (`routes.ts`, `storage.ts`) import from many modules. No circular dependency detection tooling. |
| 12 | Documentation | [CONFIRMED] | 16 documentation directories with 60+ markdown files. Architecture docs, audit docs, training materials. Well-documented. |
| 13 | V1 vs V2 API coexistence | [DEBT] | Two API patterns coexist: V1 (monolithic, handler-level) and V2 (clean architecture). Migration path unclear. |

---

## PHASE 10 — UPGRADE & FEATURE RECOMMENDATIONS

### A. Critical Fixes (must fix before any new rollout)

| # | Finding | Tag | File | Fix |
|---|---------|-----|------|-----|
| 1 | `routes.ts` and `storage.ts` excluded from type checking | [DEBT] | `tsconfig.json:13-14` | Add these files back to TypeScript checking. Fix type errors iteratively. |
| 2 | JWT stored in localStorage | [DEBT] | `client/src/lib/queryClient.ts:33` | Migrate to httpOnly session cookies for token storage. |
| 3 | Dev login endpoint exposed | [DEBT] | `server/routes/auth-routes.ts` | Add production guard: throw error if `NODE_ENV=production` and endpoint is called. |
| 4 | No CSP header | [GAP] | `server/bootstrap/security-middleware.ts` | Add Content-Security-Policy header with strict source whitelist. |
| 5 | Shared role passwords | [DEBT] | `roleCredentials` table | Migrate to per-user authentication only. Deprecate shared role passwords. |
| 6 | Finance dual-key (projectName + projectId) | [CONFLICT] | `shared/schema/finance.ts` | Standardize on `projectId` FK only. Backfill and remove `projectName` lookups. |

### B. Data Integrity Fixes

| # | Finding | Tag | Fix |
|---|---------|-----|-----|
| 1 | No automatic KPI refresh after import | [GAP] | Add event-driven refresh: when `smartImportRuns` status → COMMITTED, trigger materialized metric recalculation. |
| 2 | Temporal `effectiveTo` not auto-closed | [GAP] | Add database trigger or application-level hook to close prior temporal records on new insert. |
| 3 | `workItems` column duplication with extensions | [DEBT] | Deprecate duplicated columns on `workItems`. Read from extension tables. Add migration to backfill. |
| 4 | Missing indexes on high-query columns | [GAP] | Add indexes: `workItems(projectId, status)`, `workItems(ownerUserId)`, `programExpense(projectName)`, `notifications(recipientUserId)`. |
| 5 | No RAG-KPI consistency check | [GAP] | Add validation: when RAG is set to Green, verify no red KPIs exist. Warn if inconsistent. |
| 6 | Inconsistent soft-delete patterns | [DEBT] | Standardize on `deletedAt` (nullable timestamp) across all tables. Migrate `isActive`, `deletedFlag`, integer `isActive`. |
| 7 | Multi-tenancy not enforced | [PLACEHOLDER] | Add `organizationId` FK to key tables. Add row-level security or middleware filtering. |

### C. Microsoft Integration Roadmap

| # | Integration | What it does | Complexity | Dependencies | Order |
|---|------------|-------------|-----------|--------------|-------|
| 1 | **Azure AD SSO enforcement** | All users authenticate via Azure AD. Local passwords deprecated. | Medium | Azure app registration, redirect URI config | **1st** |
| 2 | **AD group → role sync** | Azure AD security groups map to app roles automatically | Medium | AD SSO (above), group claims in token | **2nd** |
| 3 | **Outlook email notifications** | Send emails for task assignments, approvals, status changes, overdue reminders | Medium | `Mail.Send` scope (already granted) | **3rd** |
| 4 | **Calendar sync for milestones** | Project milestones and deadlines appear on user's Outlook calendar | Low | `Calendars.ReadWrite` scope (already granted) | **4th** |
| 5 | **Teams channel notifications** | Push standup reminders, status alerts, and digests to Teams channels | Medium | Teams bot registration, `ChannelMessage.Send` scope (not yet granted) | **5th** |
| 6 | **Auto-create SharePoint project folders** | On new project creation, create a SharePoint document library with standard folder structure | Medium | `Sites.ReadWrite.All` scope (upgrade from current `Sites.Read.All`) | **6th** |
| 7 | **Meeting scheduling from app** | Create Outlook meetings (standup, site visit) directly from project pages | Low | Calendar API (already connected) | **7th** |
| 8 | **Teams bot for task management** | Interactive bot: create tasks, update status, query dashboard from Teams chat | High | Bot Framework SDK, Azure Bot Service registration | **8th** |
| 9 | **Email-to-task auto-creation** | Inbound email rules create tasks automatically based on triage rules | High | Power Automate or custom webhook, email processing pipeline | **9th** |
| 10 | **SharePoint document version UI** | View/compare document versions from within the app | Medium | Graph API delta queries, custom UI component | **10th** |

### D. Feature Additions — Small (< 1 week each)

| # | Feature | Tag | Module |
|---|---------|-----|--------|
| 1 | Add database indexes on high-query columns | [GAP] | Database |
| 2 | Add CSP security header | [GAP] | Security |
| 3 | Add `helmet` middleware | [GAP] | Security |
| 4 | Add empty state messages to all list views | [DEBT] | Frontend |
| 5 | Add loading spinners to all async pages | [DEBT] | Frontend |
| 6 | Add form field `maxLength` constraints | [GAP] | Frontend |
| 7 | Disable dev-login endpoint in production | [DEBT] | Auth |
| 8 | Add RAG trend visualization | [GAP] | Dashboard |
| 9 | Add Outlook calendar sync for project milestones | [GAP] | MS Integration |
| 10 | Standardize soft-delete to `deletedAt` timestamp | [DEBT] | Database |

### E. Feature Additions — Medium (1–4 weeks each)

| # | Feature | Tag | Module |
|---|---------|-----|--------|
| 1 | Azure AD SSO enforcement | [GAP] | Auth |
| 2 | Email notifications for task assignments/approvals | [GAP] | MS Integration |
| 3 | Teams channel notification bot | [GAP] | MS Integration |
| 4 | NCR (Non-Conformance Report) register | [GAP] | Quality |
| 5 | Gantt chart visualization for tasks | [GAP] | Engineering |
| 6 | Budget variance alerts | [GAP] | Finance |
| 7 | Scheduled report generation (cron) | [GAP] | Reporting |
| 8 | Job queue for async import processing | [GAP] | Smart Import |
| 9 | Migrate `routes.ts` to modular route files | [DEBT] | Backend |
| 10 | CI/CD pipeline with GitHub Actions | [GAP] | DevOps |
| 11 | Win/loss tracking on PD tickets | [GAP] | PD Pipeline |
| 12 | Board-pack executive summary report | [GAP] | Reporting |
| 13 | Workload view (resource allocation) | [GAP] | Engineering |
| 14 | Client CRM fields expansion | [GAP] | PD Pipeline |

### F. Feature Additions — Large (1+ months)

| # | Feature | Tag | Module |
|---|---------|-----|--------|
| 1 | Multi-currency support | [GAP] | Finance |
| 2 | Full Teams bot with interactive task management | [GAP] | MS Integration |
| 3 | Email-to-task auto-creation pipeline | [GAP] | MS Integration |
| 4 | ISO compliance tracking framework | [GAP] | Quality |
| 5 | Full V1→V2 API migration | [DEBT] | Backend |
| 6 | Formal document management system with SharePoint | [GAP] | MS Integration |
| 7 | Conversion analytics / pipeline funnel | [GAP] | PD Pipeline |
| 8 | Real-time collaboration (WebSocket/SSE) | [GAP] | Platform |
| 9 | Multi-tenancy enforcement | [PLACEHOLDER] | Platform |
| 10 | Mobile-responsive PWA | [GAP] | Frontend |

### G. Technical Debt Paydown

| # | Item | Tag | Approach |
|---|------|-----|----------|
| 1 | `server/routes.ts` (680KB monolith) | [DEBT] | Split into domain-specific route files (already partially done with 80 route files). Move remaining endpoints. Delete monolith. |
| 2 | `server/storage.ts` (110KB) | [DEBT] | Split into domain repositories following V2 pattern (`server/repositories/`). |
| 3 | TypeScript `strict: false` | [DEBT] | Enable incrementally: start with `strictNullChecks`, then `noImplicitAny`, then full `strict`. |
| 4 | 178+ `any` usages | [DEBT] | Systematic replacement starting with `server/quality-routes.ts` (69 instances). |
| 5 | V1 vs V2 API coexistence | [DEBT] | Define migration plan: new features in V2 only, migrate critical V1 endpoints monthly. |
| 6 | `EngineeringTasksPage.tsx` (4,758 lines) | [DEBT] | Decompose into: TaskListView, TaskBoardView, TaskCalendarView, TaskDetailPanel, TaskFilterBar, TaskBulkActions. |
| 7 | Mock data file | [PLACEHOLDER] | Delete `client/src/lib/mockData.ts` and `client/src/lib/types.ts` if unused in production. |
| 8 | Legacy redirect routes | [DEBT] | Remove legacy paths (`/dashboard`, `/pm-dashboard`, `/revenue`) after confirming no external links point to them. |
| 9 | In-memory rate limiter | [DEBT] | Replace with Redis-backed rate limiter (e.g., `rate-limiter-flexible` with Redis adapter). |
| 10 | Migration date numbering | [DEBT] | Use sequential numbering format (001, 002, etc.) or real dates. Current `20260332` pseudo-dates confuse tooling. |

### H. World-Class Benchmark Gaps (vs Procore, Aconex, e-Builder)

| # | Capability | Current State | Enterprise Benchmark |
|---|-----------|---------------|---------------------|
| 1 | **Document Control** | SharePoint file references only | Full DMS with check-in/out, transmittals, distribution matrix, version control |
| 2 | **RFI Management** | No RFI module | Dedicated RFI register with response tracking, escalation, and deadline management |
| 3 | **Submittal Management** | No submittal tracking | Submittal register with review workflows, ball-in-court tracking |
| 4 | **Change Order Management** | Basic change control routes | Formal CO register with cost impact, schedule impact, approval chain |
| 5 | **Drawing Management** | Engineering deliverables only | Drawing register with revision control, markup tools, overlay comparison |
| 6 | **BIM Integration** | Not present | 3D model viewer, clash detection, BIM-to-field coordination |
| 7 | **Mobile Field App** | Web-responsive only | Native mobile app with offline mode, photo capture, punch lists |
| 8 | **Punch List / Snag List** | No dedicated module | Punch list with photo evidence, assignee tracking, close-out workflow |
| 9 | **Daily Logs** | Standup entries only | Weather, manpower, equipment, activities, safety, visitor logs |
| 10 | **Safety Management** | No safety module | Incident reporting, safety observations, toolbox talks, permit-to-work |
| 11 | **Correspondence Log** | Communication timeline events | Formal correspondence register with numbering, tracking, and acknowledgment |
| 12 | **Bid Management** | PD ticket system | Full bid/tender management with qualification, evaluation scoring, and comparison |
| 13 | **Resource Management** | Assignment allocation % | Crew scheduling, equipment allocation, material tracking with forecasts |
| 14 | **Contract Administration** | Basic contract value tracking | Contract register with clauses, variations, claims, retention, bonds |
| 15 | **Custom Workflows** | Hardcoded approval flows | User-configurable workflow engine for any approval/review process |

---

## MASTER RECOMMENDATION TABLE

| # | Area | Finding | Tag | Priority | Effort | Recommended Action |
|---|------|---------|-----|----------|--------|-------------------|
| 0x | Frontend | 401 redirect goes to `/login` instead of `/auth/login` — hits 404 | [BUG] | Critical | Low | Fix redirect path in `queryClient.ts:183` |
| 0y | Frontend | Dashboard queries skip Bearer token — uses raw `fetch()` | [BUG] | Critical | Low | Replace with `apiRequest` or `getQueryFn` in `dashboard.tsx` |
| 0z | Frontend | 10+ queries silently swallow 403/500 as empty arrays | [BUG] | High | Medium | Add error state handling in `project-detail.tsx` |
| 0a | MS Integration | Refresh tokens stored unencrypted (column named `encrypted`) | [BUG] | Critical | Medium | Encrypt tokens at rest with AES-256 via vault key |
| 0b | MS Integration | SharePoint List header typo (`X_REPLIT_TOKEN` vs `X-Replit-Token`) | [BUG] | Critical | Low | Fix header name in `server/sharepoint-list.ts:24` |
| 0c | MS Integration | Insufficient Graph scopes for sending (Chat.Read, not Chat.ReadWrite) | [BUG] | Critical | Low | Add `Chat.ReadWrite`, `ChannelMessage.Send` to SCOPES in `microsoft-auth.ts` |
| 0d | MS Integration | `graphPost` crashes on 202 No Content (sendMail) | [BUG] | Critical | Low | Check status code before calling `res.json()` in `outlook.ts` |
| 1 | Security | JWT in localStorage | [DEBT] | Critical | Low | Migrate to httpOnly cookies |
| 2 | Security | No CSP header | [GAP] | Critical | Low | Add CSP via security middleware |
| 3 | Security | Dev login in production | [DEBT] | Critical | Low | Add NODE_ENV guard |
| 4 | Code Quality | No CI/CD | [GAP] | Critical | Medium | Add GitHub Actions (lint, test, build) |
| 5 | Code Quality | `strict: false` | [DEBT] | Critical | Medium | Enable strict TypeScript incrementally |
| 6 | Backend | `routes.ts` 680KB monolith | [DEBT] | High | High | Split into domain route files |
| 7 | Database | Missing indexes | [GAP] | High | Low | Add indexes on workItems, expenses, notifications |
| 8 | Database | Finance dual-key | [CONFLICT] | High | Medium | Standardize on projectId FK |
| 9 | Database | No auto KPI refresh | [GAP] | High | Medium | Event-driven refresh after import |
| 10 | MS Integration | No SSO enforcement | [GAP] | High | Medium | Enforce Azure AD SSO |
| 11 | MS Integration | No email notifications | [GAP] | High | Medium | Send Outlook emails for assignments/approvals |
| 12 | Performance | No server caching | [GAP] | High | Medium | Add Redis for caching + rate limiting |
| 13 | Performance | No job queue | [GAP] | High | Medium | Add BullMQ for async import/reports |
| 14 | Finance | No budget variance alerts | [GAP] | Medium | Low | Add threshold checks on financial updates |
| 15 | Quality | No NCR register | [GAP] | Medium | Medium | Add NCR table and management UI |
| 16 | Engineering | No Gantt chart | [GAP] | Medium | Medium | Add Gantt visualization component |
| 17 | Engineering | 4,758-line component | [DEBT] | Medium | Medium | Decompose EngineeringTasksPage |
| 18 | Reporting | No scheduled reports | [GAP] | Medium | Medium | Add cron-based report generation |
| 19 | PD Pipeline | No win/loss tracking | [GAP] | Medium | Low | Add outcome field to PD tickets |
| 20 | Auth | No password reset | [GAP] | Medium | Low | Add email-based password reset flow |
| 21 | Auth | Shared role passwords | [DEBT] | Medium | Medium | Deprecate roleCredentials, per-user only |
| 22 | Frontend | Missing loading/empty states | [DEBT] | Low | Low | Add to all async pages |
| 23 | Frontend | Mock data file | [PLACEHOLDER] | Low | Low | Delete if unused |
| 24 | Database | Inconsistent soft deletes | [DEBT] | Low | Medium | Standardize to deletedAt pattern |
| 25 | Code Quality | 178+ any types | [DEBT] | Low | Medium | Replace with proper types |
| 26 | Code Quality | No ESLint/Prettier | [GAP] | Low | Low | Add and configure |
| 27 | MS Integration | Teams notifications | [GAP] | Medium | Medium | Bot Framework for channel alerts |
| 28 | MS Integration | Auto SharePoint folders | [GAP] | Medium | Medium | Create project library on creation |
| 29 | Frontend | No a11y testing | [GAP] | Low | Low | Add axe-core to test suite |
| 30 | Platform | No real-time updates | [GAP] | Low | High | Add WebSocket/SSE for live data |

---

## MICROSOFT INTEGRATION PLAN — ORDERED ROADMAP

```
Phase 1 (Weeks 1-2): Foundation
  └─ Azure AD SSO enforcement for all users
  └─ AD group → role sync

Phase 2 (Weeks 3-4): Communication
  └─ Outlook email notifications (task assignments, approvals, overdue)
  └─ Calendar sync for project milestones

Phase 3 (Weeks 5-6): Teams
  └─ Teams channel notification bot (standup reminders, status alerts)
  └─ Daily/weekly digest messages

Phase 4 (Weeks 7-8): Documents
  └─ Auto-create SharePoint project folders on project creation
  └─ Meeting scheduling from app

Phase 5 (Weeks 9-12): Advanced
  └─ Teams interactive bot (task CRUD from chat)
  └─ SharePoint document version UI
  └─ Email-to-task auto-creation
```

**Prerequisites for all phases:**
- Azure app registration with required permissions
- Admin consent for organization-level scopes
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` configured

---

## QUICK WINS — TOP 10 IMMEDIATE ACTIONS

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 0 | Fix 401 redirect: `/login` → `/auth/login` in `queryClient.ts:183` | 5 min | Users currently hit 404 on session expiry |
| 1 | Add CSP header to `security-middleware.ts` | 30 min | Blocks XSS via injected scripts |
| 2 | Add production guard on dev-login endpoint | 15 min | Prevents unauthorized access |
| 3 | Add database indexes on `workItems(projectId, status)`, `notifications(recipientUserId)` | 1 hour | Speeds up most-hit queries by 10-100x |
| 4 | Add `helmet` middleware | 30 min | Industry-standard security headers |
| 5 | Delete `client/src/lib/mockData.ts` if unused | 15 min | Remove dead code |
| 6 | Add empty state messages to list views | 2 hours | Better UX on empty datasets |
| 7 | Create `.eslintrc.json` with basic rules | 1 hour | Start catching code issues |
| 8 | Create `.prettierrc` for consistent formatting | 30 min | Consistent code style |
| 9 | Add basic GitHub Actions workflow (build + test) | 2 hours | Automated quality gates |
| 10 | Add RAG trend sparkline to dashboard cards | 2 hours | Quick insight into project health trajectory |

---

*End of Full Repository Audit Report*
