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
