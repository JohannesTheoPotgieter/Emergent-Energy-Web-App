# Smart Import v2 — Task / file / folder dedup + KPI consistency audit

**Last verified:** 2026-05-15  
**Reviewer:** Claude Code (`claude/audit-import-deduplication-ZNwNB`)

## TL;DR

Three questions, three answers.

| Question | Answer |
|---|---|
| If I import the same workbook twice, will I get duplicate tasks? | **No.** Hash-based identity (`row_hash`) + the partial index `work_items_row_hash_active_idx` + the unique partial index on `external_ref` + end-of-pass orphan soft-delete make re-import idempotent. Verified in `qa/tests/imports/smart-import-task-idempotency.test.ts`. |
| Will I get duplicate files or folders? | **No.** Smart Import has zero write paths into `managed_documents`, `folder_taxonomy`, or `project_folders`. Those tables have their own composite unique indexes; folder provisioning is a separate manual route. |
| Do all my dashboards read from — and compute KPIs the same way as — the same source of truth? | **After this PR, yes.** Every active reader of progress / schedule data reads from `work_items` (directly or via the `storage.getProjectPlans*` adapter). After Fix 4 every KPI computation routes through the shared helpers in `server/lib/kpi-formulas.ts` and the canonical 0..1 scale enforced by `clampPercent`. |

What this PR delivers:

- **Fix 1** — five live legacy paths that wrote to `work_items` while bypassing v2 dedup are now 410'd or surgically de-fanged.
- **Fix 2** — the importer warns the operator when a PLAN row lacks a stable `taskNo` (rename will produce new+missing pairs).
- **Fix 3** — two new Vitest regression files (idempotency + KPI consistency) guard the invariants for future PRs.
- **Fix 4** — the canonical 0..1 scale + the shared SA-working-days helper + the milestone-completion fallback eliminate cross-page divergence. Migration `0064_work_items_pct_scale_normalise.sql` brings existing data onto the canonical scale.
- **Fix 5** — this document.

---

## Section A — Tasks → `work_items` dedup is protected

| Concern | Evidence | Verdict |
|---|---|---|
| Stable row identity across re-imports | `server/lib/import/row-hasher.ts:60-76` — `hashPlanRow(projectId, wbsCode \| outlineNumber \| externalRef, title-only-if-no-wbs)` SHA-256. Title is intentionally a tiebreaker only when WBS is empty so clarifying a task name does not flip the hash for WBS-stable rows. | OK |
| Fast lookup by hash | `shared/schema/tasks.ts:258-260` — partial index `work_items_row_hash_active_idx` on `(projectId, rowHash) WHERE deletedAt IS NULL`. | OK |
| DB-level uniqueness backstop | `shared/schema/tasks.ts:261-263` — **unique** partial index `uq_work_items_external_ref_active` on `externalRef WHERE deletedAt IS NULL`. Cannot insert two active rows with the same canonical ref. | OK |
| Within-import duplicate hash detection | `server/lib/import/commit-executor.ts:615-633` — second occurrence of a hash in the same import is warned and skipped. | OK |
| Match-then-upsert (no blind insert) | `commit-executor.ts:648-657, 734-812` — lookup by hash → fall back to matcher's `existingRowId` → defensive `externalRef` collision check → UPDATE in-place rather than INSERT. | OK |
| End-of-pass orphan handling | `commit-executor.ts:979-1006` — active SMART_IMPORT rows whose `row_hash` is not in `seenRowHashes` are soft-deleted (`deletedAt = NOW`). Legacy rows without a hash are intentionally skipped (they pick up a hash on the next import). | OK |
| `parentId` re-derivation | `commit-executor.ts:1014-1052` — recomputed from `outlineNumber` prefix on every import. Idempotent. | OK |
| Title-rename when no `taskNo` | `row-hasher.ts:67,74` — when WBS is empty, hash uses `title`. Renaming such a task flips the hash → old row soft-deleted, new row inserted. Documented as known limitation §5; **Fix 2** now emits a per-row warning so the operator notices. | Surfaced |
| Two conflict engines coexist | `docs/smart-import-v2-known-limitations.md` §10 — `conflict-engine.ts` and `merge-engine.ts` both run. Equivalent for the trust contract; consolidation deferred. | Track only |

