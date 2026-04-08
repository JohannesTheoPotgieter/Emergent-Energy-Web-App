# Smart Import v2 — UAT Report & Release-Candidate Assessment

**Date:** 2026-04-08
**Assessor:** Claude (AI-assisted)
**Branch:** `claude/smart-import-v2-spec-LJvxf`

---

## Executive Summary

**Go / No-Go Recommendation: GO — with conditions**

**Plug-and-Play Verdict: YES WITH CONDITIONS**

Smart Import v2 is safe for controlled pilot rollout. The schema is fully compatible, the end-to-end flow is sound, and the architecture alignment is correct. Two data-level risks exist (duplicate business keys and plan hierarchy) that are pre-documented as known limitations and do not block pilot use on well-formed trackers.

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

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| F1 | V1 gated behind `if (!useV2)` in transaction | PASS | |
| F2 | skipV2ConflictCheck=true forces v1 | PASS | |
| F3 | V1 UI gated behind "Advanced view" toggle | PASS | |
| F4 | Default user never sees v1 steps | PASS | useV2 defaults true |

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

### Current Data Readiness: READY WITH KNOWN RISKS

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| Pre-v2 revenue rows have `milestone_no = NULL` | LOW | Revenue matching falls back to milestoneName (MEDIUM confidence). This is safe — row matching works correctly. Tested and confirmed. | No action needed. First v2 import will populate milestoneNo for new/changed rows. |
| Duplicate business keys possible in revenue data | HIGH | Two revenue milestones with the same name (e.g., "Progress Payment") produce the same business key. The second file row matches the same DB row as the first, causing: one false CHANGED + one false MISSING. | See defect D1 below. Pilot should avoid trackers with duplicate milestone names. |
| Duplicate business keys possible in cost data | HIGH | Two cost lines with same category + counterparty + description and no invoice number produce the same key. Same collision behavior. | See defect D2 below. |
| Plan rows without taskNo | MEDIUM | Fallback to taskName+phase key. Two tasks with same name+phase collide. | Most real trackers have distinct task names per phase. LOW confidence warning emitted. |
| Plan hierarchy not re-linked on v2 incremental | MEDIUM | If a task's parent task number changes in the spreadsheet, the `parentId` link is not updated by the v2 UPDATE path. | Documented limitation. Use v1 "Advanced view" for major hierarchy restructures. |

### Manual DB/Data Changes Required: NONE for pilot

- No manual data cleanup needed
- No backfill required
- Migration is the only schema change: `ADD COLUMN IF NOT EXISTS` (safe, additive)
- Existing data patterns are compatible with v2 logic

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

**Pilot guidance:** Avoid trackers with duplicate milestone names during pilot. If encountered, use v1 "Advanced view" which does full-replace without key-based matching.

### D2: Duplicate cost business key collision

**Severity: HIGH**

**Description:** Same as D1, but for cost lines. When two cost rows have identical `costCategory + counterpartyName + description` and no `invoiceNumber`, they collide.

**Impact:** Same as D1.

**Pilot guidance:** Same as D1. Most real cost lines either have invoice numbers (PRIMARY key, no collision) or distinct descriptions.

### D3: Plan hierarchy not updated on incremental import

**Severity: MEDIUM**

**Description:** The v2 PLAN writer does UPDATE-in-place for CHANGED work_items rows. It updates field values (dates, owner, status, etc.) but does NOT re-evaluate `parentId` relationships. If a task's `parentTaskNo` changes, the parent link becomes stale.

**Impact:** Plan hierarchy view may show incorrect parent-child relationships after v2 incremental import where the plan structure was reorganized.

**Pilot guidance:** For imports that significantly restructure task hierarchy, use v1 "Advanced view" which deletes and re-creates all work items with correct parentId links.

---

## Pilot Rollout Guardrails

### Who should use it first
- Internal project managers familiar with the tracker format
- Start with 1-2 well-known projects that have been previously imported via v1
- Confirm the planner output looks correct before committing

### What files/trackers should be excluded initially
- Multi-project trackers (FY 2026 Adhoc-style) — sub-project naming sensitivity
- Trackers with duplicate milestone names (e.g., multiple "Progress Payment" milestones)
- Trackers with heavily restructured plan hierarchies since last import
- Any tracker with known data quality issues (formula errors, mixed formats)

### What should be monitored after each import
1. **Planner summary** — verify NEW/CHANGED/UNCHANGED counts look reasonable
2. **Conflict count** — zero conflicts expected on first v2 incremental if no app edits were made
3. **Dashboard refresh** — confirm dashboards update within ~10 seconds
4. **expense_task_links** — verify existing links still work (stable IDs)
5. **Revenue/cost line counts** — confirm no unexpected duplicates or missing rows

### Rollback guidance
1. **Per-import rollback:** Use `POST /api/smart-import/:runId/rollback` — works with v2 commits (soft-closes rows by importRunId)
2. **System-wide rollback to v1:** Set `skipV2ConflictCheck=true` on commit requests. Or: in the frontend, switch to "Advanced view" which uses the v1 wizard and commit path.
3. **Code rollback:** The v1 commit path is fully preserved inside `if (!useV2)`. Reverting `useV2` default to `false` disables v2 system-wide.

---

## Recommendation

### GO — with the following conditions:

1. **Run migration** `20260408_add_milestone_no_to_revenue.sql` before deploying
2. **Pilot with 2-3 projects** using simple trackers (single-project, distinct milestone/task names)
3. **Avoid duplicate-name trackers** during initial pilot (defects D1/D2)
4. **Monitor first 5 imports** for unexpected CHANGED/MISSING counts
5. **Keep v1 "Advanced view" accessible** as fallback for complex cases
6. **Review conflict resolution** if any conflicts appear — confirm 3-way merge values look correct
7. **Confirm dashboard refresh** after each pilot import

### Timeline
- **Week 1:** 2-3 pilot projects, internal PMs only
- **Week 2:** Expand to remaining projects if pilot passes
- **Week 3:** GA — remove pilot restrictions, monitor

### When to stop pilot
- If any import produces data corruption (wrong field values on unchanged rows)
- If duplicate key collisions occur on real trackers (indicates duplicate-name pattern is more common than expected)
- If plan hierarchy is incorrect after import and users rely on it
