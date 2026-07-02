# Backend Inventory

**Date:** 2026-04-07

---

## Server Entrypoint & Bootstrap

| File | Purpose | Status | Evidence |
|------|---------|--------|----------|
| `server/index.ts` (196 lines) | Main Express server entry. Configures middleware, auth, routes, WebSocket, listens on port 5000 | **Active** | Package.json `dev` and `start` scripts both invoke this |
| `server/bootstrap/startup-orchestrator.ts` (~110KB) | 9-phase startup: secrets → DB → schema → security → session → passport → seeds → backfills → routes → error handler → runtime services | **Active** | Called from `server/index.ts` |
| `server/bootstrap/security-middleware.ts` | Helmet, CORS, rate limiting (20/15min auth, 200/min general), body parsing (2MB default, 25MB for imports), raw body capture | **Active** | Applied in startup phase |
| `server/bootstrap/session.ts` | Express-session: PG store (prod), memorystore (dev). 8h maxAge, 2h idle timeout, rolling sessions | **Active** | Called from startup orchestrator |
| `server/bootstrap/auth.ts` | Passport.js LocalStrategy (bcrypt), serialization/deserialization | **Active** | Called from startup orchestrator |
| `server/bootstrap/env-guard.ts` | Enforces SESSION_SECRET in production | **Active** | Called from startup orchestrator |
| `server/bootstrap/error-handling.ts` | Global Express error handler | **Active** | Registered last in middleware chain |
| `server/bootstrap/http-observability.ts` | Request logging middleware | **Active** | Applied in startup |
| `server/bootstrap/startup-report.ts` | Logs startup diagnostics | **Active** | Called at end of startup |
| `server/bootstrap/backfills/` | Data backfill tasks run on startup if enabled | **Active (conditional)** | Gated by `STARTUP_BACKFILL_ENABLED` flag |

---

## Route Registration Architecture

Routes are registered via a tree of registrar files, plus the legacy monolith:

```
register-all-routes.ts
├── registerCoreRoutes(app)           → register-core-routes.ts (35 route modules)
├── registerIntegrationRoutes(app)    → register-integration-routes.ts (4 modules)
├── registerInfoRoutes(app)           → register-info-routes.ts (3 modules)
├── registerProjectRoutes(app)        → register-project-routes.ts (13 modules)
├── registerSupportRoutes(app)        → register-support-routes.ts (19 modules)
├── registerDepartmentRoutes(app)     → register-department-routes.ts (15 modules)
├── registerAdminSupportRoutes(app)   → register-admin-routes.ts (5 modules)
├── registerExtractedRoutes(app)      → route-registry.ts (1 module: mytool-routes)
└── registerRoutes(httpServer, app)   → routes.ts ← THE 8,301-LINE MONOLITH (166 handlers)
```

**Total: 1,010 route handlers across 73 files.**

The monolith `server/routes.ts` still holds 166 handlers (~16% of total). The `route-registry.ts` file comment says it "will eventually replace server/routes.ts" but only mytool-routes have been extracted so far.

---

## Data Access Layer

| File | Purpose | Status | Notes |
|------|---------|--------|-------|
| `server/storage.ts` (~2,400 lines) | `IStorage` interface + `DatabaseStorage` class. 415+ methods covering ALL data access | **Active — God class** | Every route ultimately calls through this |
| `server/db.ts` (~1,200 lines) | Database initialization. PG preferred, SQLite fallback. Connection pooling (max 10). Schema bootstrap for SQLite | **Active** | Called from startup orchestrator |
| `server/repositories/users-repository.ts` (42 lines) | User CRUD: getById, getByEmail, getByUsername, create | **Active** | Used by storage.ts |
| `server/repositories/work-management-repository.ts` (303 lines) | Operational tasks, task details, writeback mappings, MyTool tasks/timeblocks | **Active** | Used by storage.ts |
| `server/config/db-config.ts` | Database mode selection (PG vs SQLite), Replit env auto-detection | **Active** | Used by db.ts |

---

## Services (46 files in `server/services/`)

### Core Business Services (Actively Used)