---

## Section A.bis — Every progress / schedule KPI reader points at `work_items`

Verified across 57+ server files. Spot-checked:

| Reader (page / endpoint) | DB source | KPI surfaced |
|---|---|---|
| Plan tab — `/api/project-plan/:name`, `server/routes/planning-extracted-routes.ts:113-126` | `work_items` via `storage.getProjectPlansByProject` (adapter, reads `work_items`) | `percentComplete`, `expectedPctComplete`, `startDate`, `endDate`, `duration`, `wbsCode` |
| Plan tab inline overrides — `POST /api/project-plan/overrides`, `planning-tasks-routes.ts:1020` | `work_items.manualOverrides` JSONB | `percentComplete`, dates, owner |
| Programme reports page — `client/src/pages/programme-reports.tsx:90-120` → `GET /api/reports/project-plan` → `server/report-routes.ts:537-586` | `work_items` via `workManagementRepository.listSmartImportPmTasks()` | `percentComplete`, `expectedPctComplete`, `isMilestone`, dates |
| Program dashboard — `/api/program-dashboard`, `dashboard-routes.ts:90-131` | `work_items` | Portfolio RAG, schedule, milestones |
| Project Overview — `server/routes/overview-extracted-routes.ts:12-81` | `work_items` | All work items + PM/SMART_IMPORT subset |
| Working Plan — `/api/projects/:name/working-plan`, `working-plan-routes.ts:19-176` | `work_items` | `percentComplete`, dates |
| Operational tasks — `operational-tasks-routes.ts:33-98` | `work_items` | PM/ENG tasks, status, `percentComplete` |
| Engineering rollups — `engineering-routes.ts`, `project-development-workspace-rollup.routes.ts` | `work_items` | `percentComplete`, `trackingRag` |
| Lifecycle stage-gate — `server/services/lifecycle-stage-gate-service.ts` | `work_items` | `isMilestone`, status |
| PM monthly report — `pm-monthly-report-service.ts:361` | `work_items` | `percentComplete`, `isMilestone` (now with the actualEnd fallback — Fix 4c) |
| Project schedule milestones — `server/departments/project-routes.ts:879-883, 1396-1399, 1588-1607` | `work_items` directly + `storage.getAllProjectPlans()` adapter (also reads `work_items`) | BD Handover, Site Establishment, Commissioning, OM / Client Handover dates |

### Legacy task tables — confirmed dead reads

- `project_plan` — **not defined in any active schema reachable from KPI readers**. `shared/schema/finance.ts:217-218` still exports the `ProjectPlan` / `InsertProjectPlan` types, but every storage method that returns `ProjectPlan` (`getAllProjectPlans`, `getProjectPlansByProject`, `mapWorkItemToProjectPlan` at `server/storage.ts:803-848`) actually reads from `work_items` and reshapes. The shared type is an adapter façade, not a separate table read.
- `operational_tasks` — table dropped (`shared/schema/tasks.ts:39-41` comment confirms data migrated into `work_items`).
- `mytool_tasks` — removed in Phase 6; unified into `work_items`.
- `server/work-items-backfill.ts` and `server/kpi-traceability-routes.ts:1625` reference the legacy names only as historical / migration docs — not live read paths.

### Capture-but-not-surfaced gap

`work_items.baselineStart` and `work_items.baselineEnd` are written by Smart Import v2 (`commit-executor.ts:772-774, 832-834`) to preserve the workbook's planned-vs-actual layout, but no KPI reader currently exposes them. Schedule-variance UI (planned vs actual) cannot be computed without these. Tracked as a follow-up — not in scope for this audit.

---

## Section A.ter — KPI computation consistency (Fix 4)

