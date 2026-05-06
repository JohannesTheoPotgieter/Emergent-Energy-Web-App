# Runtime Cleanup Audit (2026-03-16)

## Scope and method

- Runtime entrypoints audited: `client/src/main.tsx` -> `client/src/App.tsx` and `server/index.ts` -> `server/bootstrap/startup-orchestrator.ts` -> `server/routes/register-all-routes.ts` -> `server/routes.ts`.
- Reachability proof used runtime import graph checks from those entrypoints plus full-repo string searches for route pushes, redirects, tests, and seed references.
- Safety rule applied: if an item still had runtime, migration, test, seed, Microsoft, or finance-source-of-truth coupling, it was preserved and marked as `kept`, `deprecated`, or `uncertain`.
- No schema mutations were applied in this cleanup pass.

## Cleanup audit table

| item | type | status (removed / deprecated / kept / uncertain) | evidence | risk level | action taken |
|---|---|---|---|---|---|
| Top-level `pages/` shadow tree | Frontend duplicate page tree | removed | Active frontend runtime starts at `client/src/main.tsx` and imports `client/src/App.tsx`; no active runtime entry imports the repo-root `pages/` tree. The tree duplicated `client/src/pages/*` names and failed reachability from runtime/test entrypoints. | low | Deleted the entire repo-root `pages/` tree and added `qa/tests/unit/legacy-page-artifacts.test.ts` to prevent reintroduction. |
| Repo-root duplicate page entrypoints (`training.tsx`, `weekly-reviews.tsx`, `tr-register.tsx`, `triage-inbox.tsx`, `unclassified-tasks.tsx`) | Frontend duplicates | removed | No route registration, import, or test references remained; each had canonical runtime equivalents under `client/src/pages/*` or redirect-only page-registry entries. | low | Deleted the files and covered absence in `qa/tests/unit/legacy-page-artifacts.test.ts`. |
| Unreachable client legacy pages (`admin-ms-mapping.tsx`, `cashflow-forecast.tsx`, `collab-sharepoint.tsx`, `command-center.tsx`, `cos-control.tsx`, `engineering-inbox.tsx`, `engineering-sync.tsx`, `home.tsx`, `ms-integration-settings.tsx`, `project-normalized-view.tsx`, `revenue.tsx`, `sp-admin-settings.tsx`, `sp-import-runs.tsx`, `tr-register.tsx`, `triage-inbox.tsx`, `unclassified-tasks.tsx`) | Frontend pages/routes | removed | These modules were not reachable from `client/src/App.tsx` route wiring. Remaining route references were redirected or retargeted through `client/src/config/page-registry.ts`, `client/src/config/home-brief.ts`, `client/src/data/screen-tours.ts`, `client/src/data/walkthroughs.ts`, and `client/src/pages/ee-info.tsx`. | low | Deleted the files, redirected legacy finance/admin paths to canonical surfaces, and added regression tests for redirects plus file absence. |
| Legacy finance frontend paths (`/revenue`, `/cos-control`, `/cashflow-forecast`) | Frontend routes | deprecated | `client/src/config/page-registry.ts` now maps `/revenue` -> `/revenue-tracker`, `/cos-control` -> `/cos`, `/cashflow-forecast` -> `/cashflow`. `client/src/config/app-navigation.ts` shows canonical finance navigation on `/cashflow`, `/cos`, `/revenue-tracker`, `/gp-tracker`. | low | Preserved the URLs as redirects, retargeted home/help/walkthrough links, and added `qa/tests/unit/finance-route-canonicalization.test.ts`. |
| Project List placement | Frontend navigation | kept | `client/src/config/app-navigation.ts` keeps `Project List` under `Project Management` at `/projects`; `client/src/config/page-registry.ts` defines `/projects`; `qa/tests/unit/project-management-structure.test.ts` and `qa/tests/unit/app-navigation.test.ts` assert the location. | low | No runtime removal was needed because the current app was already canonical. Documented as preserved. |
| `client/src/pages/project-create.tsx` | Frontend page | kept | `client/src/pages/project-lifecycle.tsx` still calls `setLocation("/project-create")`; `qa/tests/unit/project-client-linkage-contract.test.ts` reads the file directly. | medium | Left in place. This route still needs runtime wiring work, but it is not dead code. |
| `client/src/pages/eng-template-admin.tsx` | Frontend page | kept | `server/seed-ee-info-updates.ts` still seeds the URL `/eng-template-admin`. | medium | Left in place and documented as a seed-coupled survivor. |
| `client/src/pages/notification-center.tsx` | Frontend page | kept | Walkthrough and tour data still reference `/notifications`. | medium | Left in place. |
| `client/src/pages/phase-templates.tsx` | Frontend page | kept | Walkthroughs and template APIs still reference the phase-template surface. | medium | Left in place. |
| `client/src/pages/admin-roles.utils.ts` | Frontend utility | kept | Imported by `client/src/pages/admin-roles.tsx` and read by `qa/tests/unit/admin-roles-module.test.ts`. | low | Left in place. |
| `server/routes.ts` | Backend route module | kept | `server/index.ts` calls `runStartupOrchestrator`, which flows to `server/routes/register-all-routes.ts`, which imports `registerRoutes` from `../routes` and executes it. | high | Explicitly preserved. No deletions inside `server/routes.ts` were attempted without endpoint-by-endpoint proof. |
| `server/routes/health.ts` | Backend route file | removed | No registration path from `server/routes/register-all-routes.ts` or other runtime entrypoints; no route inventory or tests relied on it. | low | Deleted the orphaned file and covered its absence in `qa/tests/unit/legacy-page-artifacts.test.ts`. |
| Duplicate My Work triage endpoints (`/api/mytool/triage-inbox`, `/api/mytool/unclassified-tasks`) in `server/routes.ts` and `server/departments/exco-routes.ts` | Backend APIs | uncertain | Both files define the same paths and both route modules are active. This creates duplicate-handler risk, but current usage could still exist. | high | Preserved. Marked for manual review before any removal or deprecation logging change. |
| Duplicate finance handlers split between `server/routes.ts` and `server/departments/finance-routes.ts` | Backend APIs / finance truth paths | uncertain | `server/routes/register-department-routes.ts` registers `registerFinanceRoutes(app)`, while `server/routes.ts` still defines overlapping handlers for `/api/cashflow-2026*`, `/api/cos-tracker*`, `/api/revenue-tracker*`, `/api/revenue-tab/*`, `/api/revenue-tracking/overrides*`, `/api/tracker-monthly*`, `/api/cos-control/*`, and `/api/cashflow-forecast/*`. `docs/audit/route-usage-matrix.md` still marks many of these as `ACTIVE` or `DUPLICATE`. | high | Preserved. Documented as duplicate/manual-review only because finance import/change/variance truth may still depend on them. |
| Canonical work/project/finance tables (`project_info`, `work_items`, `work_item_assignments`, `work_item_dependencies`, `normalized_revenue_lines`, `normalized_cost_lines`, `program_inflows`) | Database tables | kept | `CANONICAL_MODEL_DECISION_TABLE.md` and `docs/CANONICAL_RUNTIME_BOUNDARIES.md` define these as canonical or active write/read boundaries. | high | No schema change. Explicitly preserved. |
| Transitional legacy tables (`operational_tasks`, `mytool_tasks`, `normalized_plan_tasks`, `program_expense`) | Database tables | deprecated | `CANONICAL_MODEL_DECISION_TABLE.md` marks them transitional or ingest-only; `server/canonical-boundaries.ts` still mirrors `work_items` to `operational_tasks`. Production data may exist. | high | No drop or rename. Left intact and documented as deprecated adapters/ingest sources only. |
| Microsoft-linked frontend duplicates (`admin-ms-mapping.tsx`, `ms-integration-settings.tsx`, `collab-sharepoint.tsx`, `sp-admin-settings.tsx`, `sp-import-runs.tsx`) | Frontend Microsoft UI surfaces | removed | Canonical admin/settings routing already redirects `/settings/integrations`, `/admin/ms-integration`, and `/admin/ms-mapping` to `/admin/settings`; collaboration runtime remains on `/collaboration`, `/collaboration/email`, `/collaboration/teams`, and `/teams/chats`. | medium | Deleted only the unreachable duplicate page modules. |
| Microsoft runtime integration (`server/ms-sync-routes.ts`, `server/microsoft-auth.ts`, `server/ms-sync-service.ts`, `/api/admin/ms-integration*`) | Backend Microsoft integration | kept | Active runtime APIs still exist for Microsoft object sync, Teams linking, Graph webhook handling, and admin integration settings. | high | No runtime deletion. Preserved intact. |

