# Emergent Energy Web App Debug and Code QA Assessment

**Date:** 06/05/2026
**Auditor:** Senior full-stack QA / debug review (assessment only, no code changes)
**Branch:** `claude/audit-web-app-qa-HXBcj`
**Scope:** Full repo (`/home/user/Emergent-Energy-Web-App`) — code, schema, migrations, routes, tests, package scripts. Runtime/integration probing limited to commands that do not need a live DB or browser.

---

## 1. Top 20 Risk Register

Ranked by combined business impact, user-trust impact, likelihood, severity, and ease of verification. IDs link to sections 6/7.

| Rank | Issue ID | Risk Area | Severity | Confidence | Business Impact | User Trust Impact | Likelihood | Ease of Verification | File / Area | Recommended Next Step |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | EE-QA-001 | Build / Runtime | Critical | High | Production build fails — `tsc` errors out before bundle is produced | Deploys cannot ship; CI shows red | Certain (reproduced) | Trivial — `npm run check` | `client/src/components/POGenerator.tsx:344` (missing `AlertCircle` import) | Add `AlertCircle` to lucide-react import; re-run `npm run check`. |
| 2 | EE-QA-002 | Finance / Trust | Critical | High | Analytics endpoints fabricate numbers from constants and arithmetic on `total_project_value` | Users see "Actuals", "Approved Changes", "Velocity", "Trends" that are not real | Certain (read in source) | Trivial — read `server/analytics-routes.ts` | `server/analytics-routes.ts:24-77` | Either delete the endpoints + their UI cards, or label them "synthetic / demo" until real sources are wired. They MUST NOT ship to a pilot in current shape. |
| 3 | EE-QA-003 | Migrations / Data | Critical | High | Two SQL migrations exist on disk but are not in the journal — `db:check` fails | Schema-drift CI gate is red; production migrations may apply in unintended order | Certain | Trivial — `npm run db:check` | `migrations/0050_qb_invoice_links_allocations.sql`, `…_rollback.sql` vs `migrations/meta/_journal.json` | Regenerate the journal entry (or remove the rollback file from `/migrations` if it is meant to be archive-only) before any release. |
| 4 | EE-QA-004 | Permissions / Security | Critical | High | 3 routes registered without permission middleware that the CI guard explicitly flags as new | Any logged-in user can hit privileged endpoints | Certain | Trivial — `npm run test` | `server/analytics-routes.ts` (`POST /api/analytics/nav-event`), `server/ms-sync-routes.ts` (`GET /api/entity-assignments/bulk`), `server/routes/ops-dashboard.routes.ts` (`GET /api/ops-dashboard`) | Add `requirePermission(...)` or a `// permission-skip:` comment with a reason. |
| 5 | EE-QA-005 | Permissions / Trust | High | High | `isAdmin` is read from `localStorage.company_role`, which the same hook writes from the server response — a tampered value leaks UI but, more importantly, role-lens drift is invisible if the API permission map is stale | UI shows admin controls a non-admin can click; backend rejection looks like a bug | Likely on long-lived sessions | Easy — read `client/src/hooks/use-auth.tsx:122` | `client/src/hooks/use-auth.tsx`, `client/src/lib/access-control.ts` | Drive `isAdmin` purely from server-provided `permissions` snapshot and stop reading `localStorage.company_role` for anything other than role badges. |
| 6 | EE-QA-006 | Finance / Trust | High | High | `/api/quickbooks/links` and the QB invoice-match approve flow no longer carry the permission middleware and vendor-mapping upsert that the contract tests pin | Finance can bypass vendor lock and create cross-counterparty links | Certain (failing tests) | Easy — `npm run test` | `qa/tests/unit/quickbooks-route-hardening.test.ts`, `qa/tests/unit/quickbooks-invoice-match-routes.test.ts` | Restore `requirePermission("financials","edit")` on the link routes and the `upsertVendorMapping` + lock check on the approve handler. |
| 7 | EE-QA-007 | Finance / Trust | High | Medium | 10 raw `SELECT … FROM normalized_cost_lines / normalized_revenue_lines WHERE id = ?` point-lookups in the QB invoice-matches routes have no `effectiveTo IS NULL` guard | A re-import between suggestion-fetch and confirm can bind the QB link to a stale snapshot row's `projectId`, mis-attributing actuals | Low per-event but high blast radius | Easy — grep | `server/routes/quickbooks-invoice-matches.routes.ts:1046, 1053, 1093, 1105, 1547, 1559, 1828, 1836, 2152, 2159` | Add `isNull(normalizedCostLines.effectiveTo)` / `isNull(normalizedRevenueLines.effectiveTo)` to each, matching the convention used at line 2140 of the same file. |
| 8 | EE-QA-008 | Finance / Trust | High | High | Universal search `/api/search` reads `normalized_cost_lines` and `normalized_revenue_lines` without the snapshot guard or `deleted_at IS NULL` | Search returns historical/soft-closed rows, with duplicate hits on rows re-imported between snapshots | Certain whenever Smart Import runs | Trivial — read | `server/routes/misc-extracted-routes.ts:45-64` | Add `effective_to IS NULL` to both SELECTs; add `deleted_at IS NULL` while you are there. |
| 9 | EE-QA-009 | Navigation / Trust | High | High | Several Finance secondary-nav contract tests fail — `/po-approval-board`, `/payment-request-board`, `/payment-batch-manager` are missing from the Finance section | Finance users cannot find PO approval or payment workflows from the nav | Certain | Trivial — `npm run test` | `qa/tests/unit/nav-cleanup-validation.test.ts:181-195, 608-615` | Either restore the routes to the Finance group in `client/src/config/app-navigation.ts` / page-registry, or update the test to reflect the new IA. Decision must be a design call, not a quick test fix. |
| 10 | EE-QA-010 | Navigation / Routing | High | Medium | CEO/COO are forced into role-specific dashboards (`/ceo`, `/coo`) as their landing pages — the navigation-safety test pins this as a regression | CEO/COO land on a dashboard that is not the canonical execution board; data sources differ; numbers may not match the rest of the company view | Certain (failing test) | Trivial — `npm run test` | `client/src/config/page-registry.ts` `roleLandingEligibility` for `ceoHome` / `cooHome` vs `qa/tests/unit/navigation-safety-cleanup.test.ts:25` | Confirm with leadership: do CEO/COO land on `/ceo`/`/coo` (current) or `/execution-board` (test). Decide and align both sides. |
| 11 | EE-QA-011 | Repository Layer / Maintainability | High | High | 46 lint errors in routes for direct `db.{select,insert,update,delete}` usage from `*.routes.ts` handlers — bypasses the repository pattern that CLAUDE.md requires | Business rules drift between routes and repo helpers; finance numbers risk diverging | Already happening | Easy — `npm run lint` | `server/routes/quickbooks-invoice-matches.routes.ts` (40+ sites), `server/routes/finance-legacy-extracted-routes.ts`, `server/routes/dashboard-routes.ts`, `server/departments/*` | Move each `db.*` call into `server/repositories/*` and re-export. Treat as a structural debt project, not a single PR. |
| 12 | EE-QA-012 | Backend / API | High | Medium | KPI traceability registry advertises endpoints that don't exist (`/api/revenue-summary`, `/api/engineering-standup`) | Users opening "where does this number come from" see broken links and lose trust in the trace UI | Certain | Trivial — grep | `server/kpi-traceability-routes.ts:28-35`, `server/routes/dashboard-routes.ts` (no `/api/revenue-summary`) | Either implement the endpoints or replace the registry strings with the real backing endpoints (e.g. `/api/program-dashboard`, `/api/portfolio-dashboard`). |
| 13 | EE-QA-013 | Quality / Tests | High | High | `npm run test` fails with 11 tests across 6 files; `npm run test:api`, `:smoke`, `:routes`, `:workflows`, `:full-proof` all gated on a live DB and not run | The release-gate script will not pass; nobody can produce evidence the build is shippable | Certain | Trivial — `npm run test` | `qa/tests/unit/{nav-cleanup-validation, navigation-safety-cleanup, document-management-v2-schema, quickbooks-route-hardening, quickbooks-invoice-match-routes, route-permission-coverage}.test.ts` | Triage each failure; do not skip-mark them. |
| 14 | EE-QA-014 | Frontend / UX | High | Medium | "Dashboard" route now redirects to `/gates`; legacy bookmarks land on a different surface than the term "Dashboard" implies | Power users who bookmark `/dashboard` or send links lose context | Certain | Trivial — read | `client/src/config/page-registry.ts` `LEGACY_REDIRECTS` line 1 | Either rename the destination ("Gates") or re-introduce a `/dashboard` page that shows the program dashboard. Decision is a design call. |
| 15 | EE-QA-015 | Code Hygiene / Trust | High | Medium | Massive route files: `server/departments/finance-routes.ts` is 7,879 lines; `quickbooks-invoice-matches.routes.ts` 2,972 lines; `engineering-routes.ts` 3,684 lines; client `EngineeringTasksPage.tsx` 4,869 lines, `smart-import.tsx` 4,625 lines | Any defect in finance / engineering / smart-import will be hard to locate, hard to test, and easy to regress | Already manifest | Trivial — `wc -l` | See above | Track as structural debt; freeze additions to these files; introduce a per-domain split plan. |
| 16 | EE-QA-016 | Integrations / Trust | High | Medium | Three connectors (`ms-graph`, `quickbooks`, `pipedrive`) silently fall back to fixture data when creds are absent in non-prod, with no UI indicator | A demo user shown "synced" QB data may be looking at fixtures and not realise it | Likely in pilot | Easy — read `server/lib/connector-mode.ts` | `server/lib/connector-mode.ts`, `server/mocks/{ms-graph,quickbooks,pipedrive}-fixtures.ts` | Surface a banner / per-card badge ("FIXTURE DATA") whenever `isMockMode(name)` is true. Today the gate is correct; the user-visibility is missing. |
| 17 | EE-QA-017 | Smart Import / Data | High | Medium | `server/excelParser.ts` and `server/importPipeline.ts` are still in the tree, still 1,200+ LOC each, and still consumed by older code paths in `seed-ee-info-updates.ts` and elsewhere — CLAUDE.md marks them legacy | Importer behaviour drifts between Smart Import v2 and the legacy parser; finance numbers depend on which path runs | Likely on edge cases | Medium — code review | `server/excelParser.ts`, `server/importPipeline.ts`, `server/storage.ts` references | Audit every remaining import of these files; either route through `server/imports/` or delete the legacy modules. |
| 18 | EE-QA-018 | Frontend / UX | Medium | Medium | `auth.routes.ts` is empty; `auth-routes.ts` is the real registrar — but the new file pattern (`*.routes.ts`) is the documented convention | Devs editing the wrong file fix nothing | Likely | Trivial — read | `server/routes/auth.routes.ts`, `server/routes/auth-routes.ts` | Delete the empty stub, or move auth into the new pattern. |
| 19 | EE-QA-019 | Permissions / Frontend | Medium | Medium | The `RoleGuard` falls open ("still render children") when `/api/auth/permissions` errors, with the comment that "page-level error handling can kick in" — but most pages don't have such handling | Permission failures look like blank screens; users assume bug, not denial | Likely on flaky network | Easy — read | `client/src/App.tsx:128-138` | When the matrix query errors, render a single bordered "Permission service unavailable — try refresh" banner instead of letting the page render with an empty matrix. |
| 20 | EE-QA-020 | Build / Tooling | Medium | High | `tsconfig.check.json` requires `@types/node`; on a fresh clone the check fails with "Cannot find type definition file for 'node'" until `npm install` runs | Devs / CI need an explicit install step; fresh-clone QA is harder | Certain | Trivial | `tsconfig.check.json` | Document the required install step in README.md, and ensure CI runs `npm ci` before `npm run check`. |

---

## 2. Executive Summary

**Overall readiness score (1–5):** **2.4 / 5 — fragile, not pilot-ready as-is**. The architecture is mature (canonical phases, snapshot tables, repository pattern, permission registry, mock-connector gate), but several critical regressions are in flight on the current branch, and the build itself does not compile. None of the issues are unfixable; all are diagnosable and most are quick-fix.

**Biggest trust risks:**
- A single missing import breaks the build (EE-QA-001).
- Three "analytics" endpoints display fabricated numbers as if they were real (EE-QA-002).
- Two QuickBooks contract tests fail — vendor-mapping upsert and the financial-permission gate on link writes have regressed (EE-QA-006).

**Biggest workflow risks:**
- Finance secondary nav has lost PO approval / payment request / payment batch links (EE-QA-009). Finance users will not find their core actions.
- CEO/COO landing pages diverge from the canonical execution board (EE-QA-010).
- Bookmarked `/dashboard` redirects to `/gates` — a UX regression (EE-QA-014).

**Biggest finance risks:**
- The COS / GP / revenue-tracker math is sound at the repository layer (snapshot guards present, `isCanonicalCosRealised` is centralised, payment-date used for cashflow), but 10 point-lookups in the QB matching path miss the `effectiveTo` guard (EE-QA-007), and the `/api/search` aggregate path joins historical snapshot rows directly (EE-QA-008).
- Three migrations on disk are out of journal (EE-QA-003) — a deploy-time risk.

