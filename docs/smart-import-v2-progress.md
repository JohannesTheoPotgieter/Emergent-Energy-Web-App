# Smart Import v2 — Progress Tracker

## Phase 2: Import Planner (Planning & Diffing)

**Date:** 2026-04-08
**Status:** COMPLETE
**Spec reference:** `docs/smart-import-v2-spec.md`

---

### What was changed

#### New files created

| File | Purpose |
|------|---------|
| `server/lib/import/row-matcher.ts` | Stable business key generation and row-level classification (NEW/CHANGED/UNCHANGED/MISSING_FROM_UPLOAD) |
| `server/lib/import/baseline.ts` | Import mode detection (BASELINE vs INCREMENTAL) and current-state loaders for each section |
| `server/lib/import/planner.ts` | Main planner orchestrator — entry point consumed by the API layer |

#### Existing files modified

| File | Changes |
|------|---------|
| `server/smart-import-routes.ts` | Added import for planner. Enhanced `GET /:runId` with optional `?includePlan=true` query param. Added new `GET /:runId/plan` endpoint. |

#### No schema changes

The existing schema already has everything needed:
- `smartImportRuns.importType` (text) — already exists, can store `"BASELINE"` or `"INCREMENTAL"`
- `smartImportRuns.status` — used to detect prior COMMITTED runs
- `normalizedCostLines`, `normalizedRevenueLines` — have `effectiveTo` for current-state queries
- `workItems` — has `source`, `workstream`, `subProjectName` for plan matching

No migrations required.

---

### How row identity works

#### PLAN section

| Strategy | Key | Confidence |
|----------|-----|-----------|
| **Primary** | `projectId + subProjectName + taskNo` | HIGH |
| **Fallback** | `projectId + subProjectName + norm(taskName) + norm(phase)` | LOW |

- `taskNo` (WBS code) is the strongest identifier — it is stored as `wbsCode` in `work_items`.
- When `taskNo` is missing, falls back to task name + phase. Planner emits a LOW confidence warning.
- Excel `sourceRow` is never used for identity.

#### REVENUE section

| Strategy | Key | Confidence |
|----------|-----|-----------|
| **Primary** | `projectId + subProjectName + norm(milestoneName)` | MEDIUM |

- `milestoneNo` is NOT available from the normalizer (it is synthesized during commit as a sequential counter). Therefore we always use milestoneName.
- Confidence is MEDIUM because milestone names could theoretically be renamed.
- `amountExVat` is compared as a change field, never as identity.

**Refinement from spec:** The spec proposed `milestoneNo` as primary key, but this field does not exist in the normalization output. The planner documents this as a permanent MEDIUM confidence key.

#### EXPENDITURE section

| Strategy | Key | Confidence |
|----------|-----|-----------|
| **Primary** | `projectId + norm(invoiceNumber)` | HIGH |
| **Fallback** | `projectId + subProjectName + norm(costCategory) + norm(counterpartyName) + norm(description)` | MEDIUM or LOW |

- Invoice number, when present, is a strong and unique identifier.
- Fallback confidence depends on how many of (category, counterparty, description) are populated: 2+ = MEDIUM, 1 = LOW.
- `amountExVat`, `budgetTotal`, and other monetary fields are compared as change fields, never identity.

---

### Planner output shape

```typescript
interface PlannerResult {
  importMode: "BASELINE" | "INCREMENTAL";
  lastCommittedRunId: number | null;
  sections: {
    PLAN: SectionPlan | null;
    REVENUE: SectionPlan | null;
    EXPENDITURE: SectionPlan | null;
  };
  warnings: string[];
  generatedAt: string;
}

interface SectionPlan {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  missingFromUploadCount: number;
  conflictPlaceholderCount: number;
  rows: PlannedRow[];
  fileRowCount: number;
  existingRowCount: number;
}

interface PlannedRow {
  classification: "NEW" | "CHANGED" | "UNCHANGED" | "MISSING_FROM_UPLOAD" | "CONFLICT_PLACEHOLDER";
  businessKey: string;
  keyType: "PRIMARY" | "FALLBACK";
  matchConfidence: "HIGH" | "MEDIUM" | "LOW";
  rowLabel: string;
  fileIndex: number | null;
  existingRowId: number | null;
  changedFields: Array<{ fieldName: string; existingValue: string | null; fileValue: string | null }>;
  warnings: string[];
}
```