| Service | File | Purpose | Called By | Tables Touched |
|---------|------|---------|-----------|----------------|
| project-write-service | `project-write-service.ts` | Project CRUD with dual-write bridge sync | routes.ts, v2-routes | project_info, project_execution_state, core.projects |
| finance-line-write-service | `finance-line-write-service.ts` | Cost/revenue line CRUD with bridge sync, idempotency | routes.ts, smart-import | normalized_cost_lines, normalized_revenue_lines, finance.cost_lines/revenue_lines |
| stage-lifecycle-service | `stage-lifecycle-service.ts` | Stage gate progression, readiness checks | stage-lifecycle-routes | project_stage_instances, project_stage_requirements |
| approval-service | `approval-service.ts` | Universal approval creation (9 types: handover, budget, VO, procurement, gate, etc.) | approvals-routes | approvals |
| collaboration-workflow-service | `collaboration-workflow-service.ts` | Multi-reviewer workflows, evidence collection | stage-collaboration-routes | stage_acceptances, evidence_requests, client_commitments, client_updates |
| company-overview-service | `company-overview-service.ts` | Executive dashboard aggregation, queries 20+ tables | company-overview-routes | Many (read-only aggregation) |
| dashboard-metrics | `dashboard-metrics.ts` | Real-time KPI computation | dashboard-routes | project_info, finance tables, work_items |
| canonical-dashboard-kpi-service | `canonical-dashboard-kpi-service.ts` | Unified KPI logic across dashboards | dashboard-routes | Derived KPI tables |
| project-header-kpi-service | `project-header-kpi-service.ts` | Project header card RAG/variance metrics | v2-routes | project_info, finance tables |
| financial-review-service | `financial-review-service.ts` | Financial health assessment, margin tracking | financial-review-routes | project_financial_reviews |
| pm-monthly-report-service | `pm-monthly-report-service.ts` | PM report generation | pm-monthly-report-routes | Multiple aggregation |
| engineering-monthly-report-service | `engineering-monthly-report-service.ts` | Engineering report generation | engineering-monthly-report-routes | work_items, deliverables |
| smart-import-finance-bridge | `smart-import-finance-bridge.ts` | Post-import reconciliation, syncs cost/revenue to finance_records | smart-import-routes | normalized_cost_lines, finance_records |
| reconciliation-pack | `reconciliation-pack.ts` | Legacy ↔ promoted schema parity verification | admin routes | Cross-schema comparison |
| promoted-read-compat | `promoted-read-compat.ts` (66KB) | Compatibility layer for reading from promoted schema with fallback | Multiple routes | Promoted + legacy tables |
| notification-service | `notification-service.ts` | Notification dispatch | notification-routes | notifications |
| pipedrive-sync-service | `pipedrive-sync-service.ts` | Pipedrive CRM sync | pipedrive-routes | opportunities, clients |
| project-access-service | `project-access-service.ts` | Project-level access control | project-access-routes | project_access |
| stage-exception-service | `stage-exception-service.ts` | Gate exception handling | stage-lifecycle-routes | project_stage_exceptions |
| stage-dependency-service | `stage-dependency-service.ts` | Cross-stage dependency tracking | stage-lifecycle-routes | project_stage_dependencies |
| assignment-service | `assignment-service.ts` | Work item assignment | task routes | work_item_assignments |
| task-cascade-service | `task-cascade-service.ts` | Propagate changes to dependent tasks | task routes | work_items, work_item_dependencies |
| personal-task-bridge | `personal-task-bridge.ts` | MyTool ↔ work_items mapping | mytool-routes | work_items |
| work-item-conversion-service | `work-item-conversion-service.ts` | Legacy → unified work item model | task routes | work_items |
| evidence-evaluation-service | `evidence-evaluation-service.ts` | Evidence collection evaluation | quality routes | evidence_* tables |
| kpi-service | `kpi-service.ts` | KPI calculation | dashboard routes | derived_project_kpis |
| kpi-active-project-scope | `kpi-active-project-scope.ts` | Active project filtering for KPIs | dashboard routes | project_info |

### Report Generation Services

| Service | File | Purpose | Status |
|---------|------|---------|--------|
| monthly-report-excel-service | `monthly-report-excel-service.ts` | Excel report generation (ExcelJS) | **Active** |
| monthly-report-pdf-service | `monthly-report-pdf-service.ts` | PDF report generation (PDFKit) | **Active** |
| monthly-report-scheduler | `monthly-report-scheduler.ts` | Scheduled report generation | **Active** |
| report-drilldown-service | `report-drilldown-service.ts` | Report detail drill-down | **Active** |

### Migration/Bridge Services

| Service | File | Purpose | Status |
|---------|------|---------|--------|
| `server/bridge/bridge-writer.ts` (47KB) | Dual-write: legacy → promoted schema sync | **Active — Critical** |
| source-of-truth-policy | `source-of-truth-policy.ts` | Determines read source (legacy vs promoted) | **Active** |
| phase1a-reconciliation-policy | `phase1a-reconciliation-policy.ts` | Phase 1A migration reconciliation | **Active** |
| client-write-service | `client-write-service.ts` | Client entity writes with bridge | **Active** |