**Biggest permission / navigation risks:**
- 3 routes ungated per the CI baseline (EE-QA-004).
- Client-side `isAdmin` reads from `localStorage` (EE-QA-005); permission service errors fail-open (EE-QA-019).
- 46 lint errors in routes for direct `db.*` access (EE-QA-011).

**Biggest integration risks:**
- Mock connectors silently substitute fixtures with no UI signal (EE-QA-016).
- Legacy Excel parser still in place alongside Smart Import v2 (EE-QA-017).

**Biggest code risks:**
- Several route files exceed 3,000 LOC; the largest is 7,879 (EE-QA-015). Maintainability cliff.

**Recommended next move:**
1. Fix EE-QA-001 (1 line) and EE-QA-003 (regenerate journal) — both are minutes of work and unblock CI.
2. Fix EE-QA-006 and EE-QA-004 — they are *regressions* against existing CI tests, not new work.
3. Decide whether the analytics fabrication endpoints (EE-QA-002) ship at all; if so, gate them behind a "Demo" badge.
4. Decide nav IA (EE-QA-009, EE-QA-010, EE-QA-014) — these are product calls, not engineering calls.
5. Schedule the structural debt items (EE-QA-011, EE-QA-015, EE-QA-017) into named workstreams so they don't drift further.

Do **not** attempt a pilot until items 1–4 are closed and `npm run check`, `npm run lint`, and `npm run test` are all green.

---
## 3. Repository Understanding

**Frontend stack**
- React 19 + Vite, TypeScript.
- Routing: `wouter` (lightweight; not React Router).
- State: TanStack React Query v5; React Hook Form + Zod for forms.
- UI: Tailwind v4, shadcn/ui (New York), Radix primitives, Lucide icons. Theme is white + emerald.
- Page registry: `client/src/config/page-registry.ts` (~140 entries; declarative `permissionEntity` per page).
- Aliases: `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`.

**Backend stack**
- Node + Express 5 + TypeScript (`tsx` in dev, CJS bundle via `script/build.ts` in prod).
- Repository pattern under `server/repositories/` (CRUD must go through these; lint rule enforces it but is widely violated — see EE-QA-011).
- Validation: Zod via `server/middleware/validateBody.ts`.
- Errors: `server/lib/api-error.ts` `ApiError` class; central error handler in middleware.
- Auth: `requireAuth` (`server/middleware/requireAuth.ts`) + `requirePermission(entity, action)` (`server/permission-middleware.ts`).
- Bootstrap: `server/bootstrap/` runs additive migrations + seeds at startup.
- Smart Import v2: `server/smart-import-routes.ts` + `server/imports/` (3,656 LOC main route file). Legacy `server/excelParser.ts` and `server/importPipeline.ts` still on disk.

**Database / ORM**
- Drizzle ORM 0.45.2 with `drizzle-zod` 0.7.0.
- Dual-mode: PostgreSQL in prod, `better-sqlite3` in dev fallback.
- Schema source of truth: `shared/schema/*.ts` (29 domain files including `app-settings`, `finance`, `projects`, `engineering`, `quality`, `tasks`, `documents`, `imports`, `users`, `hse`, `handover`, `pending-approvals`, etc.). `shared/schema.ts` is a barrel.
- Snapshot/effective-date pattern on the seven tables CLAUDE.md calls out (verified in §10 / EE-QA-007/008).

**Migrations**
- Location: `/migrations/` at repo root.
- 58 migrations on disk; journal is `migrations/meta/_journal.json`.
- Drift gate: `scripts/db-check-drift.ts` (currently failing — EE-QA-003).
- 225 archived pre-baseline migrations in `migrations/archive/` (reference only).

**Test framework**
- Vitest for unit/API tests (`qa/vitest.config.ts`).
- Playwright for smoke/e2e (`qa/playwright.config.ts`).
- Release gate: `qa/release-gate.ts`.
- 268 unit-test files; current run: 259 pass / 6 fail / 3 skip → 11 failing tests (EE-QA-013).
- API tests, smoke tests, route tests, workflow tests need a running DB and are wrapped in `script/run-with-app.ts` — not exercised in this assessment.

**Build scripts**
- `npm run dev` — Express on :5000, Vite middleware-mounted.
- `npm run build` — `script/build.ts` outputs `dist/index.cjs` and `dist/public/`.
- `npm run check` (currently failing — EE-QA-001) — `tsc -p tsconfig.check.json && tsc -p tsconfig.client-check.json`.
- `npm run lint` — ESLint 9 flat config; 47 errors / 11,366 warnings.
- `npm run db:check` — drift CI guard (failing — EE-QA-003).

**Main modules (by surface)**
- Finance: cashflow, COS, revenue tracker, GP tracker, QB throughput, QB matching, payment-request board, PO approval board, payment-batch manager, finance trust.
- Project Management: projects, project-detail, lifecycle-board, gates, stage-gate, execution-board, milestone-tracker, weekly-reviews, standups, pm-monthly-report, pm-on-the-go.
- Project Development: pd-dashboard, opportunities, sites, sseg-submissions, pd-pm-handover-v2.
- Engineering: engineering-dashboard, engineering-tasks (4,869 LOC), engineering-monthly-report, engineering-audit, eng-template-admin.
- Quality: qm-dashboard, quality, quality-ncr.
- HSE: hse-dashboard.
- Handover & Compliance: handover-dashboard, handover-control, handover-live, pm-handover-review.
- Documents: documents, project-documents, admin-document-management, admin-document-types.
- Smart Import & Data: smart-import (4,625 LOC), import-control-tower, excel-vs-app, manual-overrides, tracker replicas, KPI traceability.
- Admin: admin-roles, admin-control-center (retired), admin-quickbooks, admin-pipedrive, admin-recovery, admin-workflow-config, admin-backfill, admin-email-linker-dev, role-settings, system-activity-log, phase-templates.
- My Work: my-work-home, my-work-tasks, my-work-calendar, my-work-meetings, my-work-settings, inbox, leaderboard.
- Reports: reports, programme-reports, ceo-home, coo-home, company-overview.

**Main integrations**
- Microsoft Graph (Outlook, Teams, SharePoint, Calendar) via `@microsoft/microsoft-graph-client` + `@azure/msal-node`. SharePoint List "Proposals Pipeline" sync is COO-only.
- QuickBooks Online — many-to-many invoice/bill ↔ app-line allocations with rand-allocation tolerance; canonical writer `confirmLinksWithAllocations()`.
- Pipedrive — opportunities CRM, ms_user_id linkage, won-deals KPI on PD dashboard.
- Excel Smart Import v2 — `server/imports/` pipeline; line IDs are hash-based and preserved across imports.
- Replit Connectors — auth layer for MS Graph in dev/prod.

**Navigation model**
- Driven by `client/src/config/page-registry.ts` (declarative `path / permissionEntity / navGroup / showInSidebar / roleLandingEligibility / aliases / accessPolicy`).
- App.tsx wires `RoleGuard` + `Suspense` + `Switch` + `Route`. `RoleGuard` waits for `useAccessMatrix()` to resolve before deciding deny.
- 14 nav groups (`MY_WORK`, `PORTFOLIO`, `PRIORITIES`, `PROJECT_DEVELOPMENT`, `PROJECTS`, `PROJECT_MANAGEMENT`, `GATES`, `FINANCE`, `ENGINEERING`, `QUALITY`, `HSE`, `REPORTS`, `KNOWLEDGE`, `SYSTEM`).
- `LEGACY_REDIRECTS` map old bookmarks to current paths.

**Role / permission model**
- Roles authoritative in `shared/schema/users.ts:99-117` — `COMPANY_ROLES` constant (16 roles: COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER, QUALITY_MANAGER, ENGINEERING_MANAGER, KEY_ACCOUNTS_MANAGER, ACCOUNTANT, ENGINEER, PROJECT_MANAGER_SITE, PROJECT_DEVELOPER, HSE_MANAGER, SSEG_MANAGER).
- Entity registry: `shared/permissions/registry.ts`; templates: `shared/permissions/templates.ts` (13 curated templates).
- Server enforcement: `requirePermission(entity, action)` in `server/permission-middleware.ts`.
- Client gating: `<PermissionGate entity="…" action="…">` and `usePermission()`.
- Page-level access control via `useAccessMatrix().canViewPath()` driven by `permissionEntity` declared on each page-registry entry.

**Key assumptions found in code**
- All finance reads must filter `isNull(effectiveTo)` on snapshot tables — convention is honoured in repositories but missed in 12 places (EE-QA-007, EE-QA-008).
- Cashflow uses `paidDate` for actuals (`server/repositories/finance-analysis-repository.ts:824`) — matches the business rule.
- COS realisation uses `isCanonicalCosRealised(...)` central helper — payment date, invoice number, status, override are all considered.
- Mock connectors only activate when `NODE_ENV !== "production"` — gate is correct.
- `work_items` table is the canonical engineering execution store; `engineering_tickets` is a back-compat mirror; the legacy view-based architecture is retired.
- Canonical phase set is 10 sequential + 2 terminal (Hold, Done) in `shared/phases.ts`.

**Unknowns from current codebase** (cannot be confirmed without a live DB / browser session)
- Whether the SharePoint COO-only gate in production actually scopes to a single user or a role.
- Whether the `pending_approvals` queue actually intercepts every write that the README claims it does.
- Whether `connect-pg-simple` session store is in use for SSO-side flows or only password fallback.
- Whether dev seed data (`seed/`) overlaps with the Smart Import baseline rows in a way that masks live import bugs.
- Whether the `roleLandingEligibility` UX is what leadership actually wants (EE-QA-010 is a contract test failure but the contract is unverified).
- Whether bank-detail encryption has been rotated since `scripts/encrypt-existing-bank-details.ts` last ran.

---

## 4. Validation Commands Run

| Command | Result | Notes | Blocking? | Related Files |
|---|---|---|---|---|
| `ls / cat package.json` | ✅ OK | 946 deps; primary scripts as documented | No | `package.json` |
| `npm install` | ✅ Installed 946 packages | 8 deprecated transitive packages flagged | No | `package-lock.json` |
| `npm run check` | ❌ FAIL | `client/src/components/POGenerator.tsx(344,95): error TS2304: Cannot find name 'AlertCircle'` | **Yes — build-breaking** | `client/src/components/POGenerator.tsx:13-16, 344` (EE-QA-001) |
| `npm run check:client` | ❌ FAIL | Same single TS error | **Yes** | (same) |
| `npm run lint` | ❌ 47 errors / 11,366 warnings | Errors are mostly "Direct db.{select,insert,update,delete} from a *.routes.ts handler" + 1 raw-error-leak | **Yes (CI)** | EE-QA-011 |
| `npm run db:check` | ❌ FAIL | Migration journal missing 2 SQL files: `0050_qb_invoice_links_allocations.sql`, `…_rollback.sql` | **Yes (CI)** | EE-QA-003 |
| `npm run test` | ❌ 11 failed / 5,045 passed / 18 skipped | 6 failing test files — see register | **Yes (CI)** | EE-QA-013 |
| `npx tsx scripts/check-duplicate-routes.ts` | ✅ PASS | No duplicate `app.<method>(path)` registrations | No | — |
| `npx tsx scripts/check-routes-migration.ts` | ✅ PASS | `routes.ts` reduced 99.6% from baseline; 0 handlers remaining | No | — |
| `npm run test:api` | ⏸ NOT RUN | Requires live DB via `script/run-with-app.ts` | (cannot verify) | — |
| `npm run test:smoke` | ⏸ NOT RUN | Requires live server + Playwright browsers | (cannot verify) | — |
| `npm run test:routes` | ⏸ NOT RUN | Requires live server | (cannot verify) | — |
| `npm run test:workflows` | ⏸ NOT RUN | Requires live server + DB | (cannot verify) | — |
| `npm run release:gate` | ⏸ NOT RUN | Composite of the above | (cannot verify) | `qa/release-gate.ts` |
| `npm run build` | ⏸ NOT RUN | Will fail until EE-QA-001 is fixed | (cannot verify yet) | `script/build.ts` |

---

## 5. Module Readiness Scorecard

Scoring 1 (not ready) → 5 (production-ready) per dimension. "Overall" is the weakest pillar — a 5 in maintainability cannot rescue a 1 in data trust.