## Exact files removed

```text
pages/action-launchpad.tsx
pages/admin-approvals.tsx
pages/admin-control-center.tsx
pages/admin-ms-mapping.tsx
pages/admin-recovery.tsx
pages/admin-roles.tsx
pages/admin-roles.utils.ts
pages/admin.tsx
pages/cashflow-forecast.tsx
pages/cashflow.tsx
pages/clients.tsx
pages/collab-email.tsx
pages/collab-sharepoint.tsx
pages/collab-teams.tsx
pages/collaboration.tsx
pages/command-center.tsx
pages/cos-control.tsx
pages/cos.tsx
pages/counterparties.tsx
pages/dashboard.tsx
pages/database-migration.tsx
pages/department-scores.tsx
pages/ee-info.tsx
pages/eng-template-admin.tsx
pages/engineering-dashboard.tsx
pages/engineering-inbox.tsx
pages/engineering-sync.tsx
pages/engineering-tasks.tsx
pages/EngineeringTasksPage.tsx
pages/excel-updates.tsx
pages/exceptions.tsx
pages/execution-board.tsx
pages/feedback.tsx
pages/financial-linking.tsx
pages/gp-tracker.tsx
pages/handover-control.tsx
pages/home.tsx
pages/import-control-tower.tsx
pages/invoice-patterns.tsx
pages/knowledge-game.tsx
pages/kpi-traceability.tsx
pages/leaderboard.tsx
pages/lifecycle-board.tsx
pages/login.tsx
pages/ms-callback.tsx
pages/ms-integration-settings.tsx
pages/my-tool-admin-settings.tsx
pages/my-tool-backlog.tsx
pages/my-tool-help.tsx
pages/my-tool-meetings.tsx
pages/my-tool-priorities.tsx
pages/my-tool-settings.tsx
pages/my-tool-today.tsx
pages/my-tool-week.tsx
pages/my-work-calendar.tsx
pages/my-work-home.tsx
pages/my-work-tasks-logic.ts
pages/my-work-tasks.tsx
pages/not-found.tsx
pages/notification-center.tsx
pages/pd-dashboard.tsx
pages/pd-pm-handover.tsx
pages/pd-ticket-create.tsx
pages/pd-ticket-detail.tsx
pages/pd-tickets.tsx
pages/phase-templates.tsx
pages/pm-dashboard.tsx
pages/pm-handover-review.tsx
pages/pm-on-the-go-home.tsx
pages/pm-on-the-go-project.tsx
pages/portfolio-detail.tsx
pages/portfolios.tsx
pages/project-create.tsx
pages/project-detail.tsx
pages/project-normalized-view.tsx
pages/projects.tsx
pages/qm-dashboard.tsx
pages/revenue-tracker.tsx
pages/revenue.tsx
pages/role-settings.tsx
pages/smart-import.tsx
pages/sp-admin-settings.tsx
pages/sp-import-runs.tsx
pages/subcontractor-dashboard.tsx
pages/system-activity-log.tsx
pages/teams-chats.tsx
training.tsx
weekly-reviews.tsx
tr-register.tsx
triage-inbox.tsx
unclassified-tasks.tsx
client/src/pages/admin-ms-mapping.tsx
client/src/pages/cashflow-forecast.tsx
client/src/pages/collab-sharepoint.tsx
client/src/pages/command-center.tsx
client/src/pages/cos-control.tsx
client/src/pages/engineering-inbox.tsx
client/src/pages/engineering-sync.tsx
client/src/pages/home.tsx
client/src/pages/ms-integration-settings.tsx
client/src/pages/project-normalized-view.tsx
client/src/pages/revenue.tsx
client/src/pages/sp-admin-settings.tsx
client/src/pages/sp-import-runs.tsx
client/src/pages/tr-register.tsx
client/src/pages/triage-inbox.tsx
client/src/pages/unclassified-tasks.tsx
server/routes/health.ts
```