### Potentially Lower-Usage Services

| Service | File | Purpose | Status | Confidence |
|---------|------|---------|--------|------------|
| commissioning-workbook-parser | `commissioning-workbook-parser.ts` | Parse commissioning Excel workbooks | **Likely active** | Medium — used by commissioning routes |
| project-platform-summary-service | `project-platform-summary-service.ts` | Platform-level project summaries | **Likely active** | Medium |
| project-development-workspace-service | `project-development-workspace-service.ts` | PD workspace data | **Likely active** | Medium |
| project-lifecycle-workspace-service | `project-lifecycle-workspace-service.ts` | Lifecycle workspace data | **Likely active** | Medium |
| exception-dashboard-service | `exception-dashboard-service.ts` | Exception aggregation | **Likely active** | Medium |
| lifecycle-stage-gate-service | `lifecycle-stage-gate-service.ts` | Gate evaluation | **Likely active** | Medium |
| project-event-service | `project-event-service.ts` | Project event tracking | **Likely active** | Medium |
| project-summary-helpers | `project-summary-helpers.ts` | Shared summary computation | **Active** | High — utility used by others |
| financial-temporal | `financial-temporal.ts` | Temporal finance calculations | **Likely active** | Medium |
| imports-governance-service | `imports-governance-service.ts` | Import governance rules | **Active** | High — used by admin |
| auth-party-resolver | `auth-party-resolver.ts` | Resolve party from auth context | **Active** | High — used in permission checks |
| notification-trigger-scheduler | `notification-trigger-scheduler.ts` | Schedule notification triggers | **Active** | High |
| notification-triggers | `notification-triggers.ts` | Define notification trigger conditions | **Active** | High |

---

## Middleware

| File | Purpose | Status |
|------|---------|--------|
| `server/middleware/csrf.ts` + `csrf-config.ts` | CSRF double-submit cookie. Exempts: auth bootstrap, webhooks, health checks. Bearer-only requests skip CSRF | **Active** |
| `server/middleware/permission-middleware.ts` | 3-tier permission evaluation: user overrides → role JSONB → code defaults. 60s cache | **Active** |
| `server/middleware/project-scope-middleware.ts` | Project-scoped data access enforcement | **Active** |
| `server/middleware/requireAuth.ts` | Authentication enforcement (401) | **Active** |
| `server/middleware/requireAdmin.ts` | Admin role enforcement | **Active** |
| `server/middleware/requireRole.ts` | Specific role enforcement | **Active** |
| `server/middleware/validateBody.ts` | Zod-based request body validation | **Active** |
| `server/middleware/asyncHandler.ts` | Promise rejection wrapper | **Active** |
| `server/middleware/errorHandler.ts` | Error response formatting | **Active** |
| `server/middleware/deprecation-tracker.ts` | Track deprecated endpoint usage | **Active** |

---

## Auth System

| Component | File | Purpose |
|-----------|------|---------|
| Auth resolution | `server/auth-context.ts` | Resolves user from 4 sources: revoked cache → session → isAuthenticated → Bearer JWT. Token version check for instant revocation |
| Passport config | `server/bootstrap/auth.ts` | LocalStrategy with bcrypt |
| Microsoft OAuth | `server/microsoft-auth.ts` | MSAL-based OAuth flow. Scopes: User.Read, Mail.*, Calendars.*, Sites.*, Files.*, Chat.*, Teams.* |
| Roles management | `server/roles-management.ts` (~53KB) | Role CRUD, permission assignment, role-based features |
| Role auth routes | `server/role-auth-routes.ts` | Role authentication token endpoints |
| JWT handling | Inline in auth-context.ts | JWT sign/verify with tokenVersion for revocation |

---

## Background Jobs / Queues

| Component | File | Purpose | Status |
|-----------|------|---------|--------|
| Job queue | `server/lib/job-queue.ts` | BullMQ (Redis) preferred, in-memory fallback. 3 queues: METRICS_REFRESH, NOTIFICATION_SEND, IMPORT_PROCESS | **Active** |
| Import pipeline | `server/importPipeline.ts` | Scheduled interval-based smart import runs | **Active** |
| MS sync | `server/ms-sync-service.ts` | Microsoft Graph data sync (Teams, Outlook) | **Active** |
| Notification scheduler | `server/services/notification-trigger-scheduler.ts` | Scheduled notification dispatch | **Active** |
| Monthly report scheduler | `server/services/monthly-report-scheduler.ts` | Scheduled report generation | **Active** |
| Bridge retry | `server/bridge/bridge-writer.ts` `processBridgeRetryQueue()` | Manual reconciliation recovery for failed bridge syncs | **Active (manual trigger)** |