| Module | Runtime Stability | Workflow Fit | Data Trust | UX Clarity | Backend Correctness | Maintainability | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| Build / Toolchain | 1 | n/a | n/a | n/a | n/a | 3 | **1** | Build does not compile (EE-QA-001). |
| Finance — Cashflow | 3 | 4 | 3 | 3 | 4 | 2 | **2** | Repo helpers correct, but file size + `db.*` lint errors point to fragility. |
| Finance — COS | 3 | 4 | 3 | 3 | 4 | 2 | **2** | `isCanonicalCosRealised` is centralised; UI labels need verification. |
| Finance — Revenue Tracker | 3 | 3 | 3 | 3 | 4 | 2 | **2** | Same shape as COS. |
| Finance — QB Matching / Recon | 2 | 3 | 2 | 3 | 2 | 2 | **2** | EE-QA-006/007 are open regressions. |
| Finance — Analytics widgets | 1 | 1 | 1 | 1 | 1 | 2 | **1** | Fabricated numbers (EE-QA-002). |
| Project Management — Lifecycle / Gates | 4 | 4 | 3 | 3 | 4 | 3 | **3** | Phase model is mature; gate auto-evaluator service exists. |
| Project Management — Tasks / Plan | 3 | 3 | 3 | 2 | 3 | 2 | **2** | `EngineeringTasksPage.tsx` 4,869 LOC; high regression risk. |
| Project Development | 3 | 3 | 3 | 3 | 3 | 3 | **3** | Pipedrive + opportunities consolidation is recent; needs pilot exposure. |
| Engineering | 3 | 3 | 3 | 3 | 3 | 2 | **2** | Bidirectional `work_items` ↔ `engineering_tickets` sync covered by 28 regression tests. |
| Quality / NCR | 3 | 3 | 3 | 3 | 3 | 3 | **3** | Calmer surface; no critical findings observed. |
| HSE / Compliance | 2 | 2 | 2 | 2 | 2 | 3 | **2** | Limited evidence in code that PD→PM handover gates HSE module visibility; needs runtime confirmation. |
| Smart Import v2 | 3 | 3 | 3 | 2 | 3 | 2 | **2** | Legacy parser still on disk (EE-QA-017). |
| Document Management | 3 | 3 | 3 | 3 | 3 | 3 | **3** | Multi-iteration migrations (`0032`, `0033`, `0044`); needs end-to-end smoke. |
| QuickBooks integration | 2 | 3 | 2 | 3 | 2 | 2 | **2** | EE-QA-006 + 10 unguarded point-lookups. |
| SharePoint / Microsoft 365 | 3 | 3 | 3 | 2 | 3 | 3 | **3** | COO-only gate documented; UI signal for fixture mode missing (EE-QA-016). |
| Pipedrive | 3 | 3 | 3 | 3 | 3 | 3 | **3** | Mock-mode default; same fixture-visibility concern. |
| Auth / Permissions | 2 | 4 | 3 | 3 | 3 | 3 | **2** | EE-QA-004/005/019. |
| Navigation / Page Registry | 2 | 3 | 4 | 3 | 4 | 4 | **2** | EE-QA-009/010/014. |
| Admin & Settings | 3 | 3 | 3 | 3 | 3 | 3 | **3** | "Roles & Permissions" canonical page now exists. |
| Reports / Dashboards | 2 | 3 | 2 | 2 | 2 | 2 | **2** | Analytics fabrication, KPI traceability dead links. |
| Tests / QA infrastructure | 2 | n/a | n/a | n/a | 3 | 3 | **2** | 11 failing unit tests, full-proof gate cannot run end-to-end. |

**Average across modules: 2.4 / 5.**

---
## 6. Critical Findings

### EE-QA-001 — Missing `AlertCircle` import breaks the TypeScript build

- **Category:** Build / Runtime
- **Severity:** Critical
- **Confidence:** High (reproduced)
- **File(s):** `client/src/components/POGenerator.tsx`
- **Code reference:** lines 11-16 (lucide-react import block) and line 344 (use site)
- **What is wrong:** `<AlertCircle className="h-3.5 w-3.5" />` is used at line 344 but `AlertCircle` is not in the lucide-react import list (lines 11-16). The import has a stray blank first line (line 12 is empty inside the destructuring) suggesting an icon was deleted without re-adding `AlertCircle`.
- **Why it matters:** `npm run check` fails with `error TS2304: Cannot find name 'AlertCircle'`. The build cannot complete. CI is red. Production deploys are blocked.
- **Business impact:** No release can ship until this is fixed. One-line fix.
- **Root cause:** A previous edit removed icons from the import block but not the use sites.
- **Recommended fix:** Add `AlertCircle` to the lucide-react import inside `POGenerator.tsx`.
- **Suggested test:** `npm run check:client` returns 0 errors.
- **Fix type:** Quick fix (1 line)
- **Delivery bucket:** Must fix before frontend testing

### EE-QA-002 — Three analytics endpoints fabricate finance numbers in memory

- **Category:** Finance / Trust
- **Severity:** Critical
- **Confidence:** High (read in source)
- **File(s):** `server/analytics-routes.ts`
- **Code reference:** lines 24-37 (`/api/analytics/trends`), 40-58 (`/api/analytics/budget-waterfall`), 67-76 (`/api/analytics/velocity`)
- **What is wrong:**
  - `/api/analytics/trends` returns `Array.from({ length: 12 }).map((_, i) => …)` with hardcoded arithmetic — the data is invented in memory, not read from any table.
  - `/api/analytics/budget-waterfall` reads only `total_project_value`, then computes `approvedChanges = budget * 0.08`, `actual = budget * 0.74`, and a derived `remaining`. Those are not real numbers — they are fixed multipliers of the project value.
  - `/api/analytics/velocity` returns `Array.from({ length: 12 }).map((_, i) => ({ week, completed: 8 + ((i + teamId) % 6) * 2 }))` — a deterministic pattern dressed as "velocity".
- **Why it matters:** A finance / leadership user looking at "Approved Changes" or "Actuals" or "Velocity" widgets is being lied to. There is no on-screen indicator that the values are synthetic. The CODEX_FINDINGS.md file already flagged this.
- **Business impact:** Any decision made from these widgets is unsound. A single noticed instance ("why does my $1M project show $80k of approved changes I never approved?") destroys trust in the entire app.
- **Root cause:** Endpoints scaffolded as placeholders, never replaced with canonical reads.
- **Recommended fix:** Either:
  1. Remove the endpoints and the components that consume them.
  2. Replace the math with real reads from `normalizedCostLines` (`isNull(effectiveTo)` guarded), `change_orders` if present, etc.
  3. At minimum, gate the response behind `?demo=true` and add a visible "Demo data" badge in every consuming component.
- **Suggested test:** Add `qa/tests/unit/analytics-routes-trust.test.ts` that asserts `/api/analytics/trends`, `/api/analytics/budget-waterfall`, `/api/analytics/velocity` either don't exist or reach a canonical repository.
- **Fix type:** Structural (real data wiring) or Quick (delete)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-003 — Migration journal drift: 0050 SQL files exist but are not registered

- **Category:** Migrations / Data
- **Severity:** Critical
- **Confidence:** High (`npm run db:check` reproduces)
- **File(s):** `migrations/0050_qb_invoice_links_allocations.sql`, `migrations/0050_qb_invoice_links_allocations_rollback.sql`, `migrations/meta/_journal.json`
- **Code reference:** N/A — schema artefact mismatch
- **What is wrong:** Both SQL files are on disk; neither is registered in the journal. Drizzle considers a migration "applied" only if it is in the journal. Failing test in `qa/tests/unit/document-management-v2-schema.test.ts:247`.
- **Why it matters:** The schema-drift CI guard fails. On a fresh DB, neither file will be applied. On an existing DB that already had `0050` applied, the journal will be inconsistent with reality.
- **Business impact:** A deploy could silently leave the QB allocations changes unapplied, or worse, partially applied if both `up` and `rollback` are processed.
- **Root cause:** Journal not regenerated after manual SQL was added.
- **Recommended fix:**
  1. Decide which of the two files is the canonical migration (the rollback should NOT live in `/migrations/`, it should live in `/migrations/archive/` or a `rollback/` subdirectory).
  2. Run `npm run db:generate -- --name=qb_invoice_links_allocations` to regenerate the journal entry.
- **Suggested test:** `npm run db:check` exits 0.
- **Fix type:** Quick fix
- **Delivery bucket:** Must fix before frontend testing (CI will not pass otherwise)

### EE-QA-004 — Three new routes registered without permission middleware

- **Category:** Permissions / Security
- **Severity:** Critical (in the trust sense — exposed surface)
- **Confidence:** High (CI test names them)
- **File(s):** `server/analytics-routes.ts`, `server/ms-sync-routes.ts`, `server/routes/ops-dashboard.routes.ts`
- **Code reference:**
  - `server/analytics-routes.ts:62` — `POST /api/analytics/nav-event` (only `requireAuth`).
  - `server/ms-sync-routes.ts` — `GET /api/entity-assignments/bulk`.
  - `server/routes/ops-dashboard.routes.ts` — `GET /api/ops-dashboard`.
- **What is wrong:** `qa/tests/unit/route-permission-coverage.test.ts` is the CI guard. It explicitly fails on these three routes as "NEW unguarded route declarations".
- **Why it matters:** Any authenticated user can hit these endpoints regardless of role. `nav-event` is a no-op (low risk). `entity-assignments/bulk` and `ops-dashboard` may leak cross-project data.
- **Business impact:** Permission model is now porous. A pilot user (e.g. Engineer) might see ops/finance data they should not see.
- **Root cause:** Routes added without the `requirePermission(...)` chain or the explicit `// permission-skip:` comment.
- **Recommended fix:** Either add `requirePermission(<entity>, <action>)` to each handler chain, or add `// permission-skip: <reason>` if intentionally public, then run `npx tsx scripts/permissions/build-route-coverage-baseline.ts` to refresh the baseline.
- **Suggested test:** `npm run test` passes the `route-permission-coverage` test.
- **Fix type:** Quick fix
- **Delivery bucket:** Must fix before frontend testing

### EE-QA-005 — `isAdmin` reads from `localStorage.company_role`

- **Category:** Permissions / Trust
- **Severity:** High
- **Confidence:** High (read in source)
- **File(s):** `client/src/hooks/use-auth.tsx`, `client/src/lib/access-control.ts`, `client/src/App.tsx`
- **Code reference:**
  - `client/src/hooks/use-auth.tsx:122` — `isAdmin: isSuperAdmin(user?.role, localStorage.getItem("company_role"))`.
  - `client/src/App.tsx:47, 119` — `localStorage.getItem("company_role")`.
- **What is wrong:** The frontend `isAdmin` flag is computed by reading a localStorage key that the same hook writes from the server response on login. There is no integrity check; if the server's permission map drifts (e.g. the user is downgraded but they have not re-logged in), the UI will keep showing admin controls.
- **Why it matters:**
  1. Security defence-in-depth — a tampered localStorage value will surface admin UI (which is harmless if the backend rejects, but confusing).
  2. More importantly: stale `company_role` after a role change leaves an inconsistent UX.
- **Business impact:** UI shows admin actions a user cannot complete; backend rejection looks like a bug rather than a policy denial.
- **Root cause:** Legacy pattern from before `useAccessMatrix()` and `<PermissionGate>` were introduced.
- **Recommended fix:**
  1. Compute `isAdmin` from the server-supplied permissions snapshot only (the access-matrix already has it).
  2. Treat `localStorage.company_role` as a UI hint (badges, role-aware copy) and never as an authority.
- **Suggested test:** Vitest unit test that mocks `useAccessMatrix` in three states (loading, downgraded, admin) and asserts `isAdmin` follows the matrix, not localStorage.
- **Fix type:** Structural (small)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-006 — QuickBooks contract tests broken: vendor-mapping upsert + financials:edit gate

- **Category:** Finance / Permissions
- **Severity:** High
- **Confidence:** High (failing tests)
- **File(s):**
  - `server/quickbooks-routes.ts` (link routes — `app.delete("/api/quickbooks/links/:id", …)` and friends).
  - `server/routes/quickbooks-invoice-matches.routes.ts` (approve handler — should call `upsertVendorMapping`, check `wasLocked` / `mapping_locked`, and only upsert when `body.mapVendor` and `chosen.qbCounterpartyId` are both set).
- **Code reference:**
  - `qa/tests/unit/quickbooks-route-hardening.test.ts:103` — expected `app.delete("/api/quickbooks/links/:id", requireAuth, requirePermission("financials","edit")…)`; not present.
  - `qa/tests/unit/quickbooks-invoice-match-routes.test.ts` — three failures: `upsertVendorMapping` not imported, `vmResult.wasLocked` / `mapping_locked` not checked, `body.mapVendor` / `chosen.qbCounterpartyId` not gated.
- **What is wrong:** The current source files do not contain the symbols/strings the contract tests pin. Either the route definitions were re-written and lost the guards, or the tests were left intact while the implementation was rewritten.
- **Why it matters:** Finance users with `view`-level permissions could delete QB links and create cross-counterparty mappings; vendor lock (a deliberate guardrail) is bypassed.
- **Business impact:** Finance trust collapse. QB allocations could be reassigned without an audit trail.
- **Root cause:** Implementation drift on a refactor that was not paired with the failing test fix.
- **Recommended fix:**
  1. Restore `requireAuth, requirePermission("financials","edit")` on POST/DELETE `/api/quickbooks/links/*`.
  2. Restore `upsertVendorMapping` import and call in the approve handler, gated by `body.mapVendor && chosen.qbCounterpartyId`, with `vmResult.wasLocked` short-circuiting to a `mapping_locked` response.
- **Suggested test:** Existing failing tests serve as the acceptance criteria.
- **Fix type:** Quick fix (restore lost code)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-007 — Snapshot guard missing on QB invoice-match point lookups