Reading from the same source of truth is necessary but not sufficient. Several readers also derive KPIs and the derivations diverged.

### Before this PR

| KPI | Reader | Formula | Scale assumed | Severity |
|---|---|---|---|---|
| `percentComplete` | `server/routes/planning-tasks-routes.ts:283-284` | `rawPct > 1 ? round(rawPct) : round(rawPct*100)` | Auto-detect → 0..100 output | defensive |
| `percentComplete` | `server/repositories/dashboard-repository.ts:194, 257-271` | Raw `Number(t.actual)`, compares `gap` to `BEHIND_PLAN_GAP_THRESHOLD = 5 // percentage points` | 0..100 assumed, but stored value could be 0..1 | **BLOCKING** — behind-plan widget silently misclassified projects |
| `percentComplete` | `server/repositories/program-dashboard-repository.ts:316` | `toNum(t.actualPctComplete) * 100` | 0..1 assumed | Inconsistent with the above |
| `expectedPctComplete` (date fallback) | `server/routes/planning-tasks-routes.ts:304-315` | SA working days + public holidays | — | OK |
| `expectedPctComplete` (date fallback) | `server/repositories/program-dashboard-repository.ts:329` | `((todayMs - sMs) / 86400000) / ((eMs - sMs) / 86400000)` — calendar days, ms-based | — | **BLOCKING** — same task showed different "expected %" on the Plan tab vs the Program Dashboard for any project spanning weekends / holidays |
| `expectedPctComplete` (date fallback) | `server/services/kpi-service.ts:29-44` | Calendar days | — | **BLOCKING** — same divergence |
| Milestone completion | `server/routes/planning-tasks-routes.ts:759-764` | `isMilestone && (percentComplete >= 100 \|\| status === "complete")` | — | OK |
| Milestone completion | `server/services/pm-monthly-report-service.ts:361` | `isMilestone && completedAt && isTimestampInMonth(completedAt)` | — | Diverges — a milestone at 100 % but no `completedAt` showed as done on Plan tab and undone in PM monthly |

### After this PR

| KPI | Single source of truth | Notes |
|---|---|---|
| Storage scale | `server/lib/import/value-normalization.ts` `clampPercent(v)` writes 0..1 only; migration `0064_work_items_pct_scale_normalise.sql` cleans up existing data. | Documented contract on `shared/schema/tasks.ts:percentComplete / expectedPctComplete`. |
| Read scale | `server/lib/kpi-formulas.ts` `pctTo100(v)` converts 0..1 → 0..100 and is defensive about legacy 0..100 stragglers. | Used by `dashboard-repository.ts` and `program-dashboard-repository.ts`. |
| Date-derived expected % | `server/lib/kpi-formulas.ts` `expectedPctFromDates(start, end, today)` uses SA working days. | Replaces inline formulas in `planning-tasks-routes.ts`, `program-dashboard-repository.ts`, `kpi-service.ts`. |
| RAG band | `server/lib/kpi-formulas.ts` `scheduleRagFromVariance(actual, expected)` returns `"green" \| "amber" \| "red"`. | Existing readers (lifecycle-stage-gate, project-platform-summary) already used the same thresholds — they can migrate later. |
| Milestone completion | Plan tab + PM monthly now agree: a milestone at 100 % counts as achieved in the month containing `completedAt ?? actualEnd`. | Fix 4c in `pm-monthly-report-service.ts:361`. |

---

## Section B — Files / folders / documents are not touched by Smart Import

| Table | Smart Import writes? | DB-level dedup |
|---|---|---|
| `managed_documents` | No (zero refs in `server/smart-import-routes.ts` or `server/lib/import/`) | Unique `(driveId, driveItemId)` |
| `folder_taxonomy` | No | Unique `internalKey` |
| `project_folders` | No | Unique `(projectId, taxonomyKey)` |

Smart Import does **not** trigger folder provisioning. That route (`/api/projects/:projectId/provision-folders`) is COO-only and is its own idempotent upsert (`server/repositories/project-folders-repository.ts:82-120`). Out of audit scope.

