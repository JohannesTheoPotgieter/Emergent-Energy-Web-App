# Smart Import v2 — Implementation Specification

> **Status:** IMPLEMENTED (Option D landed 2026-04-29 on branch
> `claude/replicate-imported-sheets-DS6BD`).
> **Created:** 2026-04-08
> **Last updated:** 2026-04-29
> **Authors:** Claude (AI-assisted), pending human review
> **Scope:** This document originally specified the target behaviour;
> the 2026-04-29 release wires the spec into runtime. Sections marked
> "implemented" describe live behaviour; sections marked "deferred"
> describe what's intentionally out of scope until a follow-up PR.

> ## Implementation summary (2026-04-29)
>
> | Section | Status | Notes |
> |---|---|---|
> | Stable hash-based row identity (§5) | ✅ Implemented | `server/lib/import/row-hasher.ts`; `row_hash` columns on the canonical tables |
> | 3-way merge engine (§6) | ✅ Implemented | `server/lib/import/merge-engine.ts` + existing `conflict-engine.ts` (both wired; consolidation deferred) |
> | Per-row import snapshot (§5, §6) | ✅ Implemented | `import_snapshot` JSONB on every active row |
> | Manual-override tracking (§6) | ✅ Implemented | `manual_overrides` JSONB on every active row |
> | Conflict-resolution wizard UI (§8) | ✅ Implemented | New v2 conflict cards in `client/src/pages/smart-import.tsx` |
> | 1:N Expenditure actuals child table | ✅ Implemented | `normalized_cost_line_actuals` |
> | Top-of-sheet metadata capture | ✅ Implemented | `tracker_project_metadata` + `tracker_revenue_summary` |
> | Per-cell font / fill colour (`cell_format`) | ✅ Implemented | JSONB on every active row + 3 replica screens render it |
> | 3 Tracker replica screens | ✅ Implemented | `/projects/:id/{revenue-tracking,expenditure-breakdown,program-plan}` |
> | Feature flag `USE_THREE_WAY_MERGE` | ✅ Implemented | Default ON; set to `false` to fall back to v1-style behaviour |
> | Structured `[SmartImport.metrics]` log | ✅ Implemented | One JSON line per import |
> | Daily-resolution Gantt strip | ⏸️ Deferred | Program Plan replica shows tasks; daily Gantt strip is follow-up |
> | Engine consolidation (one engine, not two) | ⏸️ Deferred | Both `conflict-engine.ts` + `merge-engine.ts` run in parallel; trust-correct but redundant |
> | Manual-override audit-log read surface | ⏸️ Deferred | `manual_overrides` JSONB is captured but no UI yet |

---

## Table of Contents

