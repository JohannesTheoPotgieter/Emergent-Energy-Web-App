# Canonical Architecture Baseline — 2026-04-07

> **Status**: CANONICAL — this is the single trusted source of codebase metrics.
> **Supersedes**: All prior audit documents. See [Superseded Documents](#superseded-documents) below.
> **Rule**: Do not create parallel metric snapshots. Update this file or create a dated successor.

---

## Verified Codebase Metrics

All counts below were measured on 2026-04-07 against the working tree. Each row includes the exact command used so any future reader can re-run and detect drift.

### Database & Schema

| Metric | Value | Command | Notes |
|--------|-------|---------|-------|
| Drizzle tables (`pgTable`) | **273** | `grep -r 'pgTable(' shared/schema/*.ts \| wc -l` | Across 20 domain schema files in `shared/schema/`. Reduced from 282 after dropping 9 orphaned tables (2026-04-07). |
| Drizzle enums (`pgEnum`) | **66** | `grep -rE 'pgEnum\(' shared/schema/*.ts \| wc -l` | |
| Schema barrel file | **30 lines** | `wc -l shared/schema.ts` | Re-export only; no table definitions |
| Schema domain files total | **9,021 lines** | `wc -l shared/schema/*.ts \| tail -1` | Largest: `users.ts` (1,466), `projects.ts` (1,342), `finance.ts` (1,191) |
| SQL migration files | **145** | `ls migrations/*.sql \| wc -l` | |
| Code-orphaned tables | **4 remaining** | See [Appendix A](#appendix-a-code-orphaned-tables) | 9 of the original 13 were dropped (2026-04-07). 2 retained (have data), 1 DO NOT DROP (FK), 1 investigate further. |

> **Note on prior schema-size claims**: Earlier audits reference `shared/schema.ts — 5,936 lines`. This likely referred to an older monolithic schema layout. The current repo uses domain-split schema files (`shared/schema/*.ts`) totaling 9,021 lines, with the barrel file (`shared/schema.ts`) at 30 lines.

### Backend — Routes & API

| Metric | Value | Command | Notes |
|--------|-------|---------|-------|
| Route files | **122** | `find server/ -name '*route*' -name '*.ts' \| wc -l` | Files with "route" in filename |
| Route handler registrations | **~2,304** | `grep -rE '\.(get\|post\|put\|patch\|delete)\(' server/ --include='*.ts' \| grep -vE '^\s*//' \| wc -l` | Counts `.get()/.post()/.put()/.patch()/.delete()` calls, excluding comments. Includes middleware and test helpers; unique METHOD+path count may be lower. |
| `server/routes.ts` size | **370,189 bytes (361.5 KB)** | `wc -c server/routes.ts` | 8,435 lines. Has `@ts-nocheck`. |

### TypeScript & Code Quality

| Metric | Value | Command | Notes |
|--------|-------|---------|-------|
| `strict` mode | **`true`** | `tsconfig.json` line 19 | Also: `noImplicitAny: true`, `strictNullChecks: true`, `strictFunctionTypes: true` |
| tsconfig file-level exclusions | **None for application code** | `tsconfig.json` lines 7-13 | Excludes only `*.test.ts`, `build`, `client/**/`, `dist`, `node_modules`. No exclusion of `routes.ts` or `storage.ts`. |
| Files with `@ts-nocheck` | **29** | `grep -rl '@ts-nocheck' server/ --include='*.ts' \| wc -l` | All in `server/`. Type checking is bypassed per-file, not via tsconfig. |
| `: any` annotations | **3,541** | `grep -rc ': any' server/ client/src/ shared/ --include='*.ts' --include='*.tsx'` | Across server + client + shared |
| `as any` assertions | **1,455** | `grep -rc 'as any' server/ client/src/ shared/ --include='*.ts' --include='*.tsx'` | |
| Total `any` usages | **~4,996** | Sum of above | |

### Frontend

| Metric | Value | Command | Notes |
|--------|-------|---------|-------|
| Page files | **154** | `find client/src/pages -name '*.tsx' \| wc -l` | |
| Component files | **215** | `find client/src/components -name '*.tsx' \| wc -l` | |
| Custom hooks | **25** | `find client/src/hooks -name '*.ts' -o -name '*.tsx' \| wc -l` | |

### Testing

| Metric | Value | Command | Notes |
|--------|-------|---------|-------|
| Test files | **152** | `find qa/tests -name '*.test.ts' -o -name '*.spec.ts' \| wc -l` | |

---

## Corrected False Claims

The following claims appear in prior audit documents and are **proven false** against the current repo. They must not be used as the basis for cleanup work.

| False Claim | Appeared In | Actual State | Evidence |
|-------------|-------------|--------------|----------|
| "TypeScript `strict: false`" | FULL_REPO_AUDIT_REPORT.md (lines 18, 21, 33, 715, 832, 889), CLAUDE_CODE_SUPER_PROMPTS.md (line 823) | `"strict": true` at `tsconfig.json:19` | `grep -n '"strict"' tsconfig.json` → `19: "strict": true` |
| "`tsconfig.json` excludes `routes.ts` and `storage.ts`" | FULL_REPO_AUDIT_REPORT.md (lines 34, 717) | tsconfig has no file-level exclusions for these files. Type checking is bypassed by `@ts-nocheck` inside each file. | `tsconfig.json` lines 7-13: excludes only `*.test.ts, build, client/**/, dist, node_modules` |
| "`routes.ts` is 680KB" | FULL_REPO_AUDIT_REPORT.md (lines 17, 20, 34, 63, 281, 702, 830, 890), CLAUDE_CODE_SUPER_PROMPTS.md (lines 81, 763, 772, 774) | **361.5 KB** (370,189 bytes), 8,435 lines | `wc -c server/routes.ts` → `370189` |

---

## Superseded Documents

The following documents contain stale metrics from March 2026. They are preserved in the repo for historical reference and are now marked with `SUPERSEDED` or `STALE METRICS` banners at the top of each file.

| Document | Date | Key Stale Claims |
|----------|------|-----------------|
| `docs/archive/docs/FULL_REPO_AUDIT_REPORT.md` | 2026-03-23 | 223 tables, 830+ endpoints, `strict: false`, 680KB routes.ts, 178+/~500 `any`, 40 @ts-nocheck, 67 migrations, 98 tests |
| `docs/archive/docs/architecture-audit/00-index.md` (+ sections 01-07) | 2026-03-20 | 200+ tables, 43 route files, 288+ endpoints, 33 migrations, 5,936 line schema, 99 pages, 147 components, 11 hooks |
| `docs/CLAUDE_CODE_SUPER_PROMPTS.md` | ~2026-03-23 | 223 tables, 830+ endpoints, `strict: false`, 680KB routes.ts, 178+ `any` |
| `COMPREHENSIVE_IMPLEMENTATION_PROMPT.md` | undated | ~200+ tables |

---

## Appendix A: Code-Orphaned Tables

> **Correction (2026-04-07, updated same day)**: The original version of this appendix listed 24 tables as code-orphaned. That count was wrong. The orphan analysis searched only for Drizzle ORM variable imports (`import { tableName } from "@shared/schema"`) and **missed 11 tables that are actively consumed via raw SQL strings** in route files and services. The corrected count is **13 truly code-orphaned tables**.

### Methodology (corrected)

For each exported `pgTable` constant in `shared/schema/*.ts`:
1. Searched for Drizzle ORM variable imports in `server/` and `client/`
2. **Also searched for the SQL snake_case table name** in raw SQL queries across `server/`, `client/`, `shared/`, `migrations/`, `server/bootstrap/`, `qa/`
3. Separated migration-only references (CREATE TABLE in `migrations/*.sql`) from runtime references (SELECT/INSERT/UPDATE/DELETE in route files, services, bootstrap scripts)
4. Only tables with zero runtime references AND zero bootstrap references are classified as code-orphaned

### Corrected false positives (11 tables — NOT orphaned)

These tables were originally listed as orphaned but are **actively used via raw SQL** (not Drizzle ORM imports). They must NOT be dropped.

| Variable Name | SQL Table | Active Runtime Consumer(s) |
|--------------|-----------|---------------------------|
| `paymentBatches` | `payment_batches` | `server/payment-batch-routes.ts` (10+ raw SQL queries) |
| `paymentBatchItems` | `payment_batch_items` | `server/payment-batch-routes.ts` (4 raw SQL queries) |
| `paymentRequests` | `payment_requests` | `server/payment-request-routes.ts`, `server/payment-batch-routes.ts`, `server/proof-of-payment-routes.ts` |
| `projectHandoverGates` | `project_handover_gates` | `server/handover-routes.ts` (8 raw SQL queries) |
| `projectSubcontractorAssignments` | `project_subcontractor_assignments` | `server/subcontractor-routes.ts` (4 raw SQL queries) |
| `pmComplianceTracking` | `pm_compliance_tracking` | `server/pm-on-the-go-routes.ts`, `server/lifecycle-routes.ts` |
| `evidenceCollectedItems` | `evidence_collected_items` | `server/services/evidence-evaluation-service.ts` |
| `evidenceEvaluations` | `evidence_evaluations` | `server/services/evidence-evaluation-service.ts` |
| `evidenceRequirementDefinitions` | `evidence_requirement_definitions` | `server/services/evidence-evaluation-service.ts` |
| `clientCommitments` | `client_commitments` | `server/services/collaboration-workflow-service.ts` (explicitly deprecated with legacy guard, but still referenced) |
| `fiscalPeriods` | `fiscal_periods` | `server/bridge/bridge-writer.ts` (queried via `finance.fiscal_periods`) |

### Truly code-orphaned tables (13 tables)

Status: **code-orphaned, live-data status unverified** (requires `SELECT count(*) FROM <table>` against production DB before any drop).

#### Dropped (9 tables — migration `20260407_drop_orphaned_tables.sql`)

The following 9 tables were removed from the Drizzle schema. 5 existed in the live DB with 0 rows and are dropped by the migration. 4 never existed in the live DB (schema-only definitions).

| Variable Name | SQL Table | Live DB Status | Action |
|--------------|-----------|---------------|--------|
| `approvalWorkflows` | `approval_workflows` | Never created in DB | Schema removed |
| `auditTrail` | `audit_trail` | Never created in DB | Schema removed |
| `fileVersions` | `file_versions` | Never created in DB | Schema removed |
| `notificationPreferences` | `notification_preferences` | Never created in DB | Schema removed |
| `domainEvents` | `domain_events` | 0 rows | Dropped by migration |
| `eventProcessingLog` | `event_processing_log` | 0 rows | Dropped by migration |
| `eventSubscriptions` | `event_subscriptions` | 0 rows | Dropped by migration |
| `derivedPortfolioKpis` | `derived_portfolio_kpis` | 0 rows | Dropped by migration |
| `derivedRagSummary` | `derived_rag_summary` | 0 rows | Dropped by migration |

Also dropped: `event_processing_status` enum (only consumer was `event_processing_log`).

#### Retained — have data, still code-orphaned (2 tables)

These tables have no runtime consumers but contain production data. They remain in the Drizzle schema and live DB until a decision is made to either adopt or archive their data.

| Variable Name | Schema File | SQL Table | Rows | Notes |
|--------------|------------|-----------|:---:|-------|
| `dashboardWidgetConfig` | collaboration.ts | `dashboard_widget_config` | 2 | Abandoned custom dashboard feature. Data may be seed/test. |
| `fiscalYears` | finance.ts | `fiscal_years` | 6 | Finance infrastructure. No runtime queries, but data exists. |

#### DO NOT DROP (1 table)

| Variable Name | Schema File | SQL Table | Reason |
|--------------|------------|-----------|--------|
| `organizations` | users.ts | `organizations` | **FK target**: `users.organization_id` references `organizations(id)`. Migration `20260334_organizations_multi_tenancy.sql` creates the table, seeds 1 row, and adds the FK. Dropping would break the users table constraint. |

#### Investigate further (1 table)

| Variable Name | Schema File | SQL Table | Reason |
|--------------|------------|-----------|--------|
| `projectLinkageReviewQueue` | projects.ts | `project_linkage_review_queue` | Migration artifact: `20260323_project_spine_backfill.sql` creates the table and populates it with backfill review items. May contain unresolved rows (`resolved_at IS NULL`). Need live DB query before any drop decision. |

---

## Appendix B: Files with @ts-nocheck

All 29 files are in `server/`. Listed alphabetically:

```
server/admin-recovery-routes.ts
server/approvals-routes.ts
server/departments/admin-routes.ts
server/departments/exco-routes.ts
server/departments/finance-routes.ts
server/departments/financial-integration-routes.ts
server/ee-info-routes.ts
server/eng-stage-routes.ts
server/engineering-routes.ts
server/excelParser.ts
server/handover-routes.ts
server/invoice-pattern-routes.ts
server/lib/import/detector.ts
server/lifecycle-routes.ts
server/pd-routes.ts
server/portfolio-routes.ts
server/role-management.ts
server/routes.ts
server/routes/cos-control-routes.ts
server/routes/dashboard-routes.ts
server/routes/operational-tasks-routes.ts
server/routes/planning-tasks-routes.ts
server/routes/working-plan-routes.ts
server/services/assignment-service.ts
server/services/task-cascade-service.ts
server/storage.ts
server/subcontractor-routes.ts
server/sync-routes.ts
server/template-routes.ts
```