- **Category:** Finance / Data
- **Severity:** High (low per-event probability, high blast radius)
- **Confidence:** Medium (guards may exist in upstream resolvers — to confirm)
- **File(s):** `server/routes/quickbooks-invoice-matches.routes.ts`
- **Code reference:** lines 1046, 1053, 1093, 1105, 1547, 1559, 1828, 1836, 2152, 2159
- **What is wrong:** Ten `SELECT … WHERE id = ?` lookups against `normalizedCostLines` / `normalizedRevenueLines` resolve `projectId` for QB link creation but do not include `isNull(effectiveTo)`. The same file uses the guard at line 2140 — the convention is established and these ten are the outliers.
- **Why it matters:** If a Smart Import re-snapshot fires between the suggestion-fetch and the user clicking "Confirm", the row id may still resolve, but to a stale snapshot whose `projectId` could now be different. The QB link will silently bind to the wrong project.
- **Business impact:** QB actuals attributed to the wrong project; cashflow / COS / revenue numbers shift; reconciliation breaks.
- **Root cause:** Convention not consistently applied during the Task #142 expansion.
- **Recommended fix:** Add `isNull(table.effectiveTo)` to each of the ten WHERE clauses.
- **Suggested test:** Vitest snapshot guard test in `qa/tests/unit/`, similar to existing finance-trust audits, asserting every read in `quickbooks-invoice-matches.routes.ts` includes the guard.
- **Fix type:** Quick fix (10 edits)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-008 — `/api/search` reads snapshot tables without guards

- **Category:** Finance / Data / UX
- **Severity:** High
- **Confidence:** High (read in source)
- **File(s):** `server/routes/misc-extracted-routes.ts`
- **Code reference:** lines 45-64
- **What is wrong:** Universal search runs raw SQL against `normalized_cost_lines` and `normalized_revenue_lines` filtering only on text fields (`description`, `counterparty_name`, `cost_category`, `invoice_number`, `po_number`, `milestone_name`). No `effective_to IS NULL`, no `deleted_at IS NULL`.
- **Why it matters:** Every Smart Import re-import creates a new snapshot row; the previous row is set with `effective_to = now()`. Search will now return all generations of the same line. Users see duplicates and stale rows. Click-throughs to soft-closed rows lead to "this record cannot be edited" UX.
- **Business impact:** Search is the most-used surface in the app; if it shows duplicates and stale data, users lose confidence in everything else.
- **Root cause:** The route was extracted without the snapshot convention.
- **Recommended fix:** Add `AND effective_to IS NULL AND deleted_at IS NULL` (or equivalent) to both SELECTs in this handler.
- **Suggested test:** API test that imports a fixture, re-imports it, and asserts the search result count for a line description equals 1, not 2.
- **Fix type:** Quick fix
- **Delivery bucket:** Must fix before frontend testing

### EE-QA-009 — Finance secondary nav lost PO / payment-request / payment-batch

- **Category:** Navigation / Workflow
- **Severity:** High
- **Confidence:** High (failing tests with explicit expectations)
- **File(s):** `client/src/config/app-navigation.ts` (or wherever the Finance section secondary list is built), `client/src/config/page-registry.ts`
- **Code reference:** `qa/tests/unit/nav-cleanup-validation.test.ts:181-195, 608-615` expects `/po-approval-board`, `/payment-request-board`, `/payment-batch-manager` in the Finance secondary; current state contains only 9 paths and the three above are missing.
- **What is wrong:** The Finance section's secondary navigation does not surface PO approval, payment-request board, or payment-batch manager.
- **Why it matters:** These are core finance workflows. A CFO / Program Finance Manager / Accountant cannot reach them via nav and must rely on direct URLs.
- **Business impact:** Finance throughput drops; PO approvals stall; payment runs miss.
- **Root cause:** Either the IA was changed deliberately (and the test was not updated) or the routes were dropped from a config file accidentally.
- **Recommended fix:** Decide IA with the Program Finance Manager and CFO. If they are kept, restore the page-registry `navGroup: "FINANCE"` or section-config entries. If they are moved, update the test.
- **Suggested test:** Existing `nav-cleanup-validation.test.ts` is the acceptance contract.
- **Fix type:** Decision + Quick fix
- **Delivery bucket:** Must fix before pilot use

### EE-QA-010 — CEO/COO landing pages diverge from the contract test

- **Category:** Navigation / Routing
- **Severity:** High
- **Confidence:** High (failing test)
- **File(s):** `client/src/config/page-registry.ts`
- **Code reference:** `ceoHome` (`/ceo`) and `cooHome` (`/coo`) entries declare `roleLandingEligibility: ["CEO_ADMIN"]` / `["COO_ADMIN"]`. Test `qa/tests/unit/navigation-safety-cleanup.test.ts:25` expects landing path `/execution-board`.
- **What is wrong:** The test expects executives to land on the canonical execution board; the registry routes them to role-specific dashboards.
- **Why it matters:** If `/ceo` and `/coo` show different KPIs from `/execution-board`, the leadership view diverges from the program view. Reconciliation conversations get hard.
- **Business impact:** Leadership numbers may not match middle-management numbers. Hard to debug when spotted.
- **Root cause:** Either an intentional UX choice that lost test alignment, or a regression.
- **Recommended fix:** Confirm with leadership which surface is canonical. Align both sides.
- **Suggested test:** Existing failing test.
- **Fix type:** Decision + Quick fix
- **Delivery bucket:** Must fix before pilot use

### EE-QA-011 — Repository pattern breach: 46 routes do `db.*` directly

- **Category:** Maintainability / Data Trust
- **Severity:** High
- **Confidence:** High (lint enforces)
- **File(s):** `server/routes/quickbooks-invoice-matches.routes.ts` (the bulk; 40+ sites), `server/routes/finance-legacy-extracted-routes.ts`, `server/routes/dashboard-routes.ts`, `server/routes/exception-dashboard.routes.ts`, `server/routes/imports-admin-extracted-routes.ts`, `server/routes/planning-extracted-routes.ts`, `server/routes/project-info-extracted-routes.ts`, `server/routes/support-extracted-routes.ts`, `server/departments/{admin,finance,financial-integration,fye-revenue-tracking,project}-routes.ts`, `server/report-routes.ts`.
- **Code reference:** Run `npm run lint`; each error names line and rule (`no-restricted-syntax`).
- **What is wrong:** Routes call `db.select() / db.insert() / db.update() / db.delete()` inline. CLAUDE.md and the lint rule both forbid this; CRUD is supposed to live in `server/repositories/*`.
- **Why it matters:** Business rules (snapshot guards, RAG status normalisation, CSV-encoded status maps, etc.) get duplicated and drift. EE-QA-007 and EE-QA-008 are direct symptoms of this pattern.
- **Business impact:** Finance numbers risk drift. Bug fixes done in repositories never reach routes that re-implement the query.
- **Root cause:** Many routes were extracted from `routes.ts` without first being lifted into the repository layer.
- **Recommended fix:** Track as a structural workstream. For each file, add a paired `*-repository.ts` and move `db.*` calls into it. Do not silence the lint rule.
- **Suggested test:** Lint already enforces — `npm run lint` must reach 0 errors.
- **Fix type:** Structural
- **Delivery bucket:** Must fix before company rollout

### EE-QA-012 — KPI traceability advertises endpoints that do not exist

- **Category:** Backend / Trust
- **Severity:** High
- **Confidence:** High (CODEX_FINDINGS.md confirms; grep confirms)
- **File(s):** `server/kpi-traceability-routes.ts`
- **Code reference:** lines 28-35 reference `apiEndpoint: "/api/revenue-summary"` (no matching route registered in the codebase) and `/api/engineering-standup`.
- **What is wrong:** The KPI Traceability page tells the user "this number comes from `/api/revenue-summary`". That endpoint does not exist. The user's "where does this number come from" question gets a dead link.
- **Why it matters:** The KPI traceability surface exists *specifically* to build trust by showing provenance. A broken provenance string is worse than no provenance string.
- **Business impact:** The trust feature backfires. CFO / Accountant who clicks through and sees a 404 starts mistrusting all the numbers.
- **Root cause:** Registry strings hardcoded; routes never built.
- **Recommended fix:** Either implement `/api/revenue-summary` and `/api/engineering-standup` (and back them by canonical readers with `effectiveTo IS NULL`), or update the registry to point to existing endpoints (`/api/program-dashboard`, `/api/portfolio-dashboard`).
- **Suggested test:** Vitest unit test that asserts every `apiEndpoint` declared in the KPI traceability registry is a registered express route.
- **Fix type:** Structural (route work) or Quick (string fix)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-013 — 11 unit tests failing on the current branch

- **Category:** Quality / Tests
- **Severity:** High
- **Confidence:** High (reproduced)
- **File(s):**
  - `qa/tests/unit/document-management-v2-schema.test.ts` (1 — see EE-QA-003)
  - `qa/tests/unit/nav-cleanup-validation.test.ts` (4 — see EE-QA-009)
  - `qa/tests/unit/navigation-safety-cleanup.test.ts` (1 — see EE-QA-010)
  - `qa/tests/unit/quickbooks-invoice-match-routes.test.ts` (3 — see EE-QA-006)
  - `qa/tests/unit/quickbooks-route-hardening.test.ts` (1 — see EE-QA-006)
  - `qa/tests/unit/route-permission-coverage.test.ts` (1 — see EE-QA-004)
- **Why it matters:** PR check workflow runs unit tests; this branch cannot merge.
- **Business impact:** Release pipeline blocked.
- **Recommended fix:** Close EE-QA-003/004/006/009/010 and the 11 failures resolve.
- **Suggested test:** N/A — these are tests.
- **Fix type:** Quick (composite of above)
- **Delivery bucket:** Must fix before frontend testing

### EE-QA-014 — `/dashboard` redirects to `/gates`

- **Category:** Navigation / UX
- **Severity:** High (trust)
- **Confidence:** High
- **File(s):** `client/src/config/page-registry.ts`
- **Code reference:** `LEGACY_REDIRECTS` line 1: `{ path: "/dashboard", redirectTo: "/gates" }`.
- **What is wrong:** Bookmarked `/dashboard` no longer leads to a dashboard surface; it leads to gates.
- **Why it matters:** Every email link, every browser bookmark, every internal doc that says "go to /dashboard" lands on the wrong page. The user's mental model breaks.
- **Business impact:** Onboarding friction; a new user is told to "open the dashboard" and ends up on gates.
- **Root cause:** Legacy redirect introduced when the program dashboard moved.
- **Recommended fix:** Either re-introduce a top-level `/dashboard` page that aggregates the program dashboard view, or rename the page label everywhere from "Dashboard" to "Gates" / "Program Health".
- **Suggested test:** Manual nav check.
- **Fix type:** Decision + Quick fix
- **Delivery bucket:** Must fix before pilot use

### EE-QA-015 — Several route / page files exceed 3,000 LOC

- **Category:** Maintainability
- **Severity:** High (long-term)
- **Confidence:** High
- **File(s):**
  - `server/departments/finance-routes.ts` — 7,879 LOC
  - `server/engineering-routes.ts` — 3,684 LOC
  - `server/smart-import-routes.ts` — 3,656 LOC
  - `server/routes/quickbooks-invoice-matches.routes.ts` — 2,972 LOC
  - `server/quality-routes.ts` — 2,692 LOC
  - `server/services/quickbooks-reconciliation-service.ts` — 2,504 LOC
  - `server/lifecycle-routes.ts` — 2,406 LOC
  - `client/src/pages/EngineeringTasksPage.tsx` — 4,869 LOC
  - `client/src/pages/smart-import.tsx` — 4,625 LOC
  - `client/src/pages/projects.tsx` — 2,813 LOC
- **What is wrong:** Files this size are unreviewable and untestable in any pragmatic sense.
- **Why it matters:** Defects hide. New engineers cannot navigate. Test coverage cannot reach the inner branches. Merge conflicts dominate.
- **Business impact:** Velocity drops; regression risk per PR rises sharply.
- **Recommended fix:** Freeze additions to these files. Plan a per-domain split (e.g. finance-routes → cashflow-routes, cos-routes, revenue-routes, gp-routes). Track as a named workstream with acceptance criteria "each file < 1,500 LOC".
- **Suggested test:** A "max-file-size" lint rule (`max-lines: 1500`) added with a baseline allowlist; new files cannot exceed.
- **Fix type:** Structural
- **Delivery bucket:** Must fix before company rollout

### EE-QA-016 — Mock connectors switch silently with no UI banner

- **Category:** Integrations / Trust
- **Severity:** High (in pilot context)
- **Confidence:** High
- **File(s):** `server/lib/connector-mode.ts`, `server/mocks/{ms-graph,quickbooks,pipedrive}-fixtures.ts`
- **Code reference:** Decision order in `connector-mode.ts:13-23`. Gate is correctly NODE_ENV-bound. There is no client-visible signal of which connectors are mocked.
- **What is wrong:** A dev or pilot environment without QuickBooks credentials will return fixture data wherever QuickBooks is consulted. The UI does not say "this is a fixture".
- **Why it matters:** A pilot user shown a "QB sync OK — 24 invoices" banner that is actually 24 fixture invoices will trust those numbers.
- **Business impact:** Catastrophic in any demo; merely confusing in dev.
- **Root cause:** UI never wired to the mock-mode probe.
- **Recommended fix:**
  1. Expose a `/api/system/connector-status` endpoint that returns `{ msGraph: "real"|"mock", quickbooks: "real"|"mock", pipedrive: "real"|"mock" }`.
  2. In `<AppLayout>`, render a non-dismissable banner whenever any connector is "mock" in non-prod.
  3. On every QB / SharePoint / Pipedrive list/card, render a "FIXTURE" pill if its connector is mocked.
- **Suggested test:** API test asserting the endpoint returns the gate's verdict; component test asserting the banner appears when any mock is true.
- **Fix type:** Quick (small endpoint + UI banner)
- **Delivery bucket:** Must fix before pilot use