## Exact files modified

```text
package.json
client/src/App.tsx
client/src/config/page-registry.ts
client/src/config/home-brief.ts
client/src/data/screen-tours.ts
client/src/data/walkthroughs.ts
client/src/pages/ee-info.tsx
qa/tests/unit/finance-route-canonicalization.test.ts
qa/tests/unit/legacy-page-artifacts.test.ts
docs/CANONICAL_RUNTIME_BOUNDARIES.md
docs/qa/app-route-inventory.md
docs/audit/runtime-cleanup-2026-03-16.md
```

## Exact APIs removed or deprecated

- Removed backend APIs: none in this pass. No live endpoint was deleted without proof of inactivity.
- Deprecated frontend compatibility routes retained as redirects:
  - `/revenue` -> `/revenue-tracker`
  - `/cos-control` -> `/cos`
  - `/cashflow-forecast` -> `/cashflow`
  - `/settings/integrations` -> `/admin/settings`
  - `/admin/ms-integration` -> `/admin/settings`
  - `/admin/ms-mapping` -> `/admin/settings`
- Deprecated/manual-review backend APIs preserved:
  - `/api/mytool/triage-inbox`
  - `/api/mytool/unclassified-tasks`
  - `/api/cos-control/*`
  - `/api/cashflow-forecast/*`
  - `/api/revenue-tab/*`
  - `/api/revenue-tracking/overrides*`
  - `/api/tracker-monthly*`

