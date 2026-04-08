# Smart Import v2 — Known Limitations

**Last updated:** 2026-04-08

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

**Status:** Intentional safety net

If the v2 incremental commit path encounters an unexpected error, or if `skipV2ConflictCheck=true` is passed in the commit request, the system falls back to v1 behavior (soft-close all rows + re-insert all rows).

**Impact:** In the fallback case, unchanged rows will be re-inserted (ID churn), and app edits may be overwritten without conflict detection.

**Decision:** The fallback exists as a safety net during initial rollout. It can be removed once v2 has proven stable.

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

**Impact:** If a task's parent task number changes in the spreadsheet, the parent-child link may not update. The v1 path handles this by deleting and re-creating all work items.

**Mitigation:** For imports that significantly restructure the plan hierarchy, operators can use the "Advanced view" with `skipV2ConflictCheck=true` to force v1 full-replace behavior.