### EE-QA-017 — Legacy Excel parser still in tree

- **Category:** Smart Import / Data Trust
- **Severity:** High
- **Confidence:** Medium (depends on call sites)
- **File(s):** `server/excelParser.ts`, `server/importPipeline.ts`
- **Code reference:** Imported by `server/seed-ee-info-updates.ts` (1,819 LOC), `server/storage.ts` (1,728 LOC), and other modules per grep on `ProgramExpense` / `ProgramInflows`. CLAUDE.md marks these as legacy.
- **What is wrong:** Two import strategies coexist: the documented Smart Import v2 under `server/imports/`, and the legacy `excelParser` / `importPipeline` modules. Any caller that still routes through legacy will not see the v2 hash-based line IDs, override audit, or scenario tracking.
- **Why it matters:** Imports are the single biggest data-trust surface in the app.
- **Business impact:** A finance user who runs an import via a legacy code path will lose hash-based identity preservation and the override audit trail. Numbers will look right but provenance will be broken.
- **Root cause:** Migration to v2 not finished.
- **Recommended fix:** Audit every import of `excelParser.ts` / `importPipeline.ts`; route or delete each. After 0 callers remain, delete the files.
- **Suggested test:** Lint rule `no-restricted-imports` for `server/excelParser.ts` and `server/importPipeline.ts` outside of `qa/`.
- **Fix type:** Structural
- **Delivery bucket:** Must fix before company rollout

### EE-QA-018 — Empty `auth.routes.ts` stub alongside real `auth-routes.ts`

- **Category:** Maintainability / Naming
- **Severity:** Medium
- **Confidence:** High
- **File(s):** `server/routes/auth.routes.ts` (5 lines, empty router), `server/routes/auth-routes.ts` (real registrar; imported by `server/routes.ts:13`).
- **What is wrong:** The new `*.routes.ts` pattern is the documented convention, but `auth.routes.ts` is empty and `auth-routes.ts` is the legacy hyphen pattern. New devs editing the wrong file fix nothing.
- **Why it matters:** Pattern inconsistency; risk of edits in the wrong file.
- **Recommended fix:** Either delete `auth.routes.ts` or rename `auth-routes.ts` to `auth.routes.ts` and update the import.
- **Suggested test:** N/A — file existence.
- **Fix type:** Quick fix
- **Delivery bucket:** Can defer

### EE-QA-019 — `RoleGuard` falls open when `/api/auth/permissions` errors

- **Category:** Permissions / UX
- **Severity:** Medium
- **Confidence:** High
- **File(s):** `client/src/App.tsx`
- **Code reference:** lines 122-138. Comment: "If the matrix query failed entirely the hook returns `loading=false` with no permissions snapshot. We still render the children so the page-level error/empty handling can kick in instead of leaving a blank screen indefinitely."
- **What is wrong:** When the permissions service is unavailable, `RoleGuard` renders the page anyway. Most pages do not have explicit error handling for "no permissions yet" — they assume the matrix is present.
- **Why it matters:** Pages will silently render with empty permission data; UI may show actions that fail at the backend; the user sees inconsistent state with no clear remediation.
- **Recommended fix:** When the matrix query errors, render a single bordered "Permission service unavailable — retry" component instead of children.
- **Suggested test:** Vitest test that simulates the matrix query throwing; assert the retry banner is rendered, not the page.
- **Fix type:** Quick fix
- **Delivery bucket:** Must fix before pilot use

### EE-QA-020 — Fresh-clone `npm run check` requires `npm install` first

- **Category:** Build / Tooling
- **Severity:** Medium
- **Confidence:** High
- **File(s):** `tsconfig.check.json`, `README.md`
- **What is wrong:** A fresh clone without `node_modules` fails `npm run check` with `error TS2688: Cannot find type definition file for 'node'`. README does not state the install step.
- **Recommended fix:** Add a one-line "Install: `npm ci`" to `README.md`. Confirm CI runs `npm ci` before any check.
- **Fix type:** Quick fix
- **Delivery bucket:** Can defer

---
## 7. Full Issue Register

| ID | Category | Severity | Confidence | Area | File | Issue | Business Impact | Recommended Fix | Priority | Delivery Bucket |
|---|---|---|---|---|---|---|---|---|---|---|
| EE-QA-001 | Build | Critical | High | Build | `client/src/components/POGenerator.tsx:344` | Missing `AlertCircle` import | Build red | Add import | P0 | Before frontend testing |
| EE-QA-002 | Finance | Critical | High | Analytics | `server/analytics-routes.ts:24-77` | Three endpoints fabricate numbers | Trust collapse | Replace with real reads or delete | P0 | Before pilot |
| EE-QA-003 | Migration | Critical | High | DB | `migrations/0050_*` | Journal drift | Deploy risk | Regenerate journal | P0 | Before frontend testing |
| EE-QA-004 | Permissions | Critical | High | Routes | `analytics`, `ms-sync`, `ops-dashboard` | 3 ungated routes | Data leak | Add `requirePermission` | P0 | Before frontend testing |
| EE-QA-005 | Permissions | High | High | Frontend | `use-auth.tsx:122` | `isAdmin` reads localStorage | Stale role UI | Drive from server matrix | P1 | Before pilot |
| EE-QA-006 | Finance | High | High | QB | `quickbooks-*.routes.ts` | Vendor-mapping + permission gate regressed | Finance bypass | Restore guards | P0 | Before pilot |
| EE-QA-007 | Finance | High | Medium | QB | `quickbooks-invoice-matches.routes.ts:1046, 1053, 1093, 1105, 1547, 1559, 1828, 1836, 2152, 2159` | 10 missing snapshot guards | Mis-attributed actuals | Add `isNull(effectiveTo)` | P1 | Before pilot |
| EE-QA-008 | Finance | High | High | Search | `misc-extracted-routes.ts:45-64` | `/api/search` no snapshot guard | Stale dupes in search | Add filter | P0 | Before frontend testing |
| EE-QA-009 | Navigation | High | High | Finance | nav config | PO/payment paths missing from Finance nav | Workflow blocked | Restore or update IA contract | P0 | Before pilot |
| EE-QA-010 | Navigation | High | High | Routing | `page-registry.ts` | CEO/COO landing diverges from contract | Leadership KPI mismatch | Decide canonical surface | P1 | Before pilot |
| EE-QA-011 | Maintainability | High | High | Routes | many | 46 routes do `db.*` directly | Drift risk | Move to repos | P2 | Before company rollout |
| EE-QA-012 | Backend | High | High | KPI | `kpi-traceability-routes.ts:28-35` | Dead endpoints in registry | Trust feature backfires | Implement or relabel | P1 | Before pilot |
| EE-QA-013 | Tests | High | High | QA | unit tests | 11 failures | CI red | Close root causes above | P0 | Before frontend testing |
| EE-QA-014 | Navigation | High | High | UX | `page-registry.ts` redirects | `/dashboard` → `/gates` | Bookmarks break | Decide naming | P1 | Before pilot |
| EE-QA-015 | Maintainability | High | High | Code | many | Files > 3,000 LOC | Velocity / regression risk | Per-domain split workstream | P2 | Before company rollout |
| EE-QA-016 | Integration | High | High | UI | `<AppLayout>` | No fixture-mode banner | Demo lies | Add banner + endpoint | P1 | Before pilot |
| EE-QA-017 | Smart Import | High | Medium | Import | `excelParser.ts`, `importPipeline.ts` | Legacy parser still imported | Provenance breaks | Audit + delete | P2 | Before company rollout |
| EE-QA-018 | Naming | Medium | High | Routes | `server/routes/auth.routes.ts` | Empty stub | Confusion | Delete | P3 | Defer |
| EE-QA-019 | Permissions | Medium | High | UX | `App.tsx:128-138` | RoleGuard fails open on matrix error | Inconsistent UI | Render retry banner | P1 | Before pilot |
| EE-QA-020 | Tooling | Medium | High | Docs | `README.md` | Install step undocumented | Onboarding | Document `npm ci` | P3 | Defer |
| EE-QA-021 | UX | Medium | Medium | Forms | many | Save/error feedback inconsistent | Confusion | Audit toast usage | P2 | Before company rollout |
| EE-QA-022 | UX | Medium | Medium | Tables | many | Source-of-data not labelled | Confusion | Add data-source chip | P2 | Before pilot |
| EE-QA-023 | Code Hygiene | Low | High | Lint | many | 11,366 lint warnings (mostly `any`) | Type-safety drift | Track baseline + ratchet down | P3 | Defer |
| EE-QA-024 | DB | Medium | Medium | Schema | `shared/schema/finance.ts:39-167` | `ProgramExpense` / `ProgramInflows` retained as legacy types | Confusion | Renaming pass after PE/PI callers retire | P3 | Before company rollout |
| EE-QA-025 | UX | Medium | Medium | Empty states | many | Empty states vary in wording / next-step CTA | Onboarding friction | Empty-state component pass | P3 | Defer |

---

## 8. Frontend / UX Trust Assessment

**Navigation**
- Wired through `client/src/config/page-registry.ts` (canonical, declarative). Each entry carries `permissionEntity`, `navGroup`, `roleLandingEligibility`, `aliases`, `accessPolicy`. This is a strong foundation.
- `LEGACY_REDIRECTS` (40+ entries) redirect old bookmarks to current paths. The breadth of this list is itself a signal that IA has churned recently.
- Issues: `/dashboard → /gates` (EE-QA-014), Finance secondary missing PO / payment-batch / payment-request (EE-QA-009), CEO/COO landing differs from contract (EE-QA-010).
- The `RoleGuard` waits for `useAccessMatrix()` to resolve before showing "Access Denied" — good; eliminates a real flash on initial load.

**Role-lens views**
- `<PermissionGate entity action>` and `usePermission()` ride the same evaluator the server uses. This is the right architecture.
- BUT: `client/src/App.tsx:47, 119` reads `localStorage.getItem("company_role")` to determine the home path, and `use-auth.tsx:122` derives `isAdmin` from it (EE-QA-005). The matrix is the source of truth for action-level checks; legacy hardcoded role-name checks bypass it.

**Forms**
- Pattern: React Hook Form + Zod resolvers. Consistent.
- Save/error feedback is inconsistent — some flows (`TrackerGapTab.tsx`) use `useToast()` with `variant: "destructive"` on failure; others have only console-error logging. There is no app-wide audit of "every mutation has a user-visible failure path". Treat as EE-QA-021.

**Tables**
- shadcn/ui `<Table>` is the base. Several tables (the QB matching workbench, COS month details, expenditure breakdowns) are dense.
- Source-of-data labelling is inconsistent. The QB workbench shows `bulk(N)` and `+N` siblings — good. But COS / cashflow tables generally do not visually distinguish "imported from Excel", "QB-confirmed", "manually overridden", "auto-promoted" (EE-QA-022). The data IS there in the schema (`row_source` enum, override columns) but the UI doesn't always surface it.

**Dashboards**
- The Company Overview dashboard pulls from canonical sources per `replit.md`. Good shape.
- Analytics widgets (EE-QA-002) are fabricated. Trust hazard.
- KPI Traceability advertises endpoints that do not exist (EE-QA-012). The "trust this number" feature does not reach its own data.

**Buttons / actions**
- Buttons rendered through `<PermissionGate>` are correctly hidden.
- Actions still gated only by `localStorage.company_role` checks (e.g. several places under `client/src/pages/` and `client/src/components/`) leak admin UI to non-admin users until the backend rejects.

**Loading states**
- Suspense fallback in `App.tsx` uses `<LoadingState variant="skeleton-card"/>` — good.
- React Query usage seems consistent (queryKey patterns, invalidation patterns).
- Risk: optimistic updates in `client/src/pages/cos.tsx` (lines 727-759) call `cancelQueries`, snapshot, mutate, rollback on error — pattern is correct.

**Error states**
- `<QueryErrorBanner>` and `<ErrorBoundary>` exist; usage is patchy. The `RoleGuard` fall-open on permissions error (EE-QA-019) is the one that matters most.

**Empty states**
- Wording and next-step CTAs vary across pages (EE-QA-025).

**User feedback after save/update/delete**
- Toast is the standard but adoption is inconsistent (see EE-QA-021).

**Misleading or half-built UI**
- Analytics widgets (EE-QA-002).
- KPI traceability dead endpoints (EE-QA-012).
- Mock connector silent fixtures (EE-QA-016).

**Frontend testing readiness**
- Build does not compile (EE-QA-001) — testing readiness is 0 until that lands.
- Once compiling, a smoke pass is feasible per role; the page-registry permission map gives a strong test plan basis (every `permissionEntity` × every role).

---

## 9. Backend API Assessment

**Route consistency**
- New convention: `server/routes/*.routes.ts`. Legacy: `server/*-routes.ts`. ~37 new + ~57 legacy + ~42 hyphen pattern within `routes/`. Pattern is mid-migration; `scripts/check-routes-migration.ts` reports `routes.ts` reduced 99.6%.
- Empty stub `auth.routes.ts` (EE-QA-018).
- Duplicate route registrations: `scripts/check-duplicate-routes.ts` reports 0 — good.
- The legacy `/api/dashboard` is intentionally absorbed by `server/departments/project-routes.ts:1848` and the new `dashboard-routes.ts` notes "first one wins by registration order" — fragile pattern, but documented.

