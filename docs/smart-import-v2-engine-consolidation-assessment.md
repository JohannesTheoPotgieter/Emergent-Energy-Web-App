# Smart Import v2 — Engine Consolidation Assessment

> **Status:** Decision documented; consolidation deferred to a follow-up PR.
> **Date:** 2026-04-29
> **Decision owner:** Pending human review (Item 13 of the production-ready
> work for the 2026-04-29 release).

---

## Background

After the 2026-04-29 release, the Smart Import pipeline has TWO 3-way
conflict detection engines running on every commit:

1. **`server/lib/import/conflict-engine.ts`** (existing pre-PR2C; ~368 lines)
   - Baseline source: `summaryJson.normalization` from the LAST committed
     import run (whole-import-level snapshot).
   - Wired into the route via `runImportPlanner` → returns HTTP 409 with
     `error: "v2_conflicts_detected"` when blocking conflicts are found.
   - Conflict-resolution payload key: `v2ConflictResolutions:
     Record<\`${rowKey}::${fieldName}\`, "keep_app" | "accept_file">`.

2. **`server/lib/import/merge-engine.ts`** (NEW in PR2C; ~334 lines)
   - Baseline source: `import_snapshot` JSONB on EACH active row
     (per-row snapshot).
   - Wired into the section writers (`writePlan/Revenue/Expenditure
     Incremental`) via `gatedMergeRowEngine`.
   - Populates a `mergeConflicts: MergeConflictEntry[]` field on
     `SectionCommitResult`. **NOT yet consumed by the route 409
     envelope** — the existing `conflict-engine.ts` path still owns
     that.

## Why this is currently fine

Both engines are trust-correct on their own:

- The existing engine catches every blocking conflict against the
  whole-import baseline before the writer even runs. The user can't
  commit unresolved conflicts.
- The new engine repeats the same detection per-row but via the more
  precise per-row snapshot. Its output is captured but currently
  discarded by the route.

So in production today, the existing engine is the source of truth
for conflict prompts; the new engine is dormant infrastructure that
captures data (`row_hash`, `import_snapshot`, `manual_overrides` JSONB)
the existing engine doesn't yet read from.

The user-visible behaviour is identical to a single-engine system. The
cost is code maintenance: two implementations of "what counts as a
conflict?" that must be kept in sync.

## Why we're deferring consolidation

Three reasons:

1. **Behaviour-preservation cost.** The existing engine has 368 lines
   of edge-case handling (placeholder-invoice exemptions, cosRealised
   semantics, MissingFromUpload detection, etc.) that aren't trivially
   transferable to the new engine. Cleanly migrating means retesting
   every conflict scenario the operator team has historically reported.

2. **Snapshot-availability gap.** The new engine reads
   `import_snapshot` per-row. Legacy rows imported before PR2C have
   `import_snapshot = NULL` and degrade gracefully (the merge engine
   treats db-as-snapshot, classifying divergence as `accept_file`
   rather than `conflict`). A consolidation that REPLACES the existing
   engine would silently weaken conflict detection for legacy rows
   until they're re-imported once. The existing engine's
   summaryJson-based baseline doesn't have this gap.

3. **Roll-forward path is safe.** With both engines running:
   - Today: existing engine detects conflicts; new engine captures
     per-row snapshots silently.
   - Phase 1 follow-up: the route consumes `mergeConflicts` AND the
     existing engine's output, with a per-row preference: trust the
     per-row snapshot when present, fall back to summaryJson when not.
   - Phase 2 follow-up: backfill `import_snapshot` on every active row
     (~one-shot script over a transaction). Then drop the existing
     engine entirely.

## Recommended follow-up plan

| Phase | Scope | Risk |
|---|---|---|
| 1 | Wire `mergeConflicts` through the 409 envelope alongside the existing engine. Wizard sees BOTH; dedup by `(rowKey, fieldName)`. | Low |
| 2 | Add a one-shot script to backfill `import_snapshot` on every active row from the latest `summaryJson` for that row's project. | Low — read-only of summaryJson + JSONB upsert. |
| 3 | Switch the route to consume `mergeConflicts` ONLY; keep `conflict-engine.ts` available for one release as `USE_LEGACY_CONFLICT_ENGINE` rollback toggle. | Medium — touches the wizard contract. |
| 4 | Remove `conflict-engine.ts`. | Low after phase 3 has been live for a release. |

## Mitigations in the meantime

- Both engines participate in the same `PLAN_COMPARE_FIELDS` /
  `REVENUE_COMPARE_FIELDS` / `EXPENDITURE_COMPARE_FIELDS` lists in
  `server/lib/import/row-matcher.ts`. Adding a new field to one
  automatically benefits both. PR2A's new fields (lead, milestone_notes,
  etc.) are pinned by `qa/tests/unit/tracker-replica-integration.test.ts`.
- The structured `[SmartImport.metrics]` log line includes
  `conflictsSurfaced` per section, so an operator can spot a divergence
  between the two engines in production (they should agree).
- The `USE_THREE_WAY_MERGE=false` kill switch disables the new engine
  if a bug is found post-deploy. The existing engine continues to run.

## Decision

**Defer consolidation to a follow-up PR.** The PR currently in flight
(2026-04-29 release) is already large; collapsing two 300+ line engines
in the same change would expand its scope and review surface in a way
that's disproportionate to the user-visible benefit (zero behavioural
change). Document the plan above and execute over phases 1–4.
