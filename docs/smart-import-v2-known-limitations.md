# Smart Import v2 — Known Limitations

**Last updated:** 2026-04-29

---

## 1. Derivative table refresh lag

**Status:** By design (not a bug)

After a v2 incremental import, the canonical tables (`work_items`, `normalized_revenue_lines`, `normalized_cost_lines`) are updated immediately. However, derivative/summary tables (`program_expense`, `program_inflows`, materialized dashboard metrics) are refreshed asynchronously.

**Impact:** Dashboard summary views may briefly show stale data after an import commit. This typically resolves within seconds.

**Mitigation:** The post-import result screen tells the user: "Dashboard summaries may take a moment to update."

---

## 2. milestoneNo backfill for existing rows

**Status:** Deferred

The `milestone_no` and `milestone_percent` columns were added to `normalized_revenue_lines` in this release. New imports will populate these fields when the Excel tracker includes milestone number/percentage columns.

**Impact:** Rows imported before v2 have `NULL` for `milestone_no`. This means revenue row matching for pre-v2 data falls back to milestone name matching (MEDIUM confidence) rather than milestone number matching (HIGH confidence).

**Mitigation:** After a full re-import cycle, all rows will have milestone numbers populated. No manual backfill is needed.

---

## 3. Legacy v1 "Advanced view" retained

**Status:** Intentional

The v1 technical interface (column mapping, issue resolution, raw detection details) is still available via the "Advanced view" toggle on the Smart Import page. This is for operators who need fine-grained control.

**Impact:** Users who accidentally switch to "Advanced view" will see the original technical interface. This is not harmful — they can switch back to "Simple view" at any time.

**Decision:** v1 will be retained as an operator escape hatch until v2 has been in production for a full release cycle without issues.

---

## 4. v1 commit fallback

**Status:** Removed

The v1 full-replace commit path and the `emergencyV1Mode` / `skipV2ConflictCheck`
opt-out flags have been deleted. v2 is now the only commit path. Commits fail
fast with `project_id_missing` when `project_info.id` is not resolved before
the commit call.

---

## 5. Fuzzy row matching not implemented

**Status:** Deferred

The current row matcher uses exact business key matching. If a task name or milestone name is slightly changed (e.g., "Install Panels" to "Install Solar Panels"), the system treats it as a new row + a missing row, rather than a renamed row.

**Impact:** Small wording changes in the tracker may result in duplicate rows. Users should review "New data" and "Not in this upload" counts carefully when names change.

**Mitigation:** Future phases may add fuzzy matching with a confirmation step for ambiguous matches.

---

## 6. Duplicate business keys

**Status:** Known edge case

If two rows in the same Excel file produce the same business key (e.g., two cost lines with identical description, category, and counterparty but no invoice number), the second row may match the same existing DB row as the first.

**Impact:** In rare cases, this could produce incorrect matching. The system does not currently detect or warn about duplicate keys within a single file.

**Mitigation:** The planner emits LOW confidence warnings for rows with weak key composition. Future phases may add a deduplication pre-check.

---

## 7. Multi-project tracker limitations

**Status:** Partially supported

Multi-project trackers (a single file containing data for multiple sub-projects) are detected during section detection. Sub-project names are extracted and used in row identity keys.

**Impact:** Row matching quality depends on sub-project names being consistent across imports. If sub-project naming changes, rows may be misidentified.

---

## 8. Plan row dependencies

**Status:** Partial

When a CHANGED plan row is updated in `work_items`, the update is in-place (the row keeps its ID). However, parent-child relationships (`parentId`) and task dependencies (`work_item_dependencies`) are not automatically re-evaluated during v2 incremental commit.

**Impact:** If a task's parent task number changes in the spreadsheet, the parent-child link may not update.

**Mitigation:** For imports that significantly restructure the plan hierarchy, resolve conflicts explicitly via `v2ConflictResolutions`, or delete and re-create affected rows manually. There is no longer a v1 full-replace escape hatch.

---

## 9. Tracker columns previously dropped — now captured

**Status:** Resolved (2026-04-29 release)

Until this release, the synonym map collapsed several physically distinct
Tracker columns onto a single canonical field, and the schema lacked
columns for actual-side QTY/Rate, line comments, the CHECK validation
flag, Saving / Overrun, USD exchange rate, price per watt, and milestone
notes. Imports silently dropped these fields.

This release wires the missing fields end-to-end:

