# SMART IMPORT SCENARIO TESTS

**Date:** 2026-03-19
**Scope:** End-to-end Smart Import feature — upload through commit/rollback
**Source Files:** `client/src/pages/smart-import.tsx`, `server/smart-import-routes.ts`, `server/lib/import/normalizer.ts`

---

## Architecture Overview

Smart Import is a 5-step wizard:
1. **Upload** — Drag-and-drop .xlsx/.xlsm file; SHA-256 hash computed; duplicate detection
2. **Sections** — Auto-detects PLAN, REVENUE, EXPENDITURE sections; extracts project metadata
3. **Mapping** — Column-to-canonical-field mapping with confidence badges (<50% red, 50-80% amber, >80% green)
4. **Issues** — Displays BLOCKER/WARNING/INFO severity issues; user resolves via Accept/Override/Ignore
5. **Commit** — Writes to `normalized_revenue_lines`, `normalized_cost_lines`, `work_items` + legacy `program_inflows`, `program_expense`

---

## Scenario Tests

### SC-01: Valid Import File

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Standard Emergent template .xlsx with Plan, Revenue Tracking, and Expenditure Breakdown sheets; all required columns present; clean data |
| **Expected Behavior** | All 5 steps complete without blockers. Sections auto-detected. Mapping confidence >80% for known columns. Zero BLOCKER issues |
| **Actual Behavior (Code Analysis)** | Upload computes SHA-256 hash (`smart-import-routes.ts:334`). Detector identifies sections by sheet name pattern matching. Normalizer parses dates, amounts, font colors. Commit inserts into normalized_* tables + legacy tables |
| **Database Impact** | New rows in: `smart_import_runs` (status=COMMITTED), `normalized_revenue_lines`, `normalized_cost_lines`, `work_items`, `work_item_assignments`, `work_item_dependencies`, `program_inflows`, `program_expense` |
| **Reporting Impact** | Revenue/COS/GP trackers immediately reflect new data. Project detail KPIs updated on next query fetch |
| **User Message Quality** | Commit summary shows records attempted/succeeded/failed counts |
| **Admin Can Recover** | Yes — via rollback (removes normalized_* and work_items) or re-import |
| **Status** | PROVEN (code path fully traced) |

---

### SC-02: File with Missing Required Columns

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | .xlsx with Revenue sheet missing "Milestone Amount" column |
| **Expected Behavior** | Section detected but mapping step shows unmapped required fields. BLOCKER issues raised for missing critical fields |
| **Actual Behavior (Code Analysis)** | Mapping step (`smart-import-routes.ts:911-1051`) allows user to manually map or leave unmapped. Unmapped required fields generate BLOCKER-severity issues. Commit blocked until all BLOCKERs resolved |
| **Database Impact** | None until commit. PREVIEW run stored in `smart_import_runs` |
| **Reporting Impact** | None — data not committed |
| **User Message Quality** | Issue cards show "Required field not mapped" with field name and section |
| **Admin Can Recover** | N/A — no data written |
| **Status** | PROVEN |

---

### SC-03: File with Wrong Headers

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | .xlsx where column headers don't match expected canonical names (e.g., "Cost Total" instead of "Budget Total") |
| **Expected Behavior** | Mapping step shows low confidence scores. User can manually re-map columns |
| **Actual Behavior (Code Analysis)** | Normalizer uses fuzzy matching for header-to-canonical mapping. Unrecognized headers get confidence <50% (red badge). User can use dropdown to manually assign canonical field. `PATCH /api/smart-import/:runId/mapping` saves user corrections |
| **Database Impact** | None until user fixes mapping and commits |
| **Reporting Impact** | None until commit |
| **User Message Quality** | Confidence badges clearly indicate match quality (red/amber/green). Unmapped headers listed separately |
| **Admin Can Recover** | N/A — interactive correction before commit |
| **Status** | PROVEN |

---