## Exact tables/columns removed, deprecated, or preserved

- Removed tables: none.
- Removed columns: none.
- Deprecated tables preserved in place:
  - `operational_tasks`
  - `mytool_tasks`
  - `normalized_plan_tasks`
  - `program_expense`
- Preserved canonical tables:
  - `project_info`
  - `work_items`
  - `work_item_assignments`
  - `work_item_dependencies`
  - `program_inflows`
  - `normalized_revenue_lines`
  - `normalized_cost_lines`
- Production data risk:
  - High for all deprecated tables above. No drop/backfill/archive migration was attempted.

## Exact Microsoft-linked paths removed, deprecated, or preserved

- Removed unreachable Microsoft-linked UI modules:
  - `client/src/pages/admin-ms-mapping.tsx`
  - `client/src/pages/ms-integration-settings.tsx`
  - `client/src/pages/collab-sharepoint.tsx`
  - `client/src/pages/sp-admin-settings.tsx`
  - `client/src/pages/sp-import-runs.tsx`
- Deprecated frontend entry paths preserved as redirects:
  - `/settings/integrations`
  - `/admin/ms-integration`
  - `/admin/ms-mapping`
- Preserved canonical frontend Microsoft/collaboration paths:
  - `/admin/settings`
  - `/collaboration`
  - `/collaboration/email`
  - `/collaboration/teams`
  - `/teams/chats`
  - `/my-work/teams`
- Preserved backend Microsoft integration paths:
  - `/api/ms-objects/*`
  - `/api/ms-sync/*`
  - `/api/ms-teams/project-chat/:projectId`
  - `/api/webhooks/graph`
  - `/api/admin/ms-integration*`
  - `/api/auth/microsoft/callback`

## Exact obsolete Project List placement remnants removed, deprecated, or preserved