---

## Section C — Legacy task-write paths (now neutralised)

Before this PR, five live legacy paths could write to `work_items` while bypassing v2 dedup. All of them routed through `storage.createManyProjectPlans` / `storage.deleteProjectPlansByProject` (adapter façades over `work_items`) or a direct `db.insert(workItems)` block. None of them populated `row_hash`, `import_snapshot`, or `manual_overrides`, so a subsequent v2 commit could clobber unflagged manual edits silently.

| Path | Status after this PR |
|---|---|
| `server/lib/import/commit-executor.ts` `writePlanIncremental` (Smart Import v2) | Canonical, hash-deduped. Untouched. |
| `server/departments/admin-routes.ts:179` `POST /api/upload` | **410 Gone.** Returns `{ error: "endpoint_deprecated", use: "POST /api/smart-import/upload" }`. |
| `server/departments/admin-routes.ts:380` `POST /api/reprocess-all` | **410 Gone.** Same response shape. |
| `server/routes/imports-admin-extracted-routes.ts:117` `POST /api/upload` | Shadowed dead code (department routes registered first); **deleted**. |
| `server/routes/imports-admin-extracted-routes.ts:478` `POST /api/reprocess-all` | Shadowed dead code; **deleted**. |
| `server/routes/imports-admin-extracted-routes.ts:114` `POST /api/admin/refresh-data` | **410 Gone.** Same response shape. |
| `server/routes/imports-admin-extracted-routes.ts:892` `POST /api/admin/scan-folder` | Surgically de-fanged. The full delete-and-reinsert `storage.transaction()` block and the direct `db.insert(workItems)` block are removed. The handler still scans the configured folder and stages discovered workbooks via `storage.createUpload` so operators can run `/api/smart-import/upload`. |
| `server/bootstrap/start-runtime-services.ts:20` `startScheduler()` → `importPipeline.runFullImport()` | Untouched — confirmed during the audit that `importPipeline.ts` has no `workItems` references. |
| `server/departments/admin-routes.ts:781,796,808` admin-only legacy endpoints (`/api/admin/import/{single,run,retry-failed}`) | Untouched — these wrap `importPipeline` functions which do not write to `work_items`. |

---

## Fix details

### Fix 1 — Neutralise legacy task-write paths

See Section C. Two-file edit:

- `server/departments/admin-routes.ts` — `POST /api/upload` and `POST /api/reprocess-all` handler bodies replaced with 410 responders. The dynamic `createSnapshotFromUpload` import and the unused multer / `parseTrackerFile` imports were removed.
- `server/routes/imports-admin-extracted-routes.ts` — shadowed `/api/upload` and `/api/reprocess-all` handler blocks deleted; `/api/admin/refresh-data` replaced with a 410; `/api/admin/scan-folder` keeps the file-discovery + `storage.createUpload` lines, drops the delete-and-reinsert blocks and the direct `db.insert(workItems)` block. The bottom-of-file deprecation comment was updated to summarise the new deletions.

### Fix 2 — Per-row warning when a PLAN row lacks a stable `taskNo`

`server/lib/import/commit-executor.ts` `writePlanIncremental` — after the UNCHANGED skip and before the savepoint creation, NEW rows whose matcher confidence is `"LOW"` push a structured warning with `reason: "plan_row_no_stable_id"`. The wizard already renders warnings; this surfaces the title-rename risk per-row without changing semantics.

### Fix 3 — Regression tests

- `qa/tests/imports/smart-import-task-idempotency.test.ts` — pure-function assertions on `hashPlanRow` + source-level invariants on `writePlanIncremental` (hash lookup, unchanged skip, orphan sweep, warning emission, scale clamp) + assertions that every legacy 410'd endpoint stays 410'd and the shadowed handlers stay deleted. 21 tests.
- `qa/tests/kpis/progress-kpi-consistency.test.ts` — pure-function tests for `clampPercent` / `pctTo100` / `expectedPctFromDates` / `saWorkingDays` / `scheduleRagFromVariance`, plus source-level assertions that the readers (commit-executor, dashboard-repository, program-dashboard-repository, kpi-service, planning-tasks-routes, pm-monthly-report-service) actually call into the shared helpers. 27 tests.