**Payload consistency**
- ZAR currency handling: amounts are typed as numbers in `NormalizedCostLine.amountExVat` etc. Drizzle decimal columns; not exhaustively verified.
- Date handling: payment date for cashflow (`paidDate`), invoice date for COS recognition window — convention matches business rule. Not exhaustively verified.

**Validation**
- `validateBody` middleware exists; usage is widespread on the new routes. Some legacy routes do not validate (verifying which would require a route-by-route grep).

**Error handling**
- `ApiError` class + central handler exist. Lint rule forbids leaking raw `err.message` / `err.stack`. One offender remains in `server/jwt.ts:462` per lint output.

**Status / enum handling**
- Phase model (`shared/phases.ts`) is canonical and exhaustive.
- Status enums (`tr_status`, `tr_rag_status`, `procurement_status`, `invoice_capture_status`, etc.) live in `shared/schema/finance.ts` — single source of truth.
- No drift detected in the static read.

**Date / currency**
- `date-fns` is in deps; no `moment`. Good.
- ZAR is the implicit currency in cashflow / cos / revenue trackers. There is no multi-currency support, which matches the SA-only scope.

**Duplicate logic**
- `server/excelParser.ts` (legacy) vs `server/imports/` (v2) — EE-QA-017.
- `db.*` calls duplicated across routes vs repositories — EE-QA-011.

**Mock / placeholder risks**
- `server/analytics-routes.ts` (EE-QA-002).
- Mock connectors (EE-QA-016).

**Invalid state transitions**
- Pending Approvals queue (`pending_approvals` table + `proposeApproval()`) is documented to intercept writes. Not statically verified that every privileged write actually goes through it.

**Frontend / backend contract mismatches**
- `/api/revenue-summary` and `/api/engineering-standup` advertised in KPI registry but not implemented (EE-QA-012).
- Several frontend-tests pin handler-source strings (vendor-mapping upsert, permission gates) that the source no longer contains — EE-QA-006.

---

## 10. Data Model and Migration Assessment

**Tables**
- 29 schema files in `shared/schema/`. Recent additions: `app-settings`, `pending-approvals`, `template-overrides`, `email-links`, `stage-collaboration`, `dashboard-snapshots`, `task-reminders`, `home`, `mytool`. Healthy domain separation.

**Relationships**
- Foreign keys are declared via Drizzle `.references(...)`. Not exhaustively verified.
- `work_items` is the canonical engineering execution table; `engineering_tickets` is a back-compat mirror (`server/work-items-adapter.ts`). Bidirectional sync is covered by 28 regression tests.

**Enums**
- See §9. Centralised in `shared/schema/finance.ts`.

**Nullable fields**
- `users.location` is nullable (intentional). `users.deletedAt` nullable (soft delete). `users.isActive` boolean default true. Reasonable.
- A full nullable-vs-required audit was not performed.

**Effective-date / snapshot logic**
- Seven snapshot tables enumerated in CLAUDE.md. The convention is honoured in repositories. Misses: 12 sites in `quickbooks-invoice-matches.routes.ts` + `misc-extracted-routes.ts` (EE-QA-007, EE-QA-008). The snapshot-auditor sweep across ~150 read sites is otherwise clean.

**Import / export logic**
- Smart Import v2 stores hash-based line IDs. Override audit trail is separate.
- Legacy `excelParser.ts` / `importPipeline.ts` still in tree (EE-QA-017).

**Audit / history logic**
- `errorLogs` table; `audit_logs` referenced in routes; `priority_activity_log` (migration `0004`); `system-activity-log` page.
- `task_activity_log` exists. Many routes call `logAuditFromReq(...)`.
- An end-to-end audit-coverage map was not produced.

**Data duplication risk**
- `program_expense` / `program_inflows` were physically dropped (`migrations/20260414_drop_program_expense_and_program_inflows.sql`) but the TypeScript interface names remain as adapters — EE-QA-024.

**Migration drift**
- `0050_qb_invoice_links_allocations.sql` + `_rollback.sql` not in journal (EE-QA-003).
- Two duplicate-numbered migrations: `0016_app_screen_settings.sql` and `0016_qb_revenue_recon_tables.sql`; `0032_backfill_work_items_from_engineering_tickets.sql` and `0032_document_management.sql`; `0033_controlled_documents.sql` and `0033_users_location.sql`; `0045_qb_match_suggestions_rejection.sql` and `0049_qb_match_suggestions_rejection.sql`. Drizzle treats journal entries by name, but the duplicate numbering is a red flag for ordering assumptions.
- No further drift visible.

**Seed data risks**
- `seed/` directory + `server/seed-ee-info-updates.ts` (1,819 LOC). Large enough that seed-vs-import collisions are plausible. Verify by importing a fresh tracker into a freshly seeded DB and reconciling totals.

**Source traceability**
- The KPI traceability surface exists; its dead endpoints (EE-QA-012) limit its utility today. The CODEX_FINDINGS.md (already in repo) captures known KPI source-table drifts (e.g. KPI rows still cite `program_expense` though backing reads use `normalized_cost_lines`).

---

## 11. Finance Logic QA

This section is **read-only assessment**. No business logic is being redefined.

**Revenue**
- Source: `normalizedRevenueLines` (snapshot-guarded in repos).
- Read service: `server/services/project-cost-line-read-service.ts` (cost) + `storage.getAllRevenueLinesForCashflow()` (revenue) — both honoured by GP / Revenue Tracker / Dashboard reads.
- Risk: `/api/search` returns historical snapshot copies (EE-QA-008).

**COS**
- Realisation gate: `isCanonicalCosRealised(...)` — central helper consulted by `finance-analysis-repository.ts:818` and the COS auto-promote past-month service.
- Inputs to the helper: `status`, `cosStatusOverride`, `cosRealised`, `expenseInvoiceNumber`, `expenseInvoicedDate`, `expensePoNumber`, `paymentDate`, `today`, `amountExVat`, `invoiceDateFontColor`, `invoiceDateConfirmed`. This matches the business rule "COS only realised when invoice captured under actuals".
- COS Tracker Past-Month Auto-Promote service is referenced in `replit.md`; not verified end-to-end.

**Expenditure / Cost lines**
- Canonical: `normalizedCostLines`. Repo: `finance-expense-engine-repository.ts`. Mapping `expenseInvoicedDate` → `invoiceDate`, `paymentDate*` → `paidDate*`. Snapshot guard present in repo.

**Invoice capture**
- `server/invoice-capture-routes.ts` exists; `client/src/components/finance/DeleteInvoiceDialog.tsx` exists; no dedicated `CaptureInvoiceForm` was found in `client/src/components/finance/` — the capture surface lives elsewhere (likely inside a multi-tab project view). Worth verifying with the Program Finance Manager that the workflow they need is reachable.

**Raise / capture invoice**
- Distinct concepts in the code: "raise" is a future invoice (forecast), "capture" is recording an actual one (realised). Need to confirm in UI labels (worth doing during pilot smoke).

**Raise PO / PO approval**
- `server/po-routes.ts` exists; `/po-approval-board` page exists; missing from Finance nav (EE-QA-009).
- `<POGenerator>` component blocked by EE-QA-001.

**Payment date handling**
- `server/repositories/finance-analysis-repository.ts:824` — cashflow consumes `paymentDate: isoOrNull(c.paidDate)`. Matches "cashflow uses payment dates not invoice dates" rule.

**Cashflow**
- `register-cashflow-2026-routes.ts` is the active routes file. Endpoints: opening balance, available payment, available-payment-history. `requirePermission("cashflow", "view"|"edit")` applied.

**QuickBooks matching**
- Many-to-many invoice/bill ↔ app-line allocations with rand allocation tolerance (`shared/config/qb-allocations.ts`).
- Canonical writer: `confirmLinksWithAllocations()` in `server/services/quickbooks-reconciliation-service.ts`.
- Tolerance breaches throw `QuickBooksAllocationToleranceError` → HTTP 422.
- UI: `client/src/components/quickbooks/QbMatchingWorkbench.tsx` (2,203 LOC) with traffic-light gate. Sound approach.
- Risks: EE-QA-006 (vendor-mapping + permission gate), EE-QA-007 (10 unguarded snapshot reads).

**Excel tracker replica logic**
- `server/routes/tracker-replica.routes.ts` and migration `0042_tracker_replica_columns.sql` / `0043_tracker_stable_ids_and_merge.sql`. Replica pages live at `/projects/:projectId/revenue-tracking`, `/expenditure-breakdown`, `/program-plan`.
- Stable line IDs: `tracker_stable_ids_and_merge` migration.

**Actuals vs forecast**
- Repository code clearly separates `cosPlan` vs `cosActual` vs `cosForecastUnrealised` (`finance-analysis-repository.ts:813-839`). `forecastDate` and `adminOverride` are folded into a `planDateIso` for plan-window checks; `invoiceIso` drives realised actuals.
- UI labelling not exhaustively verified — recommend pilot smoke.

**Deferred vs realised**
- See `isCanonicalCosRealised`. Deferred = forecast window, realised = invoice in window.

**Red flags (e.g. invoice without PO)**
- Captured in `server/lib/finance-trust/integrity-audit.ts` and `exceptions.ts` (raw SQL but snapshot-guarded — confirmed).
- `TrackerGapTab.tsx` is the user-facing surface for unmapped class mappings (toast feedback present).

**Milestone logic**
- `normalizedRevenueLines.milestoneName` exists; revenue allocation reads it.

**Payment receipt logic**
- `payment-batch-manager` and `payment-request-board` pages exist; finance routes wire them. Missing from nav (EE-QA-009).

**Revenue / COS recognition display**
- Recognition mode service: `server/services/recognition-mode-service.ts`.

**Dashboard traceability**
- Aspires to be addressable via `/kpi-traceability`; held back by EE-QA-012.

**Specific checks called out by the brief**

- *Frontend labels match real finance meaning?* — Cannot fully verify without live DB / browser. The repository-side semantics are correct; UI is the residual risk.
- *Backend uses correct source fields?* — Yes, where I have read the code: `paidDate` for cashflow, `invoiceDate` for COS realised. Good.
- *Dates interpreted consistently?* — `isoOrNull(...)` helper centralises parsing; no `::date` casts outside guarded helpers.
- *ZAR values handled consistently?* — Decimal columns; no float arithmetic visible in repos.
- *Forecast vs actual clearly separated?* — In code, yes (separate accumulators). UI separation cannot be fully verified without runtime.
- *Invoice / PO / payment / milestone states traceable?* — Mostly yes; pending approvals queue strengthens this.
- *App can explain where each finance number comes from?* — Aspirationally yes via `/kpi-traceability`; in practice held back by EE-QA-012.
- *Dashboard totals traceable to source rows?* — Same as above.
- *QB-linked values distinguished from app-entered?* — Workbench surfaces `bulk(N)` / `+N` siblings; broader UI-wide indicator is patchy. Recommend a "QB" badge convention.
- *Imported values vs manually changed?* — `row_source` enum (`imported`, `manual`, `imported_edited`) exists. Surfacing in UI is patchy (EE-QA-022). `/projects/:projectId/manual-overrides` page exists.

---
## 12. Workflow and Stage-Gate QA

**Lifecycle stages** (`shared/phases.ts`)
- 10 sequential + 2 terminal:
  1. `S01_FIRST_ASSESSMENT` (PD)
  2. `S02_DESIGN_COST_PROPOSAL` (Engineering)
  3. `S03_SIGNATURE_FINANCIAL_CLOSE` (PD)
  4. `S04_PLANNING` (PM)
  5. `S06_CONSTRUCTION` (PM)
  6. `S07_COMMISSIONING` (Engineering)
  7. `S08_OM_HANDOVER` (PM, isHandover)
  8. `S09_CLIENT_HANDOVER` (PM, isHandover)
  9. `S10_POST_HANDOVER_REVIEW` (PM, isHandover)
  10. `S9B_COMPLIANCE_HANDOVER` (PM, isHandover)
  - Terminal: `S_HOLD`, `S_DONE`.
- `STAGE_CODE_ALIASES` map covers legacy/Excel-style names ("signature & financial close", "pd-pm handover" → S03, "hold" → S_HOLD, "done" → S_DONE etc.). Healthy.
- The brief listed the lifecycle differently — it includes a top-level "Hold" and "Done" plus the 10 sequential. The schema matches. ✅

**Handovers**
- PD → PM: `S03_SIGNATURE_FINANCIAL_CLOSE` is owned by PD; `S04_PLANNING` is owned by PM. Handover surfaces: `/pd-pm-handover-v2`, `/handover/:projectId/live`, `/handover-control`, `/handover-dashboard`, `/pm-handover-review`. `server/handover-routes.ts` provides `/api/pd-pm-handover/{status-map,submitted,control,:projectId}`.
- O&M handover (to Matriarch): `S08_OM_HANDOVER` phase + tasks pattern matching `'handover to matriarch'` in plan rows (`server/routes/planning-tasks-routes.ts:1658`).
- Client handover: `S09_CLIENT_HANDOVER`.
- Compliance handover: `S9B_COMPLIANCE_HANDOVER` — last sequential phase.

