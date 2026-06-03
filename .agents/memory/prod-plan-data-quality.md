---
name: Production plan data-quality (work_items hierarchy & duplicates)
description: Why prod project plans render flat/messy and the data-safe way to clean them.
---

# Production plan data-quality

Prod (Neon) project plans are systemically messy: most `work_items` rows are
top-level (`parent_id IS NULL`) instead of nested under their phase, and many
titles are duplicated. This is an **import-process artifact**, not per-project
corruption — the importer creates tasks without setting `parent_id`. Cleaning the
data does NOT stop future imports from re-breaking it; the importer is the real
root cause.

## What is recoverable from the data (safe to automate, portfolio-wide)
- **Re-parent by WBS prefix:** a parentless row with a dotted `wbs_code` (e.g.
  `3.1`) belongs under the row whose `wbs_code` is the prefix (`3`). Deterministic
  and correct. (~1,055 of ~1,066 dotted-orphans resolve this way.)
- **Dedup by `project_id + title + start_date + end_date`:** identical 4-tuple =
  true duplicate. Keep the most-structured copy (has parent > dotted WBS > min id),
  repoint losers' children onto the keeper, then soft-delete losers
  (`deleted_at = now()`, never hard DELETE — matches app + reversible).

## What is NOT recoverable from data
- Integer-WBS (`1`,`2`,`3`) and blank-WBS top-level tasks have **no** parent
  signal. The `phase` column is essentially empty (≈11 rows portfolio-wide), so
  it can't be used to nest them. Guessing their phase risks a *wrong* tree, which
  is worse than flat. These need a per-project template (e.g. Red Rocket's clean
  dev copy in helium) — do NOT auto-guess.

## Making a manual hierarchy fix survive re-import
- Smart Import is idempotent (matches by `row_hash`, which prefers `wbs_code`),
  so re-importing a workbook won't duplicate or error on soft-deleted rows
  (partial unique indexes filter on `deleted_at IS NULL`).
- BUT the importer **rebuilds `parent_id` from the `outline_number` prefix** on
  every import, and on insert it writes `outline_number = wbs_code`. Legacy prod
  rows have a **flat** `outline_number` (plain integers) while `wbs_code` is
  dotted — so a re-import would *re-flatten* any hierarchy you fixed by `wbs_code`.
- **Fix that survives re-import:** also set `outline_number = wbs_code` (only
  where `wbs_code` is present — rows without `wbs_code` derive their hash from
  `outline_number`, so don't touch those). Then a re-import re-derives the SAME
  tree instead of flattening it. This mirrors what the importer itself does.
- **Why:** data-only cleanup is otherwise undone by the next import; aligning the
  field the importer reads from is what makes it durable without a code change.

## Gotchas
- `work_items.start_date` / `end_date` are stored as **text** in helium, and the
  prod `claude_views.v_work_items` view returns them as text too. Always cast
  `::text` (or compare as text) in partition/group keys — comparing against a
  `DATE` literal errors with "COALESCE types text and date cannot be matched".
- Apparent duplicate task *names* across phases (e.g. "Inverters delivered",
  "Rigging of Batteries") can be **legitimate recurring tasks** (the clean dev
  copy has them twice under different phases). Never dedup by title alone —
  require matching dates too, and preview the removal list first.
- Cleanup script lives at `qa/prod-plan-cleanup.sql` (backup + soft-delete +
  re-link, reviewable, with a full restore section).