### SC-04: File with Blank Required Values

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Valid headers but some rows have blank milestone amounts, blank task names, or blank dates |
| **Expected Behavior** | Issues raised for blank required fields. User can override with values, skip rows, or ignore |
| **Actual Behavior (Code Analysis)** | Normalizer detects blank required values during parsing. Issues created with severity WARNING or BLOCKER depending on field criticality. Resolution options: IGNORE, OVERRIDE (provide replacement value), SKIP_ROW |
| **Database Impact** | Rows with SKIP_ROW resolution excluded from commit. OVERRIDE values used for committed rows |
| **Reporting Impact** | Only clean/overridden rows affect reporting |
| **User Message Quality** | Each issue shows row number, field name, and current value |
| **Admin Can Recover** | Yes — re-import with corrected file |
| **Status** | PROVEN |

---

### SC-05: Duplicate Rows

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Same line item appears twice in Expenditure sheet |
| **Expected Behavior** | Duplicate detection raises WARNING issue |
| **Actual Behavior (Code Analysis)** | Normalizer creates `inflow_line_hash` / `expense_line_hash` for content-based dedup. Duplicate rows generate issues. User can skip duplicates or accept both |
| **Database Impact** | If both accepted, both rows written (user's choice) |
| **Reporting Impact** | Could double-count if user accepts both — WARNING shown |
| **User Message Quality** | Issue identifies duplicate pair with row numbers |
| **Admin Can Recover** | Yes — rollback and re-import, or manually edit via COS/Revenue tabs |
| **Status** | PROVEN |

---

### SC-06: Duplicate Project References

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | File name suggests project "Solar Alpha" but project "Solar Alpha Phase 2" already exists |
| **Expected Behavior** | Project matching algorithm surfaces matches with confidence scores |
| **Actual Behavior (Code Analysis)** | Matching algorithm (`smart-import-routes.ts:81-160`) uses multi-tier matching: exact normalized match (1.0), case-insensitive (1.0), phase-aware (0.7), token-based, prefix, substring. Top 5 matches returned. Phase numbers preserved to distinguish multi-phase projects |
| **Database Impact** | None until user selects correct project match or confirms new project creation |
| **Reporting Impact** | If wrong project selected, data appears under wrong project |
| **User Message Quality** | Match list with confidence scores and match reasons. Manual override available via `/api/smart-import/:runId/assign-project` |
| **Admin Can Recover** | Yes — rollback + re-import with correct assignment |
| **Status** | PROVEN |

---

### SC-07: Invalid Project References

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | File references a project name that doesn't exist in the system at all |
| **Expected Behavior** | No matches found; user prompted to create new project or manually assign |
| **Actual Behavior (Code Analysis)** | If no matches ≥0.5 confidence, commit logic auto-creates project (`smart-import-routes.ts:1594-1604`) with phase="PLANNING" and extracted metadata. If matches exist but are duplicates, `confirmNewProject` flag required to force creation |
| **Database Impact** | New `project_info` row created with phase="PLANNING" |
| **Reporting Impact** | New project appears in project list and dashboards |
| **User Message Quality** | Commit step shows project creation intent. User can cancel before commit |
| **Admin Can Recover** | Yes — project can be archived/deactivated via admin |
| **Status** | PROVEN |

---

### SC-08: Partial Valid / Partial Invalid Rows

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Mix of clean rows, rows with Excel formula errors (#REF!), and rows with date swaps |
| **Expected Behavior** | Valid rows importable; invalid rows get issues; user selects per-row resolution |
| **Actual Behavior (Code Analysis)** | Normalizer detects Excel errors (`normalizer.ts:177-194`) — replaces #REF!, #DIV/0!, etc. with null + creates WARNING. Date swaps detected and flagged. Per-issue resolution: IGNORE, OVERRIDE, SKIP_ROW. Commit only includes rows without SKIP_ROW |
| **Database Impact** | Only resolved/accepted rows written. `records_attempted` vs `records_succeeded` vs `records_failed` tracked |
| **Reporting Impact** | Partial import — only committed rows affect reporting |
| **User Message Quality** | Clear per-row issue display with severity badges. Bulk actions available (Apply Prior Resolutions, Ignore All, Allow All) |
| **Admin Can Recover** | Yes — fix source file and re-import |
| **Status** | PROVEN |

---

### SC-09: Overwrite / Re-Import Behavior

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Same project file imported again after initial successful commit |
| **Expected Behavior** | System detects re-import via file hash; warns about existing data; full replace on commit |
| **Actual Behavior (Code Analysis)** | Upload phase: SHA-256 hash check returns `rerunWarning` with existing run details (`smart-import-routes.ts:162-176`). Timestamp check: if file older than last committed, HTTP 409 `error_import_older_than_existing` (force_commit override). Commit: **FULL REPLACE** — deletes all `normalized_*` rows + `work_items` (source=SMART_IMPORT) for project before inserting new data (`smart-import-routes.ts:1694-1701`) |
| **Database Impact** | All existing normalized data for project replaced. Manual edits may be preserved if `preserveManualEdits=true` |
| **Reporting Impact** | Complete data refresh — reports reflect new file data |
| **User Message Quality** | Re-import warning with previous run details. Manual edit conflict detection with per-field resolution |
| **Admin Can Recover** | Yes — rollback or re-import again |
| **Status** | PROVEN |

---

### SC-10: Admin Correction Flow After Import Issue

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Import committed but user realizes a cost line has wrong supplier name |
| **Expected Behavior** | Admin can edit the cost line via COS/Expenditure tab |
| **Actual Behavior (Code Analysis)** | `ExpenditureEditableTab` allows inline editing of committed rows. Manual edits create `changeSets` with source="MANUAL_EDIT". On next re-import, manual edits detected and conflict resolution presented |
| **Database Impact** | Manual edit stored alongside import data. Next import preserves edits if user chooses `preserveManualEdits=true` |
| **Reporting Impact** | Manual correction immediately reflected in COS tracker |
| **User Message Quality** | Inline editing with save confirmation |
| **Admin Can Recover** | Yes — direct UI editing available |
| **Status** | PROVEN |

---

### SC-11: Downstream Reporting After Successful Import

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Clean file successfully committed |
| **Expected Behavior** | Revenue tracker, COS tracker, GP tracker, Cashflow, Project Detail KPIs all reflect imported data |
| **Actual Behavior (Code Analysis)** | Data written to both normalized_* tables (new canonical) and legacy `program_inflows`/`program_expense` tables. Reporting endpoints query from these tables. Project detail KPIs computed client-side from `/api/revenue-tab`, `/api/expenditure-breakdown`, `/api/program-inflows`, `/api/program-expenses` |
| **Database Impact** | Dual-write ensures both old and new reporting paths get data |
| **Reporting Impact** | All financial tabs updated. KPI header shows updated revenue realised %, COS realised %, margin delta |
| **User Message Quality** | No explicit "reporting updated" notification — data appears on refresh |
| **Admin Can Recover** | N/A — successful path |
| **Status** | PROVEN |

---

### SC-12: Downstream Reporting After Failed Import

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | Import fails mid-commit (e.g., database constraint violation) |
| **Expected Behavior** | No data written; reporting unchanged |
| **Actual Behavior (Code Analysis)** | Commit is NOT wrapped in a single database transaction for all tables. Individual inserts may partially succeed. Run status set to FAILED on error. **GAP:** If failure occurs after deleting existing data but before inserting new data, project data may be temporarily empty |
| **Database Impact** | Partial writes possible. `records_failed` counter tracks which rows failed |
| **Reporting Impact** | **RISK:** If delete-before-insert succeeds but insert fails, reporting shows empty data until re-import |
| **User Message Quality** | Error message returned. Run marked as FAILED |
| **Admin Can Recover** | Re-import from same or corrected file. No automatic recovery from partial failure |
| **Status** | PARTIALLY PROVEN — partial failure recovery gap identified |

---

### SC-13: Import of Planning Tasks into Canonical work_items Path

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | File with PLAN section containing task hierarchy |
| **Expected Behavior** | Tasks written to `work_items` table with parent-child relationships, dependencies, and assignments |
| **Actual Behavior (Code Analysis)** | Commit logic (`smart-import-routes.ts:1753-1882`) inserts into `work_items` with `source="SMART_IMPORT"`, `workstream="PM"`. Hierarchy built via `parentTaskNo → parentId` mapping. Owner names tracked via `existingTaskOwners` map. Dependencies via `work_item_dependencies`. Assignments via `work_item_assignments` with role=OWNER |
| **Database Impact** | `work_items`, `work_item_assignments`, `work_item_dependencies` populated. Feature flag `canonical_work_items_v1` may gate visibility |
| **Reporting Impact** | Plan tasks appear in Unified Plan Tab (Gantt). Progress tracked via `percentComplete` |
| **User Message Quality** | Commit summary shows task count. Plan tab shows imported tasks with hierarchy |
| **Admin Can Recover** | Yes — rollback removes work_items with importRunId match |
| **Status** | PROVEN |

---

### SC-14: Import of Cost Data into normalized_cost_lines

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | File with EXPENDITURE section |
| **Expected Behavior** | Cost lines written to `normalized_cost_lines` with counterparty linking, status derivation, and font color interpretation |
| **Actual Behavior (Code Analysis)** | Normalizer extracts: cost_category, counterparty_name, budget amounts, actual amounts, PO number, invoice details. Font color analysis (`normalizer.ts:221-283`): black font (hex < 0x282828) = confirmed dates. Status derived from invoice/payment date presence. Counterparty linking via `counterpartyMap`. Also dual-writes to `program_expense` for legacy compatibility |
| **Database Impact** | `normalized_cost_lines` (canonical) + `program_expense` (legacy) both populated |
| **Reporting Impact** | COS tracker, GP tracker, expenditure breakdown all updated |
| **User Message Quality** | Mapping step shows expenditure field assignments. Issue step flags unknown counterparties |
| **Admin Can Recover** | Yes — rollback + re-import, or inline edit via ExpenditureEditableTab |
| **Status** | PROVEN |

---

### SC-15: Import of Revenue Data into normalized_revenue_lines

| Aspect | Detail |
|--------|--------|
| **Source File Condition** | File with REVENUE section containing milestones |
| **Expected Behavior** | Revenue milestones written to `normalized_revenue_lines` with in_bank status preservation |
| **Actual Behavior (Code Analysis)** | Commit logic (`smart-import-routes.ts:1884-1995`): inserts into `normalized_revenue_lines`. "In bank" status preserved via composite key matching (`milestoneName::amount`). Falls back to row number matching if composite match fails. Also dual-writes to `program_inflows`. Invoice date font color analysis determines confirmation status |
| **Database Impact** | `normalized_revenue_lines` (canonical) + `program_inflows` (legacy) both populated |
| **Reporting Impact** | Revenue tracker, inflows tab, KPI header (revenue realised %) all updated |
| **User Message Quality** | In-bank preservation shown in commit diff preview |
| **Admin Can Recover** | Yes — rollback + re-import, or inline edit via RevenueTrackingTab |
| **Status** | PROVEN |

---

## Summary

| Scenario | Status |
|----------|--------|
| SC-01: Valid import | PROVEN |
| SC-02: Missing columns | PROVEN |
| SC-03: Wrong headers | PROVEN |
| SC-04: Blank required values | PROVEN |
| SC-05: Duplicate rows | PROVEN |
| SC-06: Duplicate project refs | PROVEN |
| SC-07: Invalid project refs | PROVEN |
| SC-08: Partial valid/invalid | PROVEN |
| SC-09: Re-import overwrite | PROVEN |
| SC-10: Admin correction | PROVEN |
| SC-11: Reporting after success | PROVEN |
| SC-12: Reporting after failure | **PARTIALLY PROVEN** |
| SC-13: Plan → work_items | PROVEN |
| SC-14: Cost → normalized_cost_lines | PROVEN |
| SC-15: Revenue → normalized_revenue_lines | PROVEN |

### Open Risks

1. **SC-12: Partial failure during commit** — delete-then-insert pattern without full transaction wrapping means partial data loss is possible on mid-commit failure
2. **Rollback does not revert legacy tables** — `program_expense` and `program_inflows` rows survive rollback, causing potential data inconsistency between canonical and legacy paths
3. **Manual edit preservation complexity** — 7+ conflict types during re-import; user must understand each to avoid losing manual corrections

### Smart Import Overall Rating: PARTIALLY PROVEN

The feature is well-designed and handles most scenarios correctly. The partial failure gap (SC-12) and incomplete rollback (legacy table retention) prevent a "PROVEN READY" rating.