**Definitions of done**
- `project_stage_requirements` table + `project_stage_decisions` track gate auto-evidence and decisions. `server/services/gate-auto-evaluator-service.ts` runs deterministic evaluators. Auto-detected statuses persist on `project_stage_requirements.auto_*` and surface when manual is `not_started`.
- Worth verifying: are *all* required gate criteria backed by evaluators, or only some? Cannot tell statically.

**Missing approvals**
- The `pending_approvals` queue (migration `0028_pending_approvals.sql`) intercepts writes via `proposeApproval()`. UI at `/pending-approvals`. Coverage breadth unverified.

**Broken ownership**
- `ownerRole` field on each phase establishes default ownership. Cross-departmental tasks (e.g. SSEG submissions handled by Engineering after PM phase) are surfaced via `/sseg-submissions`.

**Invalid state transitions**
- Frontend: page-registry `permissionEntity` gates *visibility* but not state-transition rules. Stage transitions go through `lifecycle-routes.ts` and `lifecycle-approvals-routes.ts`; not exhaustively verified.
- Backend: gate-auto-evaluator + lifecycle approvals + pending approvals together aim to gate invalid transitions. Cannot confirm tightness without the workflows test (`npm run test:workflows`) which needs a live DB.

**Evidence requirements**
- Evidence snapshots referenced (`evidence-snapshot.ts` in `shared/lib`); `project_stage_requirements.auto_evidence` referenced in migration `0031`.

**PD → PM handover**
- Surfaces present (above). HSE/compliance start *only after* this handover per business rule. Statically: `/hse-dashboard` is permission-gated; cannot verify it is hidden until PD→PM is complete.

**Construction readiness**
- `S04_PLANNING → S06_CONSTRUCTION`. Gate criteria configurable via `project_stage_requirements`. Specifics unverified.

**Commissioning readiness**
- `S07_COMMISSIONING` owned by Engineering. `commissioning-routes.ts` and `commissioning-dashboard-routes.ts` exist. Gate detail not statically verified.

**O&M handover to Matriarch**
- `S08_OM_HANDOVER` (`isHandover: true`). PM-owned. Tasks recognise the literal pattern `'handover to matriarch'` for date extraction. Functional integration with Matriarch (downstream system) appears to be at the conceptual/handover level only — no API integration found.

**Client handover**
- `S09_CLIENT_HANDOVER`. Distinct from O&M handover. ✅

**Compliance handover**
- `S9B_COMPLIANCE_HANDOVER` is the final sequential phase. ✅

**Risk summary for workflow**
- Stage / handover model is mature.
- Gate auto-evaluator coverage breadth is the main unverified risk.
- HSE-only-after-PD→PM cannot be confirmed without runtime; recommend pilot smoke.

---

## 13. Roles and Permissions QA

**Role definitions**
- Authoritative: `shared/schema/users.ts` `COMPANY_ROLES` (16 roles). ✅
- Labels: `COMPANY_ROLE_LABELS`. Admin set: `ADMIN_ROLES = ['COO_ADMIN', 'CEO_ADMIN']`.
- Templates: `shared/permissions/templates.ts` (13 curated). Entity registry: `shared/permissions/registry.ts`.
- Brief mentioned roles `Head of Project Development` — not present as a distinct role; closest match is `CCO` or `KEY_ACCOUNTS_MANAGER`. Worth confirming with the org chart.

**Navigation access**
- Page-registry `permissionEntity` drives `useAccessMatrix().canViewPath()`. Sidebar visibility controlled by `showInSidebar` and `roleLandingEligibility`.

**Page access**
- `RoleGuard` in `App.tsx` enforces. Issues: fall-open on matrix error (EE-QA-019), CEO/COO landing divergence (EE-QA-010).

**Action access**
- `<PermissionGate>` + `usePermission()` for client; `requirePermission()` for server. Aligned via the same evaluator.

**Backend enforcement**
- `requirePermission(entity, action)` middleware. CI guard `qa/tests/unit/route-permission-coverage.test.ts` enforces no new unguarded routes; currently 3 unguarded routes (EE-QA-004).

**Frontend hiding vs backend permission checks**
- Architecture: aligned (same evaluator).
- Drift in practice: legacy `localStorage.company_role` reads (EE-QA-005) and ad-hoc role-name checks throughout (e.g. `/admin-pipedrive`, `/admin-quickbooks`, `/role-settings`, `/dashboard.tsx`, `/lifecycle-board.tsx` all reference `company_role`).

**Mismatches between role-lens and permissions**
- Need a runtime per-role smoke test to enumerate actual mismatches; cannot do statically.

**Admin visibility**
- `/admin/roles` is the canonical admin entry. Many `/admin/*` routes exist; many redirect (`LEGACY_REDIRECTS`).

**Reports visibility**
- `/reports`, `/programme-reports`, `/ceo`, `/coo`, `/company` (Company Overview) — gated by `execution_board` / `pd_dashboard` / role landings.

**Finance visibility**
- `cashflow`, `cos`, `revenue_tracker`, `financials`, `financial_linking`, `excel_vs_app`, `invoice_patterns`, `counterparties`, `subcontractors`. CFO / PROGRAM_FINANCE_MANAGER / ACCOUNTANT have role-landing on `/cashflow`.
- Risk: nav drops (EE-QA-009).

**Engineering visibility**
- `engineering`, `eng_tasks`, `standups`. Role-landing for ENGINEERING_MANAGER / ENGINEER on `/engineering`.

**Quality visibility**
- `quality` entity. Role-landing for QUALITY_MANAGER on `/quality`. NCR detail/list redirect to `/quality`.

**Project management visibility**
- `projects`, `lifecycle`, `stage_lifecycle`, `execution_board`, `work_items`, `weekly_review_wizard`. Role-landing for PROJECT_MANAGER_SITE / PROGRAM_MANAGER / CONSTRUCTION_MANAGER on `/execution-board`.

**Project development visibility**
- `pd_dashboard`, `pd_clients`. Role-landing for CCO / KEY_ACCOUNTS_MANAGER / PROJECT_DEVELOPER on `/pd`.

**Specific checks**
- Navigation matches permissions: mostly. Drops in EE-QA-009.
- Hidden but accessible directly: probably for `/admin/*` legacy paths since redirects funnel to `/admin/roles`. Hard to verify exhaustively without runtime.
- Buttons visible but failing: see EE-QA-005 (admin badges via stale localStorage).
- Permissions hardcoded in multiple places: yes. `localStorage.company_role` reads in 20+ files (see grep output) constitute a parallel permission-check path.
- Permission strings consistent: registry-based (`shared/permissions/registry.ts`) — yes for entities. Risk is that ad-hoc role-name strings live alongside.
- Frontend / backend share source of truth: yes via `useAccessMatrix()` ← server-rendered matrix.

---

## 14. Integration QA

**QuickBooks**
- Sync direction: bi-directional (read invoices/bills, write app-side links + allocations).
- Source of truth: app-side `normalizedCostLines` / `normalizedRevenueLines`. QB invoice/bill is *evidence*; the app row is canonical.
- Duplicate capture risk: many-to-many allocations support partial settlement; over-allocation rejected with HTTP 422; under-allocation allowed as partial.
- Mapping quality: `quickbooks_vendor_mappings` with lock support.
- Reconciliation state: dedicated reconciliation surfaces; `/finance/quickbooks-customer-mapping` / `/finance/quickbooks-links` / `/finance/quickbooks-throughput` pages.
- Partial sync state: handled via partial allocations.
- Error handling: `QuickBooksAllocationToleranceError` → 422. Cascade service exists.
- Retry behaviour: not statically verified.
- User-visible status: workbench shows `bulk(N)`, `+N` siblings, traffic-light gate. Good.
- Failed syncs visible: yes via reconciliation drawer; broader fixture-mode signal missing (EE-QA-016).
- Risks: EE-QA-006, EE-QA-007.

**SharePoint (M365)**
- Source of truth for documents (per business rule).
- COO-only manual-trigger sync (Pull/Push) for the "Proposals Pipeline" Engineering Support list.
- Metadata-only rule: never store full email bodies / attachments in DB. Code path `server/sharepoint-list.ts`.
- Partial sync / failure handling: not exhaustively verified.
- User-visible status: `/admin/sharepoint-intake` page exists.

**Pipedrive**
- CRM source of truth for opportunities. Unique constraint on `pipedrive_org_id` (`migration 0018`).
- Sync direction: pulled into `opportunities` table. Won-deals KPI on PD dashboard.
- Mock-mode default in dev (EE-QA-016).

**Outlook / Microsoft 365**
- Calendar metadata + email auto-linker (`/admin/email-linker-dev`). Metadata-only rule. SSO via MSAL.
- Mock connector available.

**Excel import / export**
- Smart Import v2 active path (`server/imports/`).
- Legacy path still in tree (EE-QA-017).
- Hash-based line IDs preserved.
- Override audit trail separate.

**Failure handling (cross-cutting)**
- `connector-mode.ts` is correct on the gate side.
- UX of failure / fixture is the gap (EE-QA-016).

**Source-of-truth risks**
- Pipedrive vs internal `opportunities` — need clarity on which side wins on field updates. Not verified statically.
- QB vs internal `normalizedCostLines` — internal is canonical (good).
- SharePoint vs internal `documents` — SharePoint is canonical for content; app stores metadata + deep links (good).

**Duplicate capture risks**
- Bidirectional `work_items` ↔ `engineering_tickets` mirror is a managed risk; covered by 28 regression tests.
- QB allocations many-to-many has partial settlement semantics; `effectiveAllocatedAmountExVat` is the canonical sum.

**Mapping risks**
- Vendor mapping lock currently bypassable per failing test (EE-QA-006).

**Reconciliation risks**
- See EE-QA-007 (snapshot guard misses on QB confirm path).

**Sync visibility**
- Connector mock mode silent (EE-QA-016).
- KPI traceability dead endpoints (EE-QA-012).

---

## 15. Maintainability Assessment

**Duplicated logic**
- `db.*` calls in routes vs repositories (EE-QA-011). 46 lint errors.
- Excel parser: legacy + v2 (EE-QA-017).
- `localStorage.company_role` reads scattered through client (EE-QA-005).

**Large files / components**
- See EE-QA-015. 7,879 LOC in `finance-routes.ts` is the headline.
- `EngineeringTasksPage.tsx` 4,869 LOC is a single-page React file — almost certainly more than 5 unrelated concerns in one file.

**Hardcoded strings / statuses / roles**
- Role names hardcoded in client (`CEO_ADMIN`, `COO_ADMIN`, `CFO`, etc.) for role-aware copy/badges. Mostly benign; a few decision sites (EE-QA-005) are not.
- Phase codes are constants in `shared/phases.ts` — good.
- Status enums centralised in `shared/schema/finance.ts` — good.

**Weak naming**
- `auth.routes.ts` empty (EE-QA-018).
- `ProgramExpense` / `ProgramInflows` retained as type names for tables that no longer exist (EE-QA-024).
- "Dashboard" used for two surfaces (legacy redirect to `/gates`) — EE-QA-014.

**Business logic placement**
- Aspirationally: schema + repos + services. Reality: routes do `db.*` (EE-QA-011), some business rules duplicated.

**Testability**
- Vitest unit suite is broad (5,074 tests). Strong contract coverage.
- API / smoke / route / workflow suites need the live-DB wrapper; not run-able from a bare clone.
- Coverage report: `npm run test:coverage` script exists; not run here.

**Suggested refactor areas (high to low ROI)**
1. Move `db.*` from `quickbooks-invoice-matches.routes.ts` into a dedicated repo.
2. Split `server/departments/finance-routes.ts` along business surfaces (cashflow / cos / revenue / gp / qb).
3. Split `client/src/pages/EngineeringTasksPage.tsx` and `smart-import.tsx` into focused sub-pages + shared hooks.
4. Retire `server/excelParser.ts` and `server/importPipeline.ts`.
5. Centralise the `localStorage.company_role` reads behind a single `useEffectiveRole()` hook.

**Fastest maintainability wins**
- EE-QA-001 (1 line). EE-QA-018 (delete file). EE-QA-020 (README line).
- Cleaning the `localStorage.company_role` reads to a single hook (smaller than it sounds; ~20 sites).

**Structural risks that will become expensive**
- The 7,879 LOC finance-routes file. Every new finance feature compounds the cost.
- The Smart Import v1/v2 duplication.

---

## 16. What Must Be Fixed First

### Before frontend testing

| ID | Owner role | Reason | Acceptance criteria |
|---|---|---|---|
| EE-QA-001 | Engineer (Frontend) | Build does not compile | `npm run check:client` exits 0 |
| EE-QA-003 | Engineer (Backend) | Schema-drift CI fails | `npm run db:check` exits 0 |
| EE-QA-004 | Engineer (Backend) | CI permission baseline fails | `npm run test` passes `route-permission-coverage` |
| EE-QA-008 | Engineer (Backend) | `/api/search` returns historical duplicates | Search of a re-imported line returns 1 row, not N |
| EE-QA-013 | Engineer (Backend) + Engineer (Frontend) | 11 unit tests failing | `npm run test` exits 0 |

### Before pilot use