- Removed obsolete Project List placement remnants: none found in active runtime.
- Preserved canonical Project List location:
  - Navigation group: `Project Management`
  - Route: `/projects`
  - Tests: `qa/tests/unit/project-management-structure.test.ts`, `qa/tests/unit/app-navigation.test.ts`
- Deprecated remnants: none identified in active runtime code. Historical docs may still mention older structure and should be updated separately if relied on operationally.

## Exact obsolete or duplicate finance paths removed, deprecated, or preserved

- Removed unreachable finance page modules:
  - `client/src/pages/revenue.tsx`
  - `client/src/pages/cashflow-forecast.tsx`
  - `client/src/pages/cos-control.tsx`
- Deprecated finance frontend paths preserved as redirects:
  - `/revenue` -> `/revenue-tracker`
  - `/cashflow-forecast` -> `/cashflow`
  - `/cos-control` -> `/cos`
- Preserved canonical finance frontend paths:
  - `/cashflow`
  - `/cos`
  - `/revenue-tracker`
  - `/gp-tracker`
- Preserved canonical finance backend paths in use:
  - `/api/cashflow-2026*`
  - `/api/cashflow/*`
  - `/api/cos-tracker*`
  - `/api/revenue-tracker*`
- Preserved duplicate/manual-review finance backend paths:
  - `/api/cos-control/*`
  - `/api/cashflow-forecast/*`
  - `/api/revenue-tab/*`
  - `/api/revenue-tracking/overrides*`
  - `/api/tracker-monthly*`
- Finance truth/data safety note:
  - No finance import, change, variance, or override API was removed because `docs/audit/route-usage-matrix.md` and frontend component references still show active or duplicate consumption.

## Rollback considerations

- Frontend rollback is file-level only: restore deleted files from version control if a hidden dependency appears.
- Route rollback is low-risk because canonical redirects were added rather than breaking old URLs.
- No DB rollback is required because no schema, migration, or data mutation was performed.
- If a deleted page module is discovered to be referenced by external tooling, restore the module and keep the redirect in place while auditing consumers.

## Tests run

- Passed:
  - `cmd /c npx.cmd vitest run -c qa/vitest.config.ts qa/tests/unit/finance-route-canonicalization.test.ts qa/tests/unit/legacy-page-artifacts.test.ts qa/tests/unit/project-management-structure.test.ts qa/tests/unit/app-navigation.test.ts qa/tests/unit/project-client-linkage-contract.test.ts`
  - `cmd /c npm.cmd run test:route-proof`
  - `cmd /c npm.cmd run test:routes`
- Failed due pre-existing repository baseline issues outside this cleanup:
  - `cmd /c npm.cmd run check`
- Failed in smoke after harness fix because the SQLite test runtime is missing required schema objects/columns, causing route 500s during page load:
  - `cmd /c npm.cmd run test:smoke`
  - Observed blockers from `smoke-log.txt`: missing table `project_pd_pm_handover`, missing table `notifications`, missing table `sp_settings`, missing column `phase_updated_at`, and SQLite query incompatibilities (`unrecognized token: ":"`).
- Smoke harness issue corrected in this pass:
  - `package.json` now runs Playwright with `-c qa/playwright.config.ts`, fixing the prior invalid-URL/baseURL failure mode.
- Not run in this pass:
  - `cmd /c npm.cmd run test:workflows`

## Remaining uncertain items requiring manual review

- Duplicate My Work admin endpoints:
  - `/api/mytool/triage-inbox`
  - `/api/mytool/unclassified-tasks`
- Duplicate finance handlers registered from both `server/routes.ts` and `server/departments/finance-routes.ts`.
- Any hidden consumers outside the repo for legacy frontend redirects (`/revenue`, `/cos-control`, `/cashflow-forecast`, `/admin/ms-integration`, `/admin/ms-mapping`).
- Historical docs that still describe removed page modules as live surfaces, especially older discovery/UX audit artifacts.
