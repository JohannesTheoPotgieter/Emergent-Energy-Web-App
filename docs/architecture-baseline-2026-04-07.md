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
| Drizzle tables (`pgTable`) | **282** | `grep -r 'pgTable(' shared/schema/*.ts \| wc -l` | Across 20 domain schema files in `shared/schema/` |
| Drizzle enums (`pgEnum`) | **66** | `grep -rE 'pgEnum\(' shared/schema/*.ts \| wc -l` | |
| Schema barrel file | **30 lines** | `wc -l shared/schema.ts` | Re-export only; no table definitions |
| Schema domain files total | **9,021 lines** | `wc -l shared/schema/*.ts \| tail -1` | Largest: `users.ts` (1,466), `projects.ts` (1,342), `finance.ts` (1,191) |
| SQL migration files | **145** | `ls migrations/*.sql \| wc -l` | |
| Code-orphaned tables | **24** | See [Appendix A](#appendix-a-code-orphaned-tables) | Defined in schema, zero references in `server/` or `client/` |

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

These 24 tables are defined in the Drizzle schema (`shared/schema/*.ts`) but have **zero references** in any `server/` or `client/` source file. Status: **code-orphaned, live-data status unverified** (requires `SELECT count(*) FROM <table>` against production DB).

Methodology: For each exported `pgTable` constant, searched for any import or usage in `server/` and `client/` directories. Only tables with zero hits outside `shared/schema/` are listed.

### collaboration.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `approvalWorkflows` | ~915 | `approval_workflows` |
| `auditTrail` | ~868 | `audit_trail` |
| `dashboardWidgetConfig` | ~475 | `dashboard_widget_config` |
| `domainEvents` | ~831 | `domain_events` |
| `eventProcessingLog` | ~855 | `event_processing_log` |
| `eventSubscriptions` | ~845 | `event_subscriptions` |
| `fileVersions` | ~892 | `file_versions` |
| `notificationPreferences` | ~882 | `notification_preferences` |
| `pmComplianceTracking` | ~658 | `pm_compliance_tracking` |

### collaboration-workflow.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `clientCommitments` | ~118 | `client_commitments` |

> Note: Marked `@deprecated` in source with migration plan.

### finance.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `fiscalPeriods` | ~926 | `fiscal_periods` |
| `fiscalYears` | ~915 | `fiscal_years` |
| `paymentBatchItems` | ~1159 | `payment_batch_items` |
| `paymentBatches` | ~1132 | `payment_batches` |
| `paymentRequests` | ~1105 | `payment_requests` |

### projects.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `derivedPortfolioKpis` | ~986 | `derived_portfolio_kpis` |
| `derivedRagSummary` | ~1009 | `derived_rag_summary` |
| `projectHandoverGates` | ~1127 | `project_handover_gates` |
| `projectLinkageReviewQueue` | ~1224 | `project_linkage_review_queue` |
| `projectSubcontractorAssignments` | ~1206 | `project_subcontractor_assignments` |

### quality.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `evidenceCollectedItems` | ~295 | `evidence_collected_items` |
| `evidenceEvaluations` | ~313 | `evidence_evaluations` |
| `evidenceRequirementDefinitions` | ~275 | `evidence_requirement_definitions` |

### users.ts

| Variable Name | Line | SQL Table (approx) |
|--------------|------|---------------------|
| `organizations` | ~6 | `organizations` |

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
