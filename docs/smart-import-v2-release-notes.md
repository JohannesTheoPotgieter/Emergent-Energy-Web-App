# Smart Import v2 — Release Notes

**Release date:** 2026-04-08
**Version:** 2.0

---

## What changed from v1

### Import behavior

| Behavior | v1 | v2 |
|----------|----|----|
| **First import** | Full insert (all rows) | Same — all rows inserted as new baseline |
| **Later imports** | Full replace: soft-close ALL existing rows, re-insert ALL rows from file | Incremental: only NEW rows are inserted, only CHANGED rows are updated, UNCHANGED rows are left untouched |
| **Row identity** | Based on Excel row numbers (fragile) | Based on stable business keys: task number (Plan), milestone name (Revenue), invoice number / description (Costs) |
| **Unchanged rows** | Re-inserted with new IDs every import | Preserved with stable IDs — no churn |
| **App edits** | Could be silently overwritten | Protected: 3-way merge detects when both the app and spreadsheet changed differently |
| **Conflict resolution** | Limited to 6 manual-edit flags on cost lines | Full field-level 3-way merge across all sections (Plan, Revenue, Costs) |
| **Missing rows** | Section-wide replacement removed them | Kept unchanged — not silently deleted |
| **UX** | Technical 5-step wizard (Sections, Mapping, Issues, Commit) | Plain-language 5-step flow (What we found, What changed, Needs your decision, Confirm import) |

### Conflict protection

When a field was changed in the app AND the uploaded spreadsheet has a different value for that same field:
- The system detects this as a conflict
- The user sees both values side-by-side with the last imported value as reference
- The user must choose: "Keep current app value" or "Use uploaded value"
- All decisions are audit-logged

When a field was only changed in the app (spreadsheet still has the old value):
- The app change is automatically preserved

When a field was only changed in the spreadsheet (app still has the last imported value):
- The spreadsheet change is automatically applied

### File and folder parity

File upload and folder upload use the exact same import engine, planner, and review flow. There is no difference in behavior — only the initial selection method differs.

### Canonical architecture alignment

Import writes target the authoritative data stores directly:
- **Plan** rows write to `work_items` (the canonical plan store)
- **Revenue** rows write to `normalized_revenue_lines` (the canonical revenue store)
- **Cost** rows write to `normalized_cost_lines` (the canonical cost store)

Derivative/summary tables are refreshed asynchronously after commit. Dashboard views may take a moment to reflect the latest import.

### Revenue milestone number

The system now extracts and persists milestone numbers (`milestone_no`) from Excel trackers when the tracker includes a numbered milestone column. This improves row identity confidence for revenue matching.

---

## Rollout notes

### Default experience

Smart Import v2 is the default experience ("Simple view"). The previous v1 interface is available as "Advanced view" for operators who need access to column mapping, issue resolution, and other technical controls.

### Feature flag / escape hatch

The v2 incremental commit path activates when:
1. The import run has an assigned `projectId`
2. `skipV2ConflictCheck` is not set to `true` in the commit request

If v2 encounters an error, the system falls back to v1 behavior automatically.

### Migration

- **Schema:** One additive migration adds `milestone_no` and `milestone_percent` columns to `normalized_revenue_lines`. No destructive changes.
- **Data:** No backfill required. Existing rows get NULL for milestone_no; future imports populate it automatically.
- **Rollback:** The v1 commit path is preserved as fallback. Setting `skipV2ConflictCheck=true` on the commit request forces v1 behavior.

### Key risks addressed

1. **ID churn eliminated** — unchanged rows keep their database IDs, preserving links and references
2. **Silent overwrites eliminated** — app edits are detected and protected via 3-way merge
3. **Section-wide replacement eliminated** — only affected rows are modified
4. **Excel row number dependency eliminated** — stable business keys used instead