### API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/smart-import/:runId?includePlan=true` | GET | Returns run data + planner output in `planning` field |
| `/api/smart-import/:runId/plan` | GET | Returns planner output only (dedicated endpoint) |

Both endpoints run the planner on-demand (not cached). The planner queries current DB state each time, so results reflect the latest data.

---

### Field comparison normalization

The comparison engine normalizes values before comparing:
- `null`, `undefined`, `""` → treated as empty
- `false`, `0`, `"0"` → treated as empty (avoids false positives for missing-vs-default)
- Strings are trimmed

This prevents false CHANGED classifications when, for example, a DB row has `pctComplete: 0` and the file has `pctComplete: null`.

---

### Known limitations before conflict-engine phase

1. **No 3-way merge yet.** The planner only compares file vs current app state. It does not load the baseline snapshot to detect "both changed to different values" conflicts. All matches are binary: CHANGED or UNCHANGED.

2. **CONFLICT_PLACEHOLDER is not yet emitted.** The classification exists in the type system but the planner never produces it. It will be used in Phase 3 when the 3-way merge engine is built.

3. **Commit still uses v1 logic.** The planner is read-only and does not affect the commit transaction. The existing full-replace commit continues to work unchanged.

4. **Revenue milestoneNo not available.** The normalizer does not output `milestoneNo`, so revenue matching is always MEDIUM confidence. This is a permanent limitation unless the normalizer is extended.

5. **Fuzzy matching not implemented.** The current matcher uses exact business key matching only. If a task is renamed slightly (e.g., "Install Panels" → "Install Solar Panels"), it will be classified as NEW + MISSING_FROM_UPLOAD instead of CHANGED. Fuzzy matching can be added in a future phase.

6. **Duplicate key handling.** If two file rows produce the same business key, the second one will match the same existing row. This could produce incorrect results. A dedup pass should be added in Phase 3.

---

### Assumptions made

1. The normalizer's output types (`planTasks`, `revenueLines`, `costLines`) are stable and won't change shape.
2. `work_items` with `source='SMART_IMPORT'` and `workstream='PM'` is the correct table/filter for plan rows (not `normalizedPlanTasks`).
3. The planner should be on-demand (computed per request) rather than cached, because DB state can change between requests.
4. File upload and folder upload both use the same `POST /api/smart-import/upload` → `GET /:runId/plan` flow, satisfying BR-4.

---

## Phase 3: Spine Alignment Audit & Corrections

**Date:** 2026-04-08
**Status:** COMPLETE
**Audit doc:** `docs/smart-import-v2-spine-alignment.md`

---

### Audit findings

The Phase 2 planner was already correctly anchored to the canonical sources:

| Section | Canonical source | Evidence |
|---------|-----------------|----------|
| **PLAN** | `work_items` (source=SMART_IMPORT, workstream=PM, deletedAt IS NULL) | The ONLY table written to during commit. Read by 11+ dashboard/report endpoints. `normalizedPlanTasks` is a dead table (never written, zero reads). |
| **REVENUE** | `normalized_revenue_lines` (effectiveTo IS NULL) | Written first during commit. 33 read sites. Documented as canonical in `data-import-and-source-of-truth.md`. |
| **EXPENDITURE** | `normalized_cost_lines` (effectiveTo IS NULL) | Written first during commit. 53 read sites. Documented as canonical in `data-import-and-source-of-truth.md`. |

### What was changed

#### Normalizer: milestoneNo/milestonePercent preservation

The synonym layer and mapper already recognized `milestone_no` and `percent` columns from Excel trackers, but the normalizer **dropped these fields** — they were never extracted into the `NormalizationResult`.

**Fixed:** Extended `NormalizationResult.revenueLines` to include `milestoneNo` and `milestonePercent`. The normalizer now extracts these values when the mapper identifies the columns.

#### Row matcher: revenue identity confidence upgrade

When `milestoneNo` is present on a file row, the revenue business key confidence is upgraded from MEDIUM to HIGH, and `keyType` is set to PRIMARY. The actual matching key remains `milestoneName` (since the canonical DB table `normalized_revenue_lines` does not store `milestoneNo`), but the confidence metadata now reflects the stronger identity signal.