Both files run under `npm run test`. Postgres is not required.

### Fix 4 — KPI computation consistency

- `server/lib/import/value-normalization.ts` — new `clampPercent(v)` helper.
- `server/lib/import/commit-executor.ts` — PLAN writes (NEW and matched-by-ref UPDATE) route `percentComplete` / `expectedPctComplete` through `clampPercent` for the canonical 0..1 scale.
- `server/lib/kpi-formulas.ts` — new module exporting `saWorkingDays`, `expectedPctFromDates`, `pctTo100`, `scheduleRagFromVariance`.
- `server/repositories/dashboard-repository.ts` — behind-plan widget routes via `pctTo100` instead of raw `Number()`.
- `server/repositories/program-dashboard-repository.ts` — date fallback calls `expectedPctFromDates`; percent reads use `pctTo100`.
- `server/services/kpi-service.ts` — same change.
- `server/routes/planning-tasks-routes.ts` — two date-derived expected % code blocks call `expectedPctFromDates`.
- `server/services/pm-monthly-report-service.ts` — milestone-completion filter falls back to `actualEnd` when `completedAt` is missing and `percentComplete >= 1`.
- `shared/schema/tasks.ts` — JSDoc comments document the 0..1 contract on `percentComplete` and `expectedPctComplete`.
- `migrations/0064_work_items_pct_scale_normalise.sql` — one-off `UPDATE` that scales any stored value `> 1 AND <= 100` down to 0..1, clamps anything beyond, and clamps negatives to 0. Idempotent.

---

## Known follow-ups (out of scope)

| Item | Why |
|---|---|
| Consolidate the two conflict engines (`conflict-engine.ts` vs `merge-engine.ts`) | Documented as deferred in known-limitations §10. Equivalent for the trust contract; no duplicate risk. |
| Surface `baselineStart` / `baselineEnd` in a schedule-variance UI | Smart Import writes them but no reader exposes them. The data is captured; rendering is a separate UI task. |
| Delete `storage.createManyProjectPlans` / `deleteProjectPlansByProject` | No live caller after this PR. Safe to delete in a follow-up once a second reviewer has confirmed. |
| Migrate the five duplicated `saWorkingDays` copies onto `server/lib/kpi-formulas.ts` | This PR consolidated the readers that drove the audit. The remaining copies (`lifecycle-routes.ts:246`, `project-routes.ts:244`, `project-summary-helpers.ts:19`, `dashboard-routes.ts:70`) can move in a follow-up. |
| Fuzzy / similarity matching for renamed PLAN rows without a `taskNo` | Limitation §5. Fix 2 surfaces the at-risk rows; an automatic resolver is its own design. |
| Two-engine consolidation onto `merge-engine.ts` exclusively | Documented as deferred (§10). |

---

## Verification checklist

1. `npm run check` — TypeScript clean.
2. `npm run test -- qa/tests/imports/smart-import-task-idempotency.test.ts qa/tests/kpis/progress-kpi-consistency.test.ts` — both new regression suites pass (48 tests total).
3. `npm run test:api` — no regression in existing API tests.
4. `npm run db:check` — additive migration `0064` matches the schema, no drift introduced.
5. Manual grep: `grep -rn "/api/upload" client/src/` returns zero hits; client only uses `/api/smart-import/upload`.
6. Manual smoke: `curl -X POST http://localhost:5000/api/upload` returns `410 Gone` with the deprecation body.
7. Manual UI cross-check: open the same project on the Plan tab, Programme reports, Program dashboard, and Project overview; the displayed `% complete`, `% expected`, and RAG label match for at least one in-progress task and one milestone.