| ID | Owner role | Reason | Acceptance criteria |
|---|---|---|---|
| EE-QA-002 | Engineer (Backend) + Program Finance Manager | Fabricated finance numbers | Either endpoints removed, or labelled "Demo data" with leadership sign-off |
| EE-QA-005 | Engineer (Frontend) | Role drift on long sessions | `isAdmin` derives from server matrix only; localStorage role reads removed from decision sites |
| EE-QA-006 | Engineer (Backend) + Program Finance Manager | QB vendor + permission gate regression | All `quickbooks-*` contract tests pass |
| EE-QA-007 | Engineer (Backend) | Snapshot guard breaches in QB confirm path | All 10 lookups carry `isNull(effectiveTo)`; new test in `qa/tests/unit` enforces |
| EE-QA-009 | Engineer (Frontend) + Program Finance Manager | Finance nav lost PO / payment paths | Nav contract test passes; CFO sign-off |
| EE-QA-010 | Engineer (Frontend) + COO/CEO | Landing divergence | Decision recorded; nav test passes |
| EE-QA-012 | Engineer (Backend) | Dead endpoints in KPI traceability | Every `apiEndpoint` in registry resolves to a registered route |
| EE-QA-014 | Engineer (Frontend) + COO | `/dashboard` redirect breaks bookmarks | Decision recorded; new label or new page |
| EE-QA-016 | Engineer (Full stack) | Fixture-mode UX | Banner appears in non-prod when any connector is mocked |
| EE-QA-019 | Engineer (Frontend) | Permission service errors fail open | RoleGuard renders retry banner on error; test added |
| EE-QA-022 | Engineer (Frontend) + Program Finance Manager | Tables don't show data source | "Imported / Manual / QB / Override" indicators on COS, cashflow, revenue tables |

### Before company rollout

| ID | Owner role | Reason | Acceptance criteria |
|---|---|---|---|
| EE-QA-011 | Engineer (Backend) | Routes bypass repository layer | `npm run lint` exits 0 (or baseline ratchet plan with named milestones) |
| EE-QA-015 | Engineering Manager | File-size cliff | Top-3 files split; `max-lines: 1500` lint rule added with allowlist |
| EE-QA-017 | Engineer (Backend) | Legacy Excel parser | `excelParser.ts` and `importPipeline.ts` either gone or `no-restricted-imports` lint applied |
| EE-QA-021 | Engineer (Frontend) | Inconsistent save/error feedback | All mutations route through a shared toast helper; checked by lint or test |
| EE-QA-024 | Engineer (Backend) | `ProgramExpense` / `ProgramInflows` legacy types | Renamed and call sites updated |

### Can defer

- EE-QA-018 (delete empty `auth.routes.ts`).
- EE-QA-020 (README install step).
- EE-QA-023 (TypeScript `any` warnings — set baseline + ratchet).
- EE-QA-025 (empty-state polish).

---
## 17. Recommended QA Plan

### Smoke tests (per-role, post-fix)

For each of the 16 roles in `COMPANY_ROLES`:

1. Login (password fallback) → land on expected `roleLandingEligibility` path.
2. Sidebar inspection — every visible link opens without "Access Denied".
3. Visit every page in the role's nav — no 5xx, no blank screen, fixture banner correct.
4. Create / edit a single record in the primary surface for the role (e.g. CFO creates a PO request, ENGINEER updates a work_item, QUALITY_MANAGER closes an NCR).
5. Logout.

`npm run test:smoke` (Playwright) is structured to do this; it currently needs a running app, a seeded DB, and the build to compile.

### Regression tests

| Area | Test |
|---|---|
| Finance — cashflow | Import baseline, capture an invoice, mark paid → cashflow row appears against `paidDate`, not `invoiceDate`. |
| Finance — COS | Import baseline → COS shows row as forecast; capture invoice → row flips to realised in invoice month. |
| Finance — QB matching | Match QB bill to two app-cost lines with allocation; total ≤ QB; over-allocate → 422. |
| Finance — vendor mapping lock | Approve a match with `mapVendor=true`; second attempt with different counterparty → `mapping_locked`. |
| Smart Import v2 | Re-import same workbook → existing rows updated by hash, no duplicates created; previous overrides preserved. |
| Search | Re-import line, search for description → 1 hit, not 2 (covers EE-QA-008). |
| Permissions | Each entity × each action × each role asserted against server matrix and UI gate. |
| Lifecycle gates | Move project through S01 → S_DONE; assert HSE module hidden until S04+; O&M handover surface only on S08. |
| QB cascade | Create suggestion → reject → suggestion does not re-appear in next sweep. |

### Manual user journey tests

1. **PD → PM handover** — PROJECT_DEVELOPER creates ticket; PD signs off; PROGRAM_MANAGER receives PD-PM handover dashboard entry; PM ticks the gate; HSE / Compliance modules become reachable for the project.
2. **Construction milestone capture** — PROJECT_MANAGER_SITE updates a milestone; PROGRAM_FINANCE_MANAGER raises an invoice against the milestone; CCO captures in QB; reconciliation page shows match.
3. **Commissioning → O&M handover** — ENGINEER closes commissioning; PM completes O&M handover (Matriarch handover entry visible); CLIENT_HANDOVER follows.
4. **3-Month Post-HO Review** — PM closes review on date; CFO sees revenue recognition shift in canonical reads.
5. **Compliance Handover** — final phase; HSE_MANAGER signs off compliance evidence; project moves to S_DONE.

### Automated test coverage recommendations

- Keep all existing 5,074 unit tests green.
- Add: snapshot-guard regression test for `quickbooks-invoice-matches.routes.ts` (EE-QA-007).
- Add: KPI-traceability registry-vs-routes integrity test (EE-QA-012).
- Add: `npm run test:api` must run cleanly with the seeded fixture DB (currently not exercised in this audit).
- Add: a Playwright smoke per role (16 roles × N pages — already partially in `qa/tests/e2e/smoke.spec.ts`).

### Suggested test data

- A seeded "demo project" with: 1 PO awaiting approval, 1 paid invoice, 1 unpaid invoice, 1 open NCR, 1 active commissioning checklist, 1 PD ticket, 1 won opportunity, 1 SharePoint folder link, 1 QB bill linked to 2 cost lines.
- A seeded "edge-case project" in S_HOLD, with a previous re-import (so snapshot history exists), and at least one manually-overridden cost line.

### Staging validation flow

1. Apply migrations (after EE-QA-003 fixed).
2. Run `npm run db:setup` against staging DB.
3. Run `npm run test:api` and `npm run test:routes` against the staging instance.
4. Run `npm run test:smoke` (Playwright).
5. Run `npm run reconciliation:report` and inspect the output for unexpected drift.
6. Have Program Finance Manager manually reconcile one project Excel ↔ App via `/program/excel-vs-app`.
7. Sign-off matrix: each role lead reviews their primary surface.

### Suggested owner by role

- COO_ADMIN — final QA sign-off, integration with M365.
- CEO_ADMIN — leadership dashboard sanity check.
- CFO + PROGRAM_FINANCE_MANAGER + ACCOUNTANT — finance trust pass.
- CCO + KEY_ACCOUNTS_MANAGER + PROJECT_DEVELOPER — PD pipeline.
- PROGRAM_MANAGER + PROJECT_MANAGER_SITE + CONSTRUCTION_MANAGER — execution + handovers.
- ENGINEERING_MANAGER + ENGINEER — engineering board, commissioning.
- QUALITY_MANAGER — NCR + checklists.
- HSE_MANAGER — compliance after PD→PM handover.
- SSEG_MANAGER — SSEG submissions.

### Suggested sequence of work

1. Day 1 (≤4 h): EE-QA-001, EE-QA-003, EE-QA-018, EE-QA-020 — minute-fixes that unblock the build and CI.
2. Days 2–3: EE-QA-004, EE-QA-006, EE-QA-008 — restore lost guards and gates.
3. Day 4: EE-QA-009, EE-QA-010, EE-QA-014 — IA decisions with leadership; align tests.
4. Days 5–7: EE-QA-002, EE-QA-005, EE-QA-007, EE-QA-012, EE-QA-016, EE-QA-019, EE-QA-022 — trust surface.
5. Weeks 2–4: EE-QA-011, EE-QA-015, EE-QA-017, EE-QA-021, EE-QA-024 — structural workstream.

### Acceptance criteria (for "ready for pilot")

- All P0 / P1 items from §16 closed.
- `npm run check`, `npm run lint` (P0/P1 errors only), `npm run test`, `npm run db:check` all exit 0.
- `npm run test:api` and `npm run test:smoke` exit 0 against a seeded staging DB.
- One end-to-end manual project lifecycle (S01 → S_DONE) completed by the relevant role owners with sign-off.
- Connector mock-mode banner verified in the staging environment.

---

## 18. Open Questions

| Question | Why it matters | How to verify | Who should answer (by role) |
|---|---|---|---|
| Is `/api/revenue-summary` planned or retired? | Drives EE-QA-012 fix shape (implement vs relabel) | Read project roadmap; check open issues | CFO + Engineering Manager |
| Should CEO/COO land on `/ceo`/`/coo` or `/execution-board`? | EE-QA-010 outcome | Decision call | CEO + COO |
| Should PO / payment-request / payment-batch sit in Finance nav, or under a new "Procurement & Payments" group? | EE-QA-009 outcome | Decision call | CFO + Program Finance Manager |
| Is there a planned Matriarch API integration, or is the handover purely operational (project moves to S08, downstream system takes over outside the app)? | Defines whether O&M handover needs more code | Architecture discussion | COO + Engineering Manager |
| Are HSE/compliance modules already gated by project phase ≥ S04? | EE-QA workflow item — cannot tell statically | Pilot smoke test | HSE Manager + Engineering Manager |
| What is the canonical surface for "raise invoice" vs "capture invoice"? | Pilot trust risk if labels diverge | Browser smoke + UX walkthrough | Program Finance Manager |
| Does Pipedrive own opportunity field updates, or does the app overwrite Pipedrive on edit? | Determines duplicate-capture risk | Read sync code + ops conversation | CCO + Engineering Manager |
| Are migrations 0016 / 0032 / 0033 / 0045/0049 (duplicate numbers) ordered correctly in the journal? | Latent risk on fresh DB | Inspect `migrations/meta/_journal.json` | Engineering Manager |
| Are the analytics widgets (EE-QA-002) actually visible in the current UI, or only registered? | Determines pilot blast radius | Browser smoke | Engineering Manager |
| Is `seed-ee-info-updates.ts` (1,819 LOC) re-run on every dev start? Could it overwrite a tracker import? | Smart Import trust risk | Read `server/bootstrap/` | Engineering Manager |
| Are bank-detail fields decrypted only on read inside repo helpers, never on the wire? | Confirms encryption story holds | Read `scripts/encrypt-existing-bank-details.ts` + repos | Engineering Manager |

---

## 19. Final Recommendation

**Is the app ready for frontend testing?** **No.** The build does not compile (EE-QA-001). 11 unit tests fail. CI permission baseline is breached. Fix Day-1 items before any QA tester touches it.

**Is the app ready for pilot use?** **No.** Three critical finance trust risks (fabricated analytics — EE-QA-002, regressed QB guards — EE-QA-006, snapshot guard misses on QB confirm — EE-QA-007), a navigation regression that hides core finance flows (EE-QA-009), and silent fixture data with no UI signal (EE-QA-016). Any of these alone can collapse pilot trust on day one.

**Is the app ready for company rollout?** **No.** On top of pilot blockers, the codebase carries severe structural debt: 46 lint-blocked routes that bypass the repository layer (EE-QA-011), several files >3,000 LOC including a 7,879-line finance routes file (EE-QA-015), and a duplicate Smart Import implementation still in tree (EE-QA-017). These are not blockers per release — but each new finance feature compounds the cost. They must be on a named workstream, not a "we'll get to it" backlog.

**What should be fixed first?**
1. The 1-line build break (EE-QA-001).
2. The migration journal drift (EE-QA-003).
3. The three ungated routes (EE-QA-004).
4. The 11 failing unit tests (EE-QA-013) — most are downstream of the above + EE-QA-006/009/010.
5. `/api/search` snapshot guard (EE-QA-008).
6. The QB regressions (EE-QA-006, EE-QA-007).
7. Fabricated analytics (EE-QA-002).
8. Connector fixture-mode banner (EE-QA-016).
9. RoleGuard fail-open (EE-QA-019).
10. Nav and landing decisions (EE-QA-009, EE-QA-010, EE-QA-014).

**What should not be touched yet?**
- Do **not** start the route-file split (EE-QA-015) until pilot blockers are closed — it will create merge conflicts with the urgent fixes.
- Do **not** attempt the `db.*` → repository migration (EE-QA-011) as a single PR. Track as a workstream with a per-domain sequence.
- Do **not** delete the legacy Excel parser (EE-QA-017) until every caller is identified and migrated.
- Do **not** redefine any finance logic as part of fixing UI labels. The finance maths in repositories is correct; do not let UI fixes leak into the recognition logic.
- Do **not** silence ESLint or TypeScript errors; the lint rules are now part of the contract that catches the regressions you have today.

**Final note**

This codebase has good bones. The canonical phase model, the snapshot table convention, the repository pattern, the permission registry, the connector mock-mode gate, the canonical evaluators in `gate-auto-evaluator-service.ts` and `isCanonicalCosRealised` — all show that someone has thought hard about correctness. The trust problems are concentrated in a small number of places, each of which is fixable in a day or less. The structural debt is real but not lethal. With one focused week on the P0/P1 list, this is a pilot-credible product.

---