#### Planner: canonicalSource metadata

Each `SectionPlan` in the planner output now includes a `canonicalSource` field declaring which table was queried:

```typescript
planning.sections.PLAN.canonicalSource      // "work_items"
planning.sections.REVENUE.canonicalSource   // "normalized_revenue_lines"
planning.sections.EXPENDITURE.canonicalSource // "normalized_cost_lines"
```

The `CANONICAL_SOURCES` constant is declared in `planner.ts` with JSDoc linking to the spine alignment audit doc.

### Updated planner output shape

```typescript
interface SectionPlan {
  canonicalSource: string;  // NEW — which DB table was compared against
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  missingFromUploadCount: number;
  conflictPlaceholderCount: number;
  rows: PlannedRow[];
  fileRowCount: number;
  existingRowCount: number;
}
```

### Updated revenue identity

| Strategy | Key | Confidence | Condition |
|----------|-----|-----------|-----------|
| **Primary** | `projectId + subProjectName + norm(milestoneName)` | HIGH | `milestoneNo` present on file row |
| **Fallback** | `projectId + subProjectName + norm(milestoneName)` | MEDIUM | `milestoneNo` absent |

The matching key is the same in both cases (milestoneName), because the canonical DB table lacks a milestoneNo column. The confidence upgrade reflects that when milestoneNo exists in the tracker, the milestone identity is more trustworthy.

### Tests added

`qa/tests/unit/smart-import-planner-spine.test.ts` — 39 tests covering:
- Canonical source declarations in planner
- PLAN baseline loader targets work_items (not normalizedPlanTasks)
- REVENUE baseline loader targets normalizedRevenueLines (not programInflows)
- EXPENDITURE baseline loader targets normalizedCostLines (not programExpense)
- milestoneNo/milestonePercent preserved in normalizer
- Revenue matcher uses milestoneNo for confidence
- Row matcher correctness (UNCHANGED, CHANGED, NEW, MISSING_FROM_UPLOAD)
- projectId-first key isolation
- File/folder upload parity

### Limitations resolved from Phase 2

- ~~Revenue milestoneNo not available~~ → Now extracted and used for confidence. Limitation was in the normalizer, not the tracker data.

### Remaining limitations (resolved in Phase 4)

1. ~~The canonical DB table `normalized_revenue_lines` does not store `milestoneNo`.~~ → Resolved: migration added, column persisted.
2. The dead table `normalizedPlanTasks` remains in the schema. It could be cleaned up in a future PR but is not blocking anything.

---

## Phase 4: 3-Way Conflict Engine & Commit Integration

**Date:** 2026-04-08
**Status:** COMPLETE

---

### What was changed

#### New files created

| File | Purpose |
|------|---------|
| `server/lib/import/conflict-engine.ts` | 3-way merge engine: compares baseline (B) vs current app (C) vs uploaded file (F) per field |
| `qa/tests/unit/smart-import-conflict-engine.test.ts` | 43 tests for all merge cases, canonical source alignment, commit gating |
| `migrations/20260408_add_milestone_no_to_revenue.sql` | Adds `milestone_no` and `milestone_percent` columns to `normalized_revenue_lines` |

#### Existing files modified

| File | Changes |
|------|---------|
| `server/lib/import/planner.ts` | Integrates conflict engine. PlannerResult now includes `conflicts: ConflictEngineResult \| null`. Loads baseline normalization. |
| `server/lib/import/baseline.ts` | Added `loadBaselineNormalization()` — loads last COMMITTED run's `summaryJson.normalization` as baseline snapshot. Added `milestoneNo`/`milestonePercent` to revenue loader. |
| `server/lib/import/row-matcher.ts` | Exported `generateBusinessKey()` for use by conflict engine. |
| `server/smart-import-routes.ts` | Added v2 conflict gate in commit handler: runs planner, blocks on unresolved conflicts, accepts `v2ConflictResolutions`. Added v2 conflict audit logging. Persists `milestoneNo`/`milestonePercent` in revenue commit. |
| `shared/schema/finance.ts` | Added `milestoneNo` and `milestonePercent` columns to `normalizedRevenueLines` table. |