| Section | Tracker column | New column |
|---|---|---|
| PLAN | LEAD | `work_items.lead` |
| PLAN | Resource 1 | `work_items.resource_1` |
| PLAN | Resource 2 | `work_items.resource_2` |
| PLAN | COMMENTS | `work_items.tracker_comments` |
| PLAN | WORK DAYS | `work_items.work_days` |
| REVENUE | Milestone Notes & Comments (col R) | `normalized_revenue_lines.milestone_notes` |
| EXPENDITURE | Actual QTY (col O) | `normalized_cost_lines.actual_qty` |
| EXPENDITURE | Actual Rate / Unit (col P) | `normalized_cost_lines.actual_rate` |
| EXPENDITURE | Comments (col AA) | `normalized_cost_lines.comments` |
| EXPENDITURE | CHECK (col V) | `normalized_cost_lines.check_flag` |
| EXPENDITURE | Saving / Overrun (col Z) | `normalized_cost_lines.saving_overrun` |
| EXPENDITURE | USD Exchange Rate (col AB/AC) | `normalized_cost_lines.usd_exchange_rate` |
| EXPENDITURE | Price per Watt (col AE) | `normalized_cost_lines.price_per_watt` |

All fields participate in the 3-way conflict engine (`PLAN_COMPARE_FIELDS`
/ `REVENUE_COMPARE_FIELDS` / `EXPENDITURE_COMPARE_FIELDS` in
`server/lib/import/row-matcher.ts`), so manual edits on them now survive
re-import or surface as conflicts.

**Impact on existing data:** rows imported before this release have NULL
in the new columns until their projects are re-imported. The user has
been notified of this behaviour change.

---

## 10. Stable hash-based row identity + per-row import snapshot

**Status:** Implemented (2026-04-29 release)

Schema additions (additive migration `0043_tracker_stable_ids_and_merge.sql`):

  - `row_hash` (text)         — deterministic SHA-256 from each row's
                              identity columns. Computed by
                              `server/lib/import/row-hasher.ts`.
                              Same logical row keeps the same hash
                              across re-imports.
  - `import_snapshot` (jsonb) — the row's compare-field values exactly
                              as written by the most recent import.
                              Acts as the "common ancestor" in 3-way
                              merges, alongside the existing
                              summaryJson-based baseline used by
                              `conflict-engine.ts`.
  - `manual_overrides` (jsonb) — per-field metadata about manual
                              edits (`{ value, editedBy, editedAt,
                              fromValue }`), maintained by
                              `merge-engine.ts` `updateManualOverrides`.

Partial indexes on `(project_id, row_hash) WHERE <active>` for fast
lookup by the merge engine.

**Two engines coexist** during the transition:
  - `server/lib/import/conflict-engine.ts` (existing, wired through
    `smart-import-routes.ts`) uses `summaryJson.normalization` from the
    last committed import as baseline.
  - `server/lib/import/merge-engine.ts` (new, wired into
    `commit-executor.ts`) uses `import_snapshot` per-row.

The two are equivalent for the trust contract; consolidation onto
`merge-engine.ts` is a follow-up cleanup.

**Legacy rows** without `row_hash` / `import_snapshot` degrade
gracefully: the merge engine treats the DB row as the snapshot, so
divergence is classified as `accept_file` rather than conflict, and the
row picks up its hash on the first re-import after this release.

---

## 11. Per-cell font / fill colour fidelity

**Status:** Implemented for capture; rendered on the new replica screens

The Tracker uses font / fill colour to encode meaning (red = unconfirmed,
yellow fill = risk, black = confirmed). Until this release, only
`invoice_date` and `paid_date` captured font colour. This release adds a
`cell_format` JSONB column on `normalized_revenue_lines`,
`normalized_cost_lines`, `normalized_cost_line_actuals`, and
`work_items`:

```json
{
  "milestone_notes":  { "font": "#FF0000" },
  "amount_ex_vat":    { "font": "#000000", "fill": "#FFFF00", "bold": true }
}
```

Keys are canonical field names; values describe the source-cell
formatting.

**Existing screens are not yet refreshed** to render `cell_format` —
that's pending follow-up work. The new replica screens
(`/projects/:id/revenue-tracking`, `/expenditure-breakdown`,
`/program-plan`) render colour from `cell_format` for every cell.

---

## 12. 1:N actuals against a costed line

**Status:** Implemented

The Expenditure Breakdown sheet pairs a costed line with N actual
batches (one per invoice). Until this release, when the actual side had
more rows than the costed side, the extras were silently dropped — the
**most likely root cause** of the previously-reported data loss.

This release adds a child table `normalized_cost_line_actuals` (FK to
`normalized_cost_lines.id`, temporal columns) and extracts orphan
actual rows during normalization, attaching them to their parent costed
line by walking back to the most recent row with a costed-side
category.

The new Expenditure Breakdown replica screen expands the actual side
into a 1:N row group when this happens.

---

## 13. Tracker top-of-sheet metadata blocks

**Status:** Captured into new tables

  - **Project Plan** rows 1–7 (Baseline / Forecasted Completion,
    Project Start, Duration metrics) → `tracker_project_metadata`.
  - **Revenue Tracking** rows 4–7 (Planned Revenue / Expenditure /
    Profit / Margin × Costed / Actual) → `tracker_revenue_summary`.

Both are temporal (effectiveFrom/effectiveTo). The new replica screens
render them as a header summary card.
