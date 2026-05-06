# Smart Import v2 — UAT Report & Release-Candidate Assessment

**Date:** 2026-04-08
**Assessor:** Claude (AI-assisted)
**Branch:** `claude/smart-import-v2-spec-LJvxf`

> **2026-04-18 update:** The v1 fallback path and the `emergencyV1Mode` /
> `skipV2ConflictCheck` opt-out flags referenced throughout this report have
> since been removed. v2 is now the only commit path. Any historical
> recommendation to "route projects to v1 fallback" or "switch to Advanced view"
> no longer applies — those projects must instead resolve duplicate business
> keys (see `docs/smart-import-v2-known-limitations.md`) or be rolled back at
> the release-tag level.

---

## Executive Summary

**Go / No-Go Recommendation: GO — with conditions (updated with live DB data)**

**Plug-and-Play Verdict: YES WITH CONDITIONS**

Smart Import v2 is safe for controlled pilot rollout on projects WITHOUT duplicate business keys. The migration must be applied first. Of 62 imported projects, 9 (15%) have duplicate revenue keys and 17 (27%) have duplicate cost keys. These projects must use the v1 "Advanced view" fallback until the duplicate key issue is resolved.

> **Live database inspected:** 2026-04-08 via Neon SQL console.
> Previous assessments (Phases 1-8) were code-only. This is the first real data verification.

---

## Tested Scenarios

### Upload Flow

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| U1 | Single .xlsx file upload | PASS | Same `POST /api/smart-import/upload` endpoint, unchanged from v1 |
| U2 | Single .xlsm file upload | PASS | Same parser handles both extensions |
| U3 | Multiple file upload | PASS | Each file creates its own import run; batch panel still works |
| U4 | Folder upload | PASS | `webkitdirectory` input filters to .xlsx/.xlsm, same upload loop |
| U5 | File/folder parity | PASS | Both hit the same `handleUpload()` → `POST /upload` → `loadPlannerData()` path |

### Baseline Import (first import for a project)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| B1 | No prior COMMITTED runs → BASELINE mode | PASS | `detectImportMode()` returns BASELINE when no committed runs exist |
| B2 | All rows classified as NEW | PASS | `buildBaselinePlan()` sets all rows to NEW |
| B3 | No conflict engine runs on baseline | PASS | `conflicts: null` returned |
| B4 | milestoneNo/milestonePercent preserved in revenue insert | PASS | Commit handler includes these fields |

### Incremental Import

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| I1 | Identical file re-import → all UNCHANGED | PASS | Tested with row-matcher: identical rows produce UNCHANGED |
| I2 | Changed field → CHANGED classification | PASS | Only changed fields reported |
| I3 | New row → NEW classification | PASS | |
| I4 | Missing row → MISSING_FROM_UPLOAD, row preserved | PASS | Not deleted or soft-closed |
| I5 | Pre-v2 rows without milestoneNo → still matches by name | PASS | Tested: file has milestoneNo, DB doesn't → UNCHANGED (matching uses milestoneName) |

### 3-Way Conflict Detection

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| C1 | Upload changed, app did not → AUTO_ACCEPT_FILE | PASS | |
| C2 | App changed, upload did not → KEEP_APP | PASS | |
| C3 | Both changed differently → CONFLICT | PASS | |
| C4 | Upload blank, app edited → KEEP_APP | PASS | |
| C5 | All same → UNCHANGED | PASS | |
| C6 | Unresolved conflicts → HTTP 409 blocks commit | PASS | |
| C7 | v2ConflictResolutions accepted → commit proceeds | PASS | |

### Commit & Result

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| CM1 | V2 path active by default (useV2 = true) | PASS | |
| CM2 | Unchanged rows not rewritten | PASS | `counts.unchanged++; continue;` |
| CM3 | New rows inserted to canonical table | PASS | |
| CM4 | Changed rows: PLAN updated in-place, REVENUE/COST soft-close+replace | PASS | |
| CM5 | App-owned fields carried forward on replacement | PASS | adminDateOverride, cosRealised, etc. |
| CM6 | Run marked COMMITTED | PASS | |
| CM7 | Response includes v2 details (totalInserted/Updated/Unchanged/Missing) | PASS | |
| CM8 | refreshProjectMetricsAsync fires after commit | PASS | Outside if-block, fires for both paths |
| CM9 | Post-commit message is honest about dashboard refresh | PASS | "Dashboard summaries may take a moment to update." |

### V1 Fallback Isolation

_Superseded:_ the v1 full-replace commit path and the `emergencyV1Mode` /
`skipV2ConflictCheck` opt-out flags have been removed. v2 is the only commit
path, and commits fail fast with `project_id_missing` when `project_info.id`
is not resolved before commit.