---

## External Integrations

| Integration | Files | Purpose | Required? |
|-------------|-------|---------|-----------|
| Microsoft OAuth + Graph | `server/microsoft-auth.ts`, `server/ms-sync-routes.ts` | SSO, email, calendar, Teams, SharePoint | **Yes (production auth)** |
| Azure Key Vault | `server/secrets/vault.ts` | Secret management (SESSION_SECRET, DB_URL, JWT_SECRET, AZURE_CLIENT_SECRET) | **Yes (production)** |
| PostgreSQL | `server/db.ts`, `server/config/db-config.ts` | Primary database | **Yes** |
| Redis | `server/lib/job-queue.ts` | Job queue backend (optional, in-memory fallback) | **Optional** |
| Pipedrive | `server/services/pipedrive-sync-service.ts` | CRM opportunity sync | **Optional** |
| SharePoint | `server/microsoft/sharepoint.ts` | Document management | **Optional** |
| ExcelJS / PDFKit | Various services | Report export | **Active** |

---

## Config / Environment Dependencies

### Required (Production)
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Session encryption
- `JWT_SECRET` — JWT signing
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — Microsoft OAuth

### Optional
- `REDIS_URL` — BullMQ job queue (falls back to in-memory)
- `KEY_VAULT_URI` — Azure Key Vault
- `SENDGRID_API_KEY` — Email delivery
- `PIPEDRIVE_API_KEY` — CRM sync
- `NODE_ENV` — development/staging/production
- `PORT` — Server port (default 5000)
- `DB_MODE` — Force sqlite (dev only)

### Startup Feature Flags (Environment)
- `STARTUP_MAINTENANCE_ENABLED` — Cleanup jobs on startup
- `STARTUP_SCHEMA_REPAIR_ENABLED` — Auto-create/repair schema
- `STARTUP_DATA_SEED_ENABLED` — Insert seed data
- `STARTUP_BACKFILL_ENABLED` — Run backfill jobs
- `STARTUP_SESSION_RESET_ENABLED` — Clear sessions on deploy
- `STARTUP_ENABLE_PERIODIC_SYNC` — Background bridge sync
- `LOCAL_DEV_MODE` — Allow startup mutations in dev
- `ADMIN_MIGRATION_MODE` — Allow admin mutations

---

## Utility / Library Layers

| Directory | Purpose | Status |
|-----------|---------|--------|
| `server/lib/calculations/` | Business logic calculations (finance, KPIs) | **Active** |
| `server/lib/finance/` | Financial helper functions | **Active** |
| `server/lib/audit/` | Audit logging utilities | **Active** |
| `server/lib/import/` | Import pipeline utilities | **Active** |
| `server/lib/reconciliation/` | Schema reconciliation tools | **Active** |
| `server/lib/cache.ts` | In-memory caching layer | **Active** |
| `server/lib/api-error.ts` | Structured API error class | **Active** |
| `server/lib/feature-flags.ts` | Feature flag read/write (app_settings table) | **Active** |
| `server/lib/job-queue.ts` | BullMQ / in-memory job queue | **Active** |
| `server/lib/project-info-sync.ts` | Column split sync (project_info → execution_state + settings) | **Active** |
| `server/data-seed/` | 8 JSON fixture files for seeding | **Active (dev/staging)** |
| `server/utils/` | General utilities | **Active** |

---

## API v2 Layer (Promoted Schema)

| File | Purpose | Status |
|------|---------|--------|
| `server/api/v2/routes/v2-routes.ts` (49 handlers) | RESTful v2 endpoints for projects, finance, plan, quality, engineering | **Active** |
| `server/api/v2/controllers/v2-controller.ts` | Request/response handling | **Active** |
| `server/api/v2/services/project-v2-service.ts` | V2 business logic | **Active** |
| `server/api/v2/repositories/project-v2-repository.ts` | V2 data access | **Active** |
| `server/api/v2/validators/project-v2-validators.ts` | Zod validation schemas | **Active** |
| `server/api/v2/policies/access-policy.ts` | V2 access control | **Active** |
| `server/api/v2/policies/permission-catalog.ts` | V2 permission definitions | **Active** |
| `server/api/v2/middleware/permission-helper.ts` | V2 permission middleware | **Active** |
| `server/api/v2/services/audit-service.ts` | V2 audit logging | **Active** |
| `server/api/v2/utils/http.ts` | HTTP utilities | **Active** |