1. [Current-State Summary](#1-current-state-summary)
2. [Target-State Summary](#2-target-state-summary)
3. [Import Lifecycle States](#3-import-lifecycle-states)
4. [Baseline vs Incremental Rules](#4-baseline-vs-incremental-rules)
5. [Row Identity Strategy per Section](#5-row-identity-strategy-per-section)
6. [3-Way Merge Rules](#6-3-way-merge-rules)
7. [File vs Folder Intake Rule](#7-file-vs-folder-intake-rule)
8. [Plain-Language UX Flow](#8-plain-language-ux-flow)
9. [Migration and Rollout Risks](#9-migration-and-rollout-risks)
10. [Backend Modules/Files to Change](#10-backend-modulesfiles-to-change)
11. [Frontend Modules/Files to Change](#11-frontend-modulesfiles-to-change)
12. [Acceptance Criteria](#12-acceptance-criteria)
13. [Open Questions and Assumptions](#13-open-questions-and-assumptions)

---

## 1. Current-State Summary

### 1.1 Architecture overview

The Smart Import pipeline processes Excel tracker files (.xlsx / .xlsm) through a 5-step wizard:

```
Upload → Section Detection → Column Mapping → Issue Resolution → Commit
```

**Key files:**

| Layer | File | LOC | Role |
|-------|------|-----|------|
| Frontend | `client/src/pages/smart-import.tsx` | ~4100 | 5-step wizard, drag-drop upload, batch mode |
| Backend routes | `server/smart-import-routes.ts` | ~3340 | All API endpoints, commit transaction logic |
| Detection | `server/lib/import/detector.ts` | ~800 | Sheet/section discovery, header row detection |
| Mapping | `server/lib/import/mapper.ts` | ~237 | Header→canonical field matching |
| Normalization | `server/lib/import/normalizer.ts` | ~1500 | Data validation, type coercion, issue generation |
| Orchestrator | `server/lib/import/index.ts` | ~47 | Glue: detect → map → normalize |
| Conflict policy | `server/imports/import-conflict-policy.ts` | ~186 | Type definitions and helpers (partially wired) |
| Temporal helpers | `server/lib/temporal-helpers.ts` | ~136 | Soft-close / effectiveFrom-To stamping |
| Schema | `shared/schema/imports.ts` | ~564 | All import-related DB table definitions |
| Schema | `shared/schema/finance.ts` | — | Revenue, cost, expense tables with temporal cols |

### 1.2 Current commit behaviour (the core problem)

On every commit, the system performs a **full replace with soft-close**:

1. **Soft-close ALL active rows** for the project across `normalized_cost_lines`, `normalized_revenue_lines`, `program_expense`, `program_inflows` (sets `effective_to = NOW()`).
2. **Hard-delete ALL work items** (`work_items`) for the project where `source = 'SMART_IMPORT'`.
3. **Re-insert every row** from the uploaded file as new rows with fresh `effective_from`.

This means:
- **Unchanged rows are duplicated** as new temporal versions on every import.
- **There is no true incremental mode** — every import is effectively a baseline replacement.
- **Row identity is not stable** — rows get new `id` values on every import, breaking foreign key references (e.g., `expense_task_links`).
- The system attempts to **re-link** `expense_task_links` by matching `rowNumber`, but this is fragile.

### 1.3 Current conflict handling

Conflicts are detected **only for specific manual-edit flags** on cost/revenue lines:
- `cosRealised`, `invoiceDateConfirmed`, `paidDateConfirmed`, `noRevenueLinked`, `cashflowConfirmed`, `adminDateOverride`

When detected, the API returns HTTP 409 with a list of conflicts. The frontend must re-submit with either:
- `preserveManualEdits=true` (keep all manual edits)
- `conflictResolutions: { "rowNum::fieldLabel": "keep" | "import" }` (per-field decisions)

**Gaps:**
- General field-level changes (e.g., a description change, amount update) are NOT conflict-detected.
- Revenue and plan rows have minimal conflict detection.
- The `import-conflict-policy.ts` file defines types and a `detectConflicts()` function, but it is **not wired into the commit path**.

### 1.4 Current row identity

| Section | Current match key (diff endpoint) | Current match key (commit) | Stable? |
|---------|-----------------------------------|---------------------------|---------|
| PLAN | `taskName::startDate` | None (full delete + reinsert) | No |
| REVENUE | `milestoneName::amountExVat` | None (soft-close all + reinsert) | No |
| EXPENDITURE | `description::amountExVat::invoiceNumber` | None (soft-close all + reinsert) | No |

### 1.5 Current deduplication

- **File-level:** SHA-256 hash of file content (`sourceFileHash`). Warns on re-upload of identical file.
- **Issue-level:** `issueFingerprint` for auto-resolving recurring issues.
- **Row-level:** No stable row identity. `sourceRow` (Excel row number) is used for matching manual edits back to re-inserted rows, but this breaks when rows are inserted/removed in the spreadsheet.

### 1.6 What works well today

- Section detection and header mapping are robust (synonym matching, fuzzy scoring, learned mappings).
- Temporal soft-close preserves history for audit trails.
- Issue resolution rules auto-apply across imports.
- Counterparty matching with alias support.
- Invoice pattern classification with learning loop.
- Conflict UI for manual-edit flags exists and functions.
- Batch file upload with progress tracking.
- Rollback capability via soft-close reversal.

---

## 2. Target-State Summary

### 2.1 Core invariants (business rules)

These five rules are the **source of truth** for Smart Import v2:

| # | Rule | Enforcement point |
|---|------|-------------------|
| BR-1 | First import for a project is a **full baseline import**. | Commit engine checks `smartImportRuns` for prior COMMITTED runs. |
| BR-2 | Every subsequent import is **incremental only**: create new rows, update changed rows, leave unchanged rows untouched, never duplicate unchanged rows. | Row-matching + diff engine in commit transaction. |
| BR-3 | If app data was changed after the last import and the uploaded file disagrees or omits that change, the system **must require the user to choose** which value wins. | 3-way merge engine + conflict UI. |
| BR-4 | File upload and folder upload must use the **exact same import engine** and rules. | Single code path at `POST /api/smart-import/upload`. |
| BR-5 | The UX must be **understandable by a non-technical person**. | Plain-language labels, no jargon, guided conflict resolution. |

### 2.2 What changes

| Area | v1 (current) | v2 (target) |
|------|-------------|-------------|
| Commit strategy | Full soft-close + re-insert all rows | Match rows by natural key; INSERT new, UPDATE changed, SKIP unchanged |
| Row identity | Unstable (`sourceRow` / Excel row number) | Stable composite natural keys per section (see §5) |
| Conflict detection | Manual-edit flags only (6 boolean fields) | Full 3-way merge: baseline snapshot vs current app state vs uploaded file |
| Conflict scope | EXPENDITURE only (partial REVENUE) | All sections: PLAN, REVENUE, EXPENDITURE |
| Work items | Hard-deleted and re-created | Matched by stable key, updated in-place |
| `import-conflict-policy.ts` | Defined but unwired | Fully wired into commit path |
| Baseline detection | None | Automatic: first COMMITTED run = baseline |
| File vs folder | Same upload endpoint, same engine | No change needed (already unified) |

### 2.3 What does NOT change

- Upload, detection, mapping, and normalization pipeline (§1.1 files).
- Issue resolution rules and auto-apply logic.
- Counterparty matching and invoice classification.
- Temporal column pattern (`effective_from`, `effective_to`, `snapshot_run_id`).
- Rollback mechanism (soft-close by `import_run_id`).
- File hash rerun protection.
- Permission model and auth middleware.

---

## 3. Import Lifecycle States

### 3.1 Import run states (unchanged)

The `smart_import_status` enum remains:

```
PREVIEW → AWAITING_REVIEW → COMMITTED
                           → FAILED
                           → ROLLED_BACK
                           → SUPERSEDED
```

### 3.2 New: import type classification

Each import run gains a derived classification stored in `smartImportRuns.importType`:

| Classification | Condition | Behaviour |
|----------------|-----------|-----------|
| `BASELINE` | No prior COMMITTED run exists for this `projectId` | Insert all rows. No conflict detection needed. Snapshot becomes the merge base. |
| `INCREMENTAL` | At least one prior COMMITTED run exists for this `projectId` | Row-match, diff, merge. Conflicts require user resolution. |

**Detection logic (pseudo-code):**

```typescript
const priorCommitted = await db.select()
  .from(smartImportRuns)
  .where(and(
    eq(smartImportRuns.projectId, projectId),
    eq(smartImportRuns.status, "COMMITTED"),
  ))
  .limit(1);

const importType = priorCommitted.length === 0 ? "BASELINE" : "INCREMENTAL";
```

### 3.3 Commit flow (v2)

```
                   ┌─────────────────┐
                   │  Upload + Parse  │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │  Classify:      │
                   │  BASELINE or    │
                   │  INCREMENTAL?   │
                   └───┬─────────┬───┘
                       │         │
              BASELINE │         │ INCREMENTAL
                       │         │
              ┌────────▼───┐  ┌──▼──────────────┐
              │ Insert all  │  │ Row-match by     │
              │ rows. Store │  │ natural key.     │
              │ as baseline │  │ Compute 3-way    │
              │ snapshot.   │  │ diff.            │
              └─────────────┘  └──┬──────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │ Conflicts found?    │
                       └──┬──────────────┬───┘
                          │ No           │ Yes
                     ┌────▼────┐   ┌─────▼──────────┐
                     │ Auto-   │   │ Return 409 with │
                     │ commit: │   │ conflict list.  │
                     │ INSERT  │   │ User resolves   │
                     │ new,    │   │ each field.     │
                     │ UPDATE  │   │ Re-submit.      │
                     │ changed,│   └─────────────────┘
                     │ SKIP    │
                     │ same.   │
                     └─────────┘
```

---

## 4. Baseline vs Incremental Rules

### 4.1 Baseline import (first import for a project)

**Trigger:** No prior run with `status = 'COMMITTED'` exists for this `projectId`.

**Behaviour:**

1. All parsed rows are INSERT-ed as new records.
2. Each row is stamped with `importRunId`, `effectiveFrom = NOW()`, `effectiveTo = NULL`.
3. The committed run becomes the **merge base** for all future incremental imports.
4. No conflict detection is needed (there is nothing to conflict with).
5. The response clearly labels this as `"importType": "BASELINE"`.

**Edge cases:**

- If a project was previously deleted and re-created (`forceRecreate=true`), the first import into the re-created project is still a BASELINE.
- If a prior run was COMMITTED then ROLLED_BACK, it no longer counts as a committed baseline. The next import is again a BASELINE.

### 4.2 Incremental import (subsequent imports)

**Trigger:** At least one prior run with `status = 'COMMITTED'` exists for this `projectId`.

**Behaviour:**

1. Load the **baseline snapshot** — the set of rows written by the last COMMITTED import run (identified by `importRunId` on active rows where `effectiveTo IS NULL`).
2. Load the **current app state** — the actual current active rows (which may have been edited in-app since the last import).
3. Parse the **uploaded file** — the incoming data from the Excel tracker.
4. For each row in the uploaded file, use the natural key (§5) to find matches:

| Match result | Action |
|-------------|--------|
| **New row** (no match in baseline or current) | INSERT new row. |
| **Unchanged** (matches baseline AND current — all fields identical) | SKIP. Leave existing row untouched. Row keeps its original `id`. |
| **Changed in file only** (baseline = current ≠ file) | UPDATE the existing row in-place. Bump `effectiveFrom`. |
| **Changed in app only** (baseline ≠ current = file, or baseline ≠ current ≠ file) | 3-way conflict — see §6. |
| **Omitted from file** (exists in current, not in file) | See §4.3. |

### 4.3 Handling omitted rows

When a row exists in the current app state but is absent from the uploaded file:

- **Do NOT automatically delete or soft-close** the row. The file may simply not contain that row (e.g., the user exported a partial sheet).
- If the row was originally imported (has an `importRunId`), flag it as a **potential deletion** in the diff preview.
- The user must explicitly confirm deletions. Default: keep omitted rows.

> **ASSUMPTION:** This is the safest default. If business requirements change to "omitted rows should be soft-closed", this can be made configurable per project. Documenting this as an explicit assumption.

### 4.4 Recency enforcement (unchanged from v1)

The existing recency check remains:
- If the uploaded file's timestamp is older than the last committed import, return HTTP 409 unless `forceCommit=true`.
- If timestamps are within 60 seconds, require `acknowledgeEqualDate=true`.

---

## 5. Row Identity Strategy per Section

Stable row identity is the foundation of incremental import. Each section needs a **natural composite key** that survives row insertions/deletions in the spreadsheet.

### 5.1 PLAN section

**Primary natural key:** `taskNo` (WBS code / task number)

**Fallback key:** `taskName` (when `taskNo` is null or missing)

**Rationale:**
- Task numbers (e.g., "1.2.3") are stable identifiers in project plans.
- Task names are unique within a project plan in practice, but can be renamed.
- `sourceRow` (Excel row number) is NOT suitable — it shifts when rows are inserted above.

**Match algorithm:**

```
1. If incoming row has taskNo AND existing row has same taskNo → MATCH
2. Else if incoming row has taskName AND existing row has same taskName → MATCH
3. Else → NEW ROW (no match)
```

**Target table:** `work_items` (where `source = 'SMART_IMPORT'` and `workstream = 'PM'`)

**Fields compared for change detection:**
`startDate`, `endDate`, `actualStart`, `actualEnd`, `duration`, `percentComplete`, `expectedPctComplete`, `ownerName`, `status`, `description`, `phase`

### 5.2 REVENUE section

**Primary natural key:** `milestoneName + amountExVat`

**Fallback key:** `milestoneNo + amountExVat` (positional milestone number)

**Rationale:**
- Milestone names are the human-readable identifier for revenue lines.
- Combined with amount, this is unique in practice (two milestones rarely have the same name AND amount).
- Milestone names can be renamed, but this is rare. If renamed, the system treats it as a delete + create, which is the safest default.

**Match algorithm:**

```
1. If incoming milestoneName + amountExVat matches existing → MATCH
2. Else if incoming milestoneNo matches existing milestoneNo AND amounts are close (±1%) → MATCH (with lower confidence)
3. Else → NEW ROW
```

**Target tables:** `normalized_revenue_lines`, `program_inflows`

**Fields compared for change detection:**
`invoiceNumber`, `invoiceDate`, `expectedPaymentDate`, `paidDate`, `inBankDate`, `status`, `vat`

### 5.3 EXPENDITURE section

**Primary natural key:** `description + counterpartyName + budgetTotal`

**Fallback key:** `description + amountExVat + invoiceNumber`

**Rationale:**
- Cost lines are identified by what they describe, who they're for, and their budget.
- Invoice number alone is insufficient (many rows are PLANNED with no invoice).
- The fallback uses `amountExVat + invoiceNumber` for rows that have actual costs.

**Match algorithm:**

```
1. If incoming (description, counterpartyName, budgetTotal) matches existing → MATCH
2. Else if incoming (description, amountExVat, invoiceNumber) matches existing → MATCH
3. Else if incoming description matches existing AND >80% of other fields match → FUZZY MATCH (flag for review)
4. Else → NEW ROW
```

**Target tables:** `normalized_cost_lines`, `program_expense`

**Fields compared for change detection:**
`amountExVat`, `invoiceNumber`, `invoiceDate`, `approvedDate`, `paidDate`, `forecastPaymentDate`, `poNumber`, `budgetQty`, `budgetRate`, `budgetTotal`, `costCategory`, `status`

### 5.4 Key stability guarantees

| Guarantee | How enforced |
|-----------|-------------|
| Matched rows keep their existing `id` | UPDATE in-place instead of delete+insert |
| `expense_task_links` survive import | Expense `id` is stable; no re-linking needed |
| `manualEditFlags` remain valid | `entityId` references a stable row `id` |
| `conflictResolutionLog` is traceable | References stable `entityId` |
| Temporal history is clean | Only changed rows get a new temporal version |

---

## 6. 3-Way Merge Rules

### 6.1 The three sources

For every matched row during an incremental import, three versions are compared:

| Source | Label | Where it comes from |
|--------|-------|---------------------|
| **B** — Baseline | The value at the time of the last committed import | The row written by the previous COMMITTED import run. Identified by the row's `snapshotRunId` matching the last committed `smartImportRuns.id`. |
| **C** — Current app state | The live value in the database right now | The active row (`effectiveTo IS NULL`). May differ from B if a user edited it in the app. |
| **F** — File (uploaded) | The value in the Excel file being imported | The parsed/normalized value from the current upload. |

### 6.2 Merge decision matrix

For each field on a matched row:

| B (Baseline) | C (Current) | F (File) | Decision | Rationale |
|--------------|-------------|----------|----------|-----------|
| X | X | X | **SKIP** — no change | All three agree. Nothing to do. |
| X | X | Y | **AUTO-ACCEPT FILE** — update to Y | File changed, app didn't touch it. Safe to take the file value. |
| X | Y | X | **KEEP APP** — leave as Y | App changed, file still has old value. The app edit wins by default. |
| X | Y | Y | **SKIP** — already converged | Both changed to the same value. Nothing to do. |
| X | Y | Z | **CONFLICT** — user must choose Y or Z | App and file both changed, to different values. Cannot auto-resolve. |
| — | Y | — | **KEEP APP** — row omitted from file | Row exists in app, not in file. Keep it (see §4.3). |
| — | — | Z | **INSERT** — new row | Row only in file, not in app or baseline. |

Where `X`, `Y`, `Z` represent distinct values, and `—` means the row is absent.

### 6.3 Conflict data structure

When a conflict is detected (row B≠C, B≠F, C≠F), the API returns:

```typescript
interface ImportConflict {
  /** Stable natural key for the row */
  rowKey: string;
  /** Human-readable row label (e.g., task name, milestone name, description) */
  rowLabel: string;
  /** Section: PLAN, REVENUE, or EXPENDITURE */
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  /** Table being affected */
  table: string;
  /** Existing DB row ID */
  existingRowId: number;
  /** List of fields in conflict */
  fields: Array<{
    fieldName: string;
    /** Human-readable field label */
    fieldLabel: string;
    baselineValue: string | null;
    currentAppValue: string | null;
    fileValue: string | null;
  }>;
}
```

### 6.4 Conflict resolution payload

The user resolves conflicts via the frontend and re-submits:

```typescript
interface ConflictResolutionPayload {
  /** Map of "rowKey::fieldName" → decision */
  resolutions: Record<string, "keep_app" | "accept_file">;
}
```

### 6.5 Protected fields (carry-forward from v1)

The existing manual-edit flags (`cosRealised`, `invoiceDateConfirmed`, `paidDateConfirmed`, `cashflowConfirmed`, `adminDateOverride`, `noRevenueLinked`) continue to receive special treatment:

- If `manualEditFlags.isProtected = true` for a field, it is **always treated as "keep_app"** — the user previously chose to protect this field permanently.
- If `isProtected = false`, the field enters the normal 3-way merge and may produce a conflict.

### 6.6 Audit trail

Every conflict resolution decision is recorded in `conflictResolutionLog`:

| Column | Value |
|--------|-------|
| `importRunId` | Current import run ID |
| `entityType` | Table name (e.g., `normalized_cost_lines`) |
| `entityId` | Stable row ID |
| `fieldName` | The conflicting field |
| `manualValue` | The current app value (C) |
| `importValue` | The file value (F) |
| `decision` | `KEEP_MANUAL` or `OVERWRITE_WITH_IMPORT` |
| `decidedByUserId` | Who resolved it |
| `decidedAt` | When |

---

## 7. File vs Folder Intake Rule

### 7.1 Current state (already correct)

File upload and folder upload already use the same code path:

- **File upload:** `<input type="file" accept=".xlsx,.xlsm" multiple>` → `addFiles()` → sequential `POST /api/smart-import/upload` per file.
- **Folder upload:** `<input type="file" webkitdirectory directory>` → `addFiles()` (filters to `.xlsx`/`.xlsm`) → same sequential upload.

Both converge in the `UploadStep` component at `client/src/pages/smart-import.tsx:176` which calls the same `handleUpload()` function.

On the backend, both hit the same `POST /api/smart-import/upload` endpoint with `multer.single("file")`.

### 7.2 v2 rule (no change needed)

> **BR-4:** File upload and folder upload MUST use the exact same import engine and rules.

This is already satisfied. No changes required. The spec documents this explicitly to prevent future divergence.

### 7.3 Batch processing note

When multiple files are uploaded (batch mode), each file creates its own `smartImportRuns` record and goes through the full pipeline independently. This is correct — each file may map to a different project, and each project's baseline/incremental classification is independent.

---

## 8. Plain-Language UX Flow

> **BR-5:** The UX must be understandable by a non-technical person.

### 8.1 Step 1: Upload your file

**What the user sees:**

A drag-and-drop area with the message:
> "Drag your Excel tracker here, or click to browse. You can also upload an entire folder."

**What happens behind the scenes:**
The file is uploaded, sections are detected, and the system figures out which project this belongs to.

**What the user sees next:**
> "We found 3 sections in your file: Schedule (12 tasks), Revenue (8 milestones), Costs (45 line items)."

### 8.2 Step 2: Confirm sections and project

**What the user sees:**

A summary card showing:
- Which project the file was matched to (with a "Change" button)
- Whether this is a **first-time import** or an **update**
- A list of detected sections with row counts

**Plain-language labels:**

| Technical term | User-facing label |
|----------------|-------------------|
| BASELINE import | "First-time import — all data will be added as new" |
| INCREMENTAL import | "Update — only changes will be applied" |
| PLAN section | "Schedule / Timeline" |
| REVENUE section | "Revenue / Milestones" |
| EXPENDITURE section | "Costs / Expenses" |

### 8.3 Step 3: Review column mapping

**What the user sees:**

A table showing:
> "We matched your spreadsheet columns to our system. Green = confident match, yellow = please verify, red = couldn't match."

Each row shows: `Your Column Header → Our Field (confidence %)`

The user can change any mapping via dropdown.

### 8.4 Step 4: Resolve issues and conflicts

**What the user sees (issues):**

A list of data quality issues:
> "Row 15: The date '2025-13-01' doesn't look like a valid date."
> "Row 22: The amount field is empty."

Each issue has a resolution button: Fix, Skip Row, or Ignore.

**What the user sees (conflicts — new in v2):**

If this is an update and conflicts were found:

> "We found 3 items where your spreadsheet disagrees with changes made in the app since the last import. Please choose which version to keep."

Each conflict shows a side-by-side comparison:

```
┌──────────────────────────────────────────────────┐
│  Cost line: "Inverter Supply - SMA"              │
│  Field: Payment Date                             │
│                                                  │
│  📋 In the app:    2026-04-15 (edited by Jane)   │
│  📄 In your file:  2026-05-01                    │
│  📌 Last import:   2026-04-01                    │
│                                                  │
│  [ Keep app value ]  [ Use file value ]          │
└──────────────────────────────────────────────────┘
```

**Bulk actions:**
> "Keep all app changes" / "Use all file values" buttons at the top for convenience.

### 8.5 Step 5: Confirm and import

**What the user sees:**

A summary before committing:

> **Import Summary**
> - 3 new cost lines will be added
> - 7 cost lines will be updated
> - 35 cost lines are unchanged (will not be touched)
> - 2 conflicts resolved (you chose to keep the app version)
>
> [Cancel] [Import Now]

After committing:

> "Import complete! 45 items processed. 3 added, 7 updated, 35 unchanged."

### 8.6 Language guidelines

| Do | Don't |
|----|-------|
| "Your spreadsheet" | "The uploaded file" |
| "Changes made in the app" | "Current app state" |
| "Last import" | "Baseline snapshot" |
| "Keep app value" | "KEEP_MANUAL" |
| "Use file value" | "OVERWRITE_WITH_IMPORT" |
| "We found differences" | "Conflicts detected" |
| "First-time import" | "Baseline import" |
| "Update" | "Incremental import" |
| "Unchanged (not touched)" | "Skipped" |

---

## 9. Migration and Rollout Risks

### 9.1 Data migration

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Existing projects have no baseline snapshot.** Prior imports used full-replace, so there is no saved "what the file looked like at last import" to diff against. | HIGH | For the first v2 import on an existing project, treat the current active rows as BOTH the baseline and current state. Any differences in the uploaded file become "changed in file only" and auto-apply. This effectively makes the first v2 import a "re-baseline". |
| **Row identity backfill.** Existing rows were created without stable natural keys being used for matching. The first v2 import must attempt to match them. | MEDIUM | The row-matching algorithm (§5) matches by content fields, not by `id`. It will work on existing data without migration. If a match fails, the row is treated as new (duplicate until the old one is manually cleaned up or soft-closed). |
| **`sourceRow` references in `expense_task_links`.** These links use `expenseId` (the DB `id`), which currently changes every import. If v2 stabilises `id`, existing links will start working correctly. | LOW | No migration needed. The first v2 import that matches and updates in-place will stabilise the `id`. |

### 9.2 Rollout strategy

| Phase | Scope | Goal |
|-------|-------|------|
| **Phase 0: This spec** | Doc only | Align team on rules before writing code. |
| **Phase 1: Row matching engine** | Backend only | Build `matchRows()` function per section. Unit-test with real project data. No commit changes yet. |
| **Phase 2: Diff preview** | Backend + API | Wire row matching into `GET /api/smart-import/:runId/diff`. Return added/changed/unchanged/conflict counts. |
| **Phase 3: 3-way merge engine** | Backend | Build `computeMerge()` that takes baseline + current + file and produces merge decisions. |
| **Phase 4: Incremental commit** | Backend | Replace the full-replace commit with incremental INSERT/UPDATE/SKIP. Feature-flagged behind `SMART_IMPORT_V2=true`. |
| **Phase 5: Conflict UI** | Frontend | Build the conflict resolution UI (§8.4). Wire to the merge engine. |
| **Phase 6: GA rollout** | Full stack | Remove feature flag. Monitor for 2 weeks. |

### 9.3 Rollback plan

- The feature flag `SMART_IMPORT_V2` allows instant revert to v1 behaviour.
- If v2 produces incorrect data, the existing rollback endpoint (`POST /api/smart-import/:runId/rollback`) can revert any individual import.
- Temporal history means no data is permanently lost.

### 9.4 Performance risks

| Concern | Current | v2 impact | Mitigation |
|---------|---------|-----------|------------|
| Row matching on large projects | N/A (no matching) | O(n*m) per section where n=file rows, m=DB rows | Build hash maps on natural keys. O(n+m). |
| 3-way merge computation | N/A | O(n * fields) per section | Fields per row are bounded (~15). Trivial. |
| Transaction size | Full replace: 1 DELETE + n INSERTs | Incremental: only changed rows touched | Smaller transactions, better performance. |
| Baseline snapshot loading | N/A | Extra query per section | Indexed by `(projectId, importRunId)`. Fast. |

---

## 10. Backend Modules/Files to Change

### 10.1 New files to create

| File | Purpose |
|------|---------|
| `server/lib/import/row-matcher.ts` | Natural key matching per section. Exports `matchRows(section, fileRows, dbRows)`. |
| `server/lib/import/merge-engine.ts` | 3-way merge logic. Exports `computeMerge(baseline, current, file)`. Returns decisions per field. |
| `server/lib/import/baseline.ts` | Baseline snapshot loading. Exports `loadBaseline(projectId)` and `isBaselineImport(projectId)`. |

### 10.2 Existing files to modify

| File | Changes |
|------|---------|
| `server/smart-import-routes.ts` | **Heaviest change.** Refactor the `POST /:runId/commit` handler (~lines 1293-2709): replace full-replace logic with row-match → merge → incremental write. Refactor `GET /:runId/diff` to use `row-matcher.ts`. |
| `server/imports/import-conflict-policy.ts` | Wire `detectConflicts()` into the commit path. Extend types to include baseline value. |
| `server/lib/temporal-helpers.ts` | Add `updateRowInPlace(tx, table, id, changes, snapshotRunId)` — update a single row and bump `effectiveFrom` without soft-close+reinsert. |
| `shared/schema/imports.ts` | No schema changes required for v2 core. The `smartImportRuns.importType` column already exists. Ensure `conflictResolutionLog` captures baseline values. |
| `server/lib/import/index.ts` | No changes needed. Detection/mapping/normalization pipeline is untouched. |
| `server/lib/import/normalizer.ts` | No changes needed. |
| `server/lib/import/detector.ts` | No changes needed. |
| `server/lib/import/mapper.ts` | No changes needed. |

### 10.3 Commit handler refactor outline

The `POST /:runId/commit` handler (currently ~1400 lines) should be decomposed:

```
commit handler
  ├── classifyImport(projectId)           → BASELINE | INCREMENTAL
  ├── if BASELINE:
  │     └── baselineCommit(tx, norm, ...)  → insert all rows
  ├── if INCREMENTAL:
  │     ├── loadBaseline(projectId)        → baseline rows per section
  │     ├── loadCurrentState(projectId)    → current active rows per section
  │     ├── matchRows(section, file, db)   → matched pairs + unmatched
  │     ├── computeMerge(baseline, current, file) → decisions per field
  │     ├── if conflicts:
  │     │     └── return 409 with conflict list
  │     ├── applyMergeDecisions(tx, decisions)
  │     │     ├── INSERT new rows
  │     │     ├── UPDATE changed rows (in-place)
  │     │     └── SKIP unchanged rows
  │     └── recordAudit(...)
  └── finalise(tx, runId, counts)
```

---

## 11. Frontend Modules/Files to Change

### 11.1 Existing files to modify

| File | Changes |
|------|---------|
| `client/src/pages/smart-import.tsx` | **Step 2:** Show "First-time import" vs "Update" badge. **Step 4:** Add conflict resolution UI alongside existing issue resolution. **Step 5:** Show added/changed/unchanged/conflict counts instead of just total rows. |

### 11.2 New components to create

| Component | Purpose |
|-----------|---------|
| `client/src/components/import/ConflictResolver.tsx` | Side-by-side conflict comparison card (§8.4). Shows baseline, app, and file values. "Keep app" / "Use file" buttons per field. Bulk actions. |
| `client/src/components/import/ImportSummaryCard.tsx` | Pre-commit summary showing added/changed/unchanged/conflict counts (§8.5). |
| `client/src/components/import/ImportTypeBadge.tsx` | Small badge: "First-time import" (green) or "Update" (blue). |

### 11.3 API contract changes

| Endpoint | Change |
|----------|--------|
| `POST /api/smart-import/upload` | Response gains `importType: "BASELINE" \| "INCREMENTAL"`. |
| `GET /api/smart-import/:runId/diff` | Response gains per-row match status and conflict details (currently only has aggregate counts). |
| `POST /api/smart-import/:runId/commit` | Request body gains `conflictResolutions` map using natural key identifiers (currently uses `sourceRow::fieldLabel`). 409 response gains baseline values and structured conflict list. |

---

## 12. Acceptance Criteria

### 12.1 Baseline import

- [ ] AC-1: When a project has no prior committed imports, the import is classified as BASELINE.
- [ ] AC-2: All rows from the file are inserted as new records.
- [ ] AC-3: The response includes `importType: "BASELINE"`.
- [ ] AC-4: The UI shows "First-time import" label.

### 12.2 Incremental import — unchanged rows

- [ ] AC-5: When an identical file is re-imported, zero rows are modified. All rows are reported as "unchanged".
- [ ] AC-6: Unchanged rows keep their original database `id` (no delete+reinsert).
- [ ] AC-7: `expense_task_links` pointing to unchanged rows remain valid without re-linking.
- [ ] AC-8: Temporal history does NOT grow (no new `effectiveFrom` entries for unchanged rows).

### 12.3 Incremental import — new rows

- [ ] AC-9: Rows present in the file but absent from the DB are inserted as new records.
- [ ] AC-10: New rows appear in the diff preview as "added".

### 12.4 Incremental import — changed rows

- [ ] AC-11: Rows where the file value differs from the current DB value (and no app edit occurred) are updated in-place.
- [ ] AC-12: Updated rows retain their original `id`.
- [ ] AC-13: Updated rows get a new temporal version (`effectiveFrom` bumped).
- [ ] AC-14: The diff preview shows changed fields with old→new values.

### 12.5 Conflict detection and resolution

- [ ] AC-15: When a row was edited in-app AND the file has a different value for the same field, a conflict is raised.
- [ ] AC-16: Conflicts are returned as HTTP 409 with structured data including baseline, app, and file values.
- [ ] AC-17: The user can resolve each conflict individually ("keep app" or "use file").
- [ ] AC-18: The user can bulk-resolve all conflicts ("keep all app" or "use all file").
- [ ] AC-19: Conflict resolutions are audit-logged in `conflictResolutionLog`.
- [ ] AC-20: Protected fields (`manualEditFlags.isProtected = true`) auto-resolve as "keep app".

### 12.6 Omitted rows

- [ ] AC-21: Rows present in the DB but absent from the file are NOT deleted or soft-closed.
- [ ] AC-22: Omitted rows are flagged in the diff preview as "not in file (keeping existing)".

### 12.7 File vs folder parity

- [ ] AC-23: Uploading a single file produces identical results to uploading a folder containing only that file.
- [ ] AC-24: Both paths use `POST /api/smart-import/upload`.

### 12.8 Row identity stability

- [ ] AC-25: PLAN rows are matched by `taskNo`, falling back to `taskName`.
- [ ] AC-26: REVENUE rows are matched by `milestoneName + amountExVat`.
- [ ] AC-27: EXPENDITURE rows are matched by `description + counterpartyName + budgetTotal`, falling back to `description + amountExVat + invoiceNumber`.

### 12.9 UX clarity

- [ ] AC-28: No technical jargon visible to the user (no "BASELINE", "INCREMENTAL", "soft-close", "effectiveTo").
- [ ] AC-29: Conflict resolution UI shows values side-by-side with plain-language labels.
- [ ] AC-30: Pre-commit summary shows added/updated/unchanged/conflict counts.

---

## 13. Open Questions and Assumptions

### 13.1 Assumptions (require validation)

| # | Assumption | Impact if wrong |
|---|-----------|-----------------|
| A-1 | Omitted rows should be kept by default (not deleted). | If the business wants "file is the complete truth", we need a "remove missing rows" option. |
| A-2 | The first v2 import on an existing project uses current active rows as the baseline (no historical snapshot available). | If historical accuracy is needed, a migration script must reconstruct baselines from `summaryJson`. |
| A-3 | Natural keys are sufficiently unique within a project (no two cost lines with identical description + counterparty + budget). | If duplicates exist, the matcher will need a disambiguation UI or positional tiebreaker. |
| A-4 | Task numbers (`taskNo`) are the primary identifier for plan tasks and are stable across imports. | If task numbers change between imports, matching falls back to `taskName`, which may be less reliable. |
| A-5 | Revenue milestone names are stable across imports. | If milestones are frequently renamed, we may need a user-assisted matching step. |
| A-6 | The `importType` column on `smartImportRuns` already exists and is text. | If not, a migration is needed to add it (low risk). |

### 13.2 Open questions

| # | Question | Who decides |
|---|----------|-------------|
| Q-1 | Should the system support a "full re-import" override for incremental projects (essentially forcing a new baseline)? | Product owner |
| Q-2 | When a row is fuzzy-matched (>80% field similarity but key doesn't exactly match), should the user confirm the match or auto-accept? | Product owner / UX |
| Q-3 | Should conflict resolution decisions be remembered across imports (like `issueResolutionRules`)? E.g., "always keep app value for COS Realised on this project." | Product owner |
| Q-4 | For multi-project trackers (e.g., "FY 2026 Adhoc" with sub-projects), does each sub-project get its own baseline, or is the whole tracker one baseline? | Product owner |
| Q-5 | Should the diff preview be computed at upload time (eager) or on-demand (lazy)? Eager means the user sees it immediately but upload is slower. | Engineering / UX |
| Q-6 | What is the threshold for flagging "this looks like a full replacement, not an incremental update"? Currently `import-conflict-policy.ts` uses 80% of rows being soft-closed. Is this still appropriate? | Product owner |