---

## Database and Data Compatibility Verdict

### Schema Readiness: READY

All Drizzle schema definitions match v2 code requirements:

| Table | Status | Notes |
|-------|--------|-------|
| `normalized_revenue_lines` | READY | `milestone_no` and `milestone_percent` columns defined. Migration exists (`20260408_add_milestone_no_to_revenue.sql`). Uses `IF NOT EXISTS` for safety. |
| `normalized_cost_lines` | READY | All temporal columns, app-owned fields (cosRealised, noRevenueLinked, adminDateOverride, etc.) present. |
| `work_items` | READY | `source`, `workstream`, `wbs_code`, `sub_project_name`, `deleted_at`, `import_run_id`, `external_ref` all present. |
| `smart_import_runs` | READY | `project_id`, `status`, `summary_json`, `committed_at`, `import_type`, `source_file_hash` all present. |
| `conflict_resolution_log` | READY | All required audit columns present. |

**Action required before pilot:** Run migration `20260408_add_milestone_no_to_revenue.sql` on the target database. This is a safe additive-only change (no data modification, no destructive operations).

### Current Data Readiness: READY WITH CONDITIONS

**Live database queried on 2026-04-08. Real numbers below.**

| Risk | Severity | Live data finding | Mitigation |
|------|----------|-------------------|------------|
| Migration not applied | **BLOCKER** | `milestone_no` and `milestone_percent` columns do NOT exist on `normalized_revenue_lines` yet. | **Apply migration before deployment.** Safe additive change. |
| Duplicate revenue keys | **HIGH** | **9 of 62 projects (15%)** have 16 groups of duplicate milestone names, 23 extra colliding rows. | These 9 projects must use v1 "Advanced view" during pilot. |
| Duplicate cost keys | **HIGH** | **17 of 62 projects (27%)** have 30 groups of duplicate cost line keys (no invoice, same desc+category+counterparty), 99 extra colliding rows. | These 17 projects must use v1 "Advanced view" during pilot. |
| Plan rows without taskNo | LOW | **37 of 2,694 plan rows (1.4%)** have no task number. | Acceptable. LOW confidence warnings will be emitted. |
| Baseline JSON integrity | PASS | All 62 projects with commits have valid `summaryJson` with normalization data. 3-way merge baselines are complete. | No action needed. |
| Pre-v2 revenue milestoneNo | Expected | All revenue rows have `milestone_no = NULL` (column doesn't exist yet). | First v2 import after migration will populate it. |
| Plan hierarchy re-linking | MEDIUM | Not done by v2 incremental path. | Use v1 "Advanced view" for major plan restructures. |

### Manual DB/Data Changes Required Before Pilot

1. **REQUIRED:** Apply migration `20260408_add_milestone_no_to_revenue.sql`:
   ```sql
   ALTER TABLE normalized_revenue_lines
     ADD COLUMN IF NOT EXISTS milestone_no TEXT,
     ADD COLUMN IF NOT EXISTS milestone_percent NUMERIC(6,4);
   ```
2. **RECOMMENDED:** Identify the 9+17 affected projects (see queries in `docs/smart-import-v2-live-db-checklist.md`) and ensure operators use v1 "Advanced view" for those projects during pilot.

### Safe v2 Pilot Scope

Of 62 imported projects:
- **~36 projects (58%)** have NO duplicate key issues → safe for v2 pilot immediately after migration
- **~9 projects** have revenue key duplicates → use v1 fallback
- **~17 projects** have cost key duplicates → use v1 fallback
- (Some overlap likely between revenue and cost duplicate lists)

---

## Defects Found

### D1: Duplicate revenue business key collision

**Severity: HIGH**

**Description:** When two revenue milestones in the same file have identical `milestoneName` (and no `milestoneNo` to distinguish them), both produce the same business key. The row-matcher's `Map` lookup causes the second file row to match the same existing DB row as the first, resulting in:
- Row 1: classified correctly (UNCHANGED or CHANGED)
- Row 2: classified as CHANGED (wrongly comparing against row 1's DB match)
- Actual DB row 2: never matched → reported as MISSING_FROM_UPLOAD

**Impact:** False CHANGED classification on row 2; false MISSING on the actual second DB row. If committed, row 2 gets incorrect field updates.

**Current mitigation:** Planner emits LOW/MEDIUM confidence warnings. Known limitation documented.

**Live finding:** 9 of 62 projects affected. 16 collision groups, 23 extra rows.

**Pilot guidance:** These 9 projects must use v1 "Advanced view" during pilot. Use the query in `docs/smart-import-v2-live-db-checklist.md` Check 5 to get the exact project list.

### D2: Duplicate cost business key collision

**Severity: HIGH**

**Description:** Same as D1, but for cost lines. When two cost rows have identical `costCategory + counterpartyName + description` and no `invoiceNumber`, they collide.

**Impact:** Same as D1.

**Live finding:** 17 of 62 projects affected. 30 collision groups, 99 extra rows. This is the most significant risk — over a quarter of projects.

**Pilot guidance:** These 17 projects must use v1 "Advanced view" during pilot.

### D3: Plan hierarchy not updated on incremental import

**Severity: MEDIUM**

**Description:** The v2 PLAN writer does UPDATE-in-place for CHANGED work_items rows. It updates field values (dates, owner, status, etc.) but does NOT re-evaluate `parentId` relationships. If a task's `parentTaskNo` changes, the parent link becomes stale.

**Impact:** Plan hierarchy view may show incorrect parent-child relationships after v2 incremental import where the plan structure was reorganized.

**Pilot guidance:** For imports that significantly restructure task hierarchy, use v1 "Advanced view" which deletes and re-creates all work items with correct parentId links.

---

## Pilot Rollout Guardrails

### Pre-deployment steps (required)
1. Apply migration: `ALTER TABLE normalized_revenue_lines ADD COLUMN IF NOT EXISTS milestone_no TEXT, ADD COLUMN IF NOT EXISTS milestone_percent NUMERIC(6,4);`
2. Run Check 5 and Check 6 from `docs/smart-import-v2-live-db-checklist.md` to get the exact list of affected project IDs
3. Communicate to operators: those projects must use "Advanced view" during pilot

### Who should use it first
- Internal project managers familiar with the tracker format
- Start with 2-3 projects that are NOT in the duplicate-key affected list
- Confirm the planner output looks correct before committing

### What projects must be excluded from v2 pilot
- The 9 projects with duplicate revenue milestone names (from Check 5)
- The 17 projects with duplicate cost line keys (from Check 6)
- These projects should continue using "Advanced view" (v1) until the duplicate key issue is resolved
- Multi-project trackers (FY 2026 Adhoc-style) — sub-project naming sensitivity
- Trackers with heavily restructured plan hierarchies since last import

### What should be monitored after each import
1. **Planner summary** — verify NEW/CHANGED/UNCHANGED counts look reasonable
2. **Conflict count** — zero conflicts expected on first v2 incremental if no app edits were made
3. **Dashboard refresh** — confirm dashboards update within ~10 seconds
4. **expense_task_links** — verify existing links still work (stable IDs)
5. **Revenue/cost line counts** — confirm no unexpected duplicates or missing rows

### Rollback guidance
1. **Per-import rollback:** Use `POST /api/smart-import/:runId/rollback` — works with v2 commits (soft-closes rows by importRunId)
2. **System-wide rollback:** Revert to the prior release tag. There is no in-app flag to re-enable v1; the `emergencyV1Mode` / `skipV2ConflictCheck` opt-out paths have been deleted.

---

## Recommendation (updated with live data)

### GO — with the following conditions:

1. **REQUIRED: Apply migration** before deploying:
   ```sql
   ALTER TABLE normalized_revenue_lines
     ADD COLUMN IF NOT EXISTS milestone_no TEXT,
     ADD COLUMN IF NOT EXISTS milestone_percent NUMERIC(6,4);
   ```
2. **REQUIRED: Identify affected projects** — run Check 5 + Check 6 from `docs/smart-import-v2-live-db-checklist.md` to get exact project IDs
3. **Pilot with projects NOT on the affected list** (~36 of 62 projects are clean and safe for v2)
4. **Route affected projects to "Advanced view"** (v1 fallback) — 9 with revenue collisions, 17 with cost collisions
5. **Monitor first 5 v2 imports** — verify NEW/CHANGED/UNCHANGED counts look reasonable
6. **Confirm dashboard refresh** after each pilot import

### Timeline
- **Week 1:** Apply migration. Pilot with 2-3 clean projects, internal PMs only.
- **Week 2:** Expand to all clean projects (~36) if pilot passes.
- **Week 3+:** Investigate duplicate key resolution for the remaining ~26 affected projects.

### When to stop pilot
- If any v2 import produces data corruption (wrong field values on unchanged rows)
- If a "clean" project's uploaded tracker itself has duplicate milestone/cost names
- If plan hierarchy is incorrect after import and users rely on it

### Path to full GA (all 62 projects)
The 27% of projects with duplicate cost keys is the main barrier. Options to resolve:
1. **Add sourceRow as tiebreaker** when business keys collide (positional within a section)
2. **Add a dedup pre-check** that warns operators when duplicate keys are detected
3. **Accept v1 fallback** for those projects permanently (least effort, fragments experience)