### 3-Way Merge Logic

The conflict engine classifies each field on matched rows:

| Case | Condition | Result | User action |
|------|-----------|--------|-------------|
| E | B=C=F | UNCHANGED | None |
| A | B=C, C≠F | AUTO_ACCEPT_FILE | None (auto) |
| B | B≠C, B=F | KEEP_APP | None (auto) |
| D | F blank, B≠C | KEEP_APP | None (preserve app) |
| converged | B≠C, B≠F, C=F | UNCHANGED | None (both agree) |
| C | B≠C, C≠F, B≠F | CONFLICT | User must choose |

**Baseline source:** `summaryJson.normalization` from the last COMMITTED import run for the project.

**Canonical sources for current app state:**
- PLAN: `work_items` (source=SMART_IMPORT, workstream=PM)
- REVENUE: `normalized_revenue_lines` (effectiveTo IS NULL)
- EXPENDITURE: `normalized_cost_lines` (effectiveTo IS NULL)

### Commit Handler Changes

1. **V2 conflict gate** runs BEFORE the existing v1 manual-edit check.
2. If unresolved conflicts exist → HTTP 409 with full conflict detail.
3. Client resolves via `v2ConflictResolutions: { "rowKey::fieldName": "keep_app" | "accept_file" }`.
4. All resolutions logged to `conflictResolutionLog` with `entityType = "v2_3way_merge"`.
5. `skipV2ConflictCheck` escape hatch preserves backward compatibility.
6. Existing v1 manual-edit detection remains as safety net.

### Revenue milestoneNo Canonical Persistence

- Schema: `milestone_no TEXT` and `milestone_percent NUMERIC(6,4)` added to `normalized_revenue_lines`
- Migration: `migrations/20260408_add_milestone_no_to_revenue.sql`
- Write path: commit handler now persists `milestoneNo` and `milestonePercent` from normalization
- Read path: baseline loader now fetches these columns
- Row matcher: uses milestoneNo for confidence upgrade (HIGH when present)

### Preview Payload Shape

The planner now returns conflict data:

```typescript
PlannerResult.conflicts: {
  summary: {
    totalConflictRows: number;
    unresolvedConflictRows: number;
    autoResolvedRows: number;
    sections: {
      PLAN: { canonicalSource, rows[], conflictRowCount, ... } | null;
      REVENUE: { ... } | null;
      EXPENDITURE: { ... } | null;
    };
  };
  hasBlockingConflicts: boolean;
  allRows: RowMergeResult[];
}

// Each RowMergeResult:
{
  rowKey: string;
  displayLabel: string;
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  canonicalSource: string;
  conflictStatus: "NO_CONFLICT" | "HAS_CONFLICTS" | "AUTO_RESOLVED";
  fields: Array<{
    fieldName: string;
    baselineValue: string | null;
    currentAppValue: string | null;
    uploadedValue: string | null;
    mergeCase: "UNCHANGED" | "AUTO_ACCEPT_FILE" | "KEEP_APP" | "CONFLICT";
    requiresDecision: boolean;
  }>;
}
```

### Test Coverage

115 total tests across 5 test files, all passing:

| File | Tests | Coverage |
|------|-------|---------|
| `smart-import-conflict-engine.test.ts` | 43 | All merge cases (A-E), row merge, section merge, canonical sources, commit gate, milestoneNo persistence |
| `smart-import-planner-spine.test.ts` | 39 | Canonical source alignment, row matcher, identity keys |
| `smart-import-commit-guard.test.ts` | 18 | Atomic commit guard |
| `smart-import-authorization.test.ts` | 14 | Permission checks |
| `smart-import-storage-retention.test.ts` | 1 | Temporal retention |

### Remaining gaps before UX phase

1. **Commit does not yet apply v2 merge decisions to the actual write path.** The commit handler still uses the v1 full-replace strategy. The v2 conflict gate blocks/allows commit, and resolutions are logged, but the write path itself doesn't do incremental UPDATE-in-place. This is Phase 5 work.
2. **No frontend conflict resolution UI yet.** The API shape is ready for it.
3. **No backfill of milestoneNo for existing rows.** New imports will persist it; old rows will have NULL.
